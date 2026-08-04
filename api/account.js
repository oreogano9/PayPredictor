const crypto = require("node:crypto");

const ACCOUNT_PREFIX = "paypredictor-users";
const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_DATA_BYTES = 900_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const loginAttempts = globalThis.__payPredictorLoginAttempts || new Map();
globalThis.__payPredictorLoginAttempts = loginAttempts;

function getSecret() {
  return process.env.PAYPREDICTOR_AUTH_SECRET || "";
}

function normalizeName(name) {
  return String(name || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

function accountKeyForName(normalizedName, secret) {
  return crypto.createHmac("sha256", secret).update(normalizedName).digest("hex");
}

function accountPath(accountKey) {
  return `${ACCOUNT_PREFIX}/${accountKey}.json`;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString("base64url");
}

function verifyPin(pin, record) {
  const expected = Buffer.from(record.pinHash || "", "base64url");
  const actual = Buffer.from(hashPin(pin, record.pinSalt || ""), "base64url");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function signSession(accountKey, displayName, secret, authVersion = 1) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      accountKey,
      displayName,
      authVersion,
      expiresAt: Date.now() + SESSION_MAX_AGE_MS,
    }),
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(token, secret) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      parsed.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(parsed.accountKey || "") ||
      Number(parsed.expiresAt) <= Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function validateName(name) {
  const normalizedName = normalizeName(name);
  if (normalizedName.length < 2 || normalizedName.length > 40) {
    return { error: "Il nome deve contenere da 2 a 40 caratteri" };
  }
  return { normalizedName };
}

function validateCredentials(name, pin) {
  const nameValidation = validateName(name);
  if (nameValidation.error) return nameValidation;
  if (!/^\d{4}$/.test(String(pin || ""))) {
    return { error: "Il PIN deve contenere 4 numeri" };
  }
  return nameValidation;
}

function recordAuthVersion(record) {
  return Number.isInteger(record?.authVersion) && record.authVersion > 0 ? record.authVersion : 1;
}

function sessionMatchesRecord(session, record) {
  return (Number.isInteger(session?.authVersion) ? session.authVersion : 1) === recordAuthVersion(record);
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Dati account non validi";
  }
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > MAX_DATA_BYTES) {
    return "Il calendario e troppo grande per il backup";
  }
  if (data.appState?.calendarShifts && !Array.isArray(data.appState.calendarShifts)) {
    return "Calendario non valido";
  }
  return null;
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function rateLimitKey(request, accountKey) {
  return crypto.createHash("sha256").update(`${requestIp(request)}:${accountKey}`).digest("hex");
}

function isRateLimited(key) {
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((timestamp) => now - timestamp < LOGIN_WINDOW_MS);
  loginAttempts.set(key, recent);
  return recent.length >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key) {
  const attempts = loginAttempts.get(key) || [];
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

async function readRecord(blobSdk, pathname) {
  try {
    const result = await blobSdk.get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode === 404 || !result.stream) return null;
    if (result.statusCode !== 200) throw new Error(`Blob read failed: ${result.statusCode}`);
    return JSON.parse(await new Response(result.stream).text());
  } catch (error) {
    if (error?.status === 404 || error?.statusCode === 404 || error?.code === "blob_not_found") return null;
    throw error;
  }
}

async function writeRecord(blobSdk, pathname, record) {
  await blobSdk.put(pathname, JSON.stringify(record), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Metodo non consentito" });
  }

  const secret = getSecret();
  if (!secret || secret.length < 32) {
    return response.status(503).json({ error: "Backup cloud non configurato" });
  }

  let body = request.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return response.status(400).json({ error: "Richiesta non valida" });
    }
  }

  const action = body?.action;
  const blobSdk = await import("@vercel/blob");

  try {
    if (action === "create" || action === "login") {
      const validation = validateCredentials(body.name, body.pin);
      if (validation.error) return response.status(400).json({ error: validation.error });

      const accountKey = accountKeyForName(validation.normalizedName, secret);
      const pathname = accountPath(accountKey);
      const displayName = String(body.name).normalize("NFKC").trim().replace(/\s+/g, " ");
      const record = await readRecord(blobSdk, pathname);

      if (action === "create") {
        if (record) {
          return response.status(409).json({ error: "Nome gia registrato. Usa Accedi." });
        }
        const dataError = validateData(body.data);
        if (dataError) return response.status(400).json({ error: dataError });

        const pinSalt = crypto.randomBytes(16).toString("base64url");
        const now = new Date().toISOString();
        await writeRecord(blobSdk, pathname, {
          schemaVersion: 1,
          displayName,
          authVersion: 1,
          pinSalt,
          pinHash: hashPin(String(body.pin), pinSalt),
          data: body.data,
          createdAt: now,
          updatedAt: now,
        });

        return response.status(201).json({
          name: displayName,
          token: signSession(accountKey, displayName, secret, 1),
          data: body.data,
        });
      }

      const attemptKey = rateLimitKey(request, accountKey);
      if (isRateLimited(attemptKey)) {
        return response.status(429).json({ error: "Troppi tentativi. Riprova tra 15 minuti." });
      }
      if (!record || !verifyPin(String(body.pin), record)) {
        recordFailedLogin(attemptKey);
        return response.status(401).json({ error: "Nome o PIN non corretti" });
      }
      loginAttempts.delete(attemptKey);
      return response.status(200).json({
        name: record.displayName,
        token: signSession(accountKey, record.displayName, secret, recordAuthVersion(record)),
        data: record.data,
      });
    }

    if (action === "update_credentials") {
      const session = verifySession(body.token, secret);
      if (!session) return response.status(401).json({ error: "Accesso scaduto" });

      const currentPathname = accountPath(session.accountKey);
      const record = await readRecord(blobSdk, currentPathname);
      if (!record || !sessionMatchesRecord(session, record)) {
        return response.status(401).json({ error: "Accesso scaduto" });
      }

      const nameValidation = validateName(body.name);
      if (nameValidation.error) return response.status(400).json({ error: nameValidation.error });
      const nextPin = String(body.pin || "");
      if (nextPin && !/^\d{4}$/.test(nextPin)) {
        return response.status(400).json({ error: "Il nuovo PIN deve contenere 4 numeri" });
      }

      const displayName = String(body.name).normalize("NFKC").trim().replace(/\s+/g, " ");
      const nextAccountKey = accountKeyForName(nameValidation.normalizedName, secret);
      const nextPathname = accountPath(nextAccountKey);
      const isRename = nextAccountKey !== session.accountKey;
      const displayNameChanged = displayName !== record.displayName;
      if (!isRename && !displayNameChanged && !nextPin) {
        return response.status(400).json({ error: "Nessuna modifica da salvare" });
      }

      if (isRename && (await readRecord(blobSdk, nextPathname))) {
        return response.status(409).json({ error: "Nome gia registrato. Scegline un altro." });
      }

      const authVersion = recordAuthVersion(record) + 1;
      const updatedRecord = {
        ...record,
        displayName,
        authVersion,
        updatedAt: new Date().toISOString(),
      };
      if (nextPin) {
        updatedRecord.pinSalt = crypto.randomBytes(16).toString("base64url");
        updatedRecord.pinHash = hashPin(nextPin, updatedRecord.pinSalt);
      }

      if (isRename) {
        await writeRecord(blobSdk, nextPathname, updatedRecord);
        try {
          await writeRecord(blobSdk, currentPathname, {
            schemaVersion: 1,
            authVersion,
            movedAt: new Date().toISOString(),
          });
        } catch (error) {
          await blobSdk.del(nextPathname).catch(() => undefined);
          throw error;
        }
        await blobSdk.del(currentPathname).catch((error) => {
          console.error("Old account tombstone cleanup failed", error);
        });
      } else {
        await writeRecord(blobSdk, currentPathname, updatedRecord);
      }

      return response.status(200).json({
        name: displayName,
        token: signSession(nextAccountKey, displayName, secret, authVersion),
      });
    }

    if (action === "restore" || action === "save") {
      const session = verifySession(body.token, secret);
      if (!session) return response.status(401).json({ error: "Accesso scaduto" });

      const pathname = accountPath(session.accountKey);
      const record = await readRecord(blobSdk, pathname);
      if (!record || !sessionMatchesRecord(session, record)) {
        return response.status(401).json({ error: "Accesso scaduto" });
      }

      if (action === "restore") {
        return response.status(200).json({ name: record.displayName, data: record.data });
      }

      const dataError = validateData(body.data);
      if (dataError) return response.status(400).json({ error: dataError });
      await writeRecord(blobSdk, pathname, {
        ...record,
        data: body.data,
        updatedAt: new Date().toISOString(),
      });
      return response.status(200).json({ ok: true, updatedAt: new Date().toISOString() });
    }

    return response.status(400).json({ error: "Azione non valida" });
  } catch (error) {
    console.error("Account API error", error);
    return response.status(500).json({ error: "Backup cloud momentaneamente non disponibile" });
  }
};
