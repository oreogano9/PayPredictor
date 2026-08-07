import { execFileSync } from "node:child_process";

const endpoint = process.env.PAYPREDICTOR_STATS_URL || "https://pay-predictor-olive.vercel.app/api/account";
const includeNames = process.argv.includes("--names");

function readStatsSecret() {
  if (process.env.PAYPREDICTOR_STATS_SECRET) return process.env.PAYPREDICTOR_STATS_SECRET;
  if (process.platform !== "darwin") return "";

  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", "oreogano9", "-s", "PayPredictor Stats API", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

const secret = readStatsSecret();
if (!secret) {
  console.error("Imposta PAYPREDICTOR_STATS_SECRET per leggere il conteggio utenti.");
  process.exit(1);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: includeNames ? "users" : "stats" }),
});
const result = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(result.error || `Richiesta non riuscita (${response.status})`);
  process.exit(1);
}

console.log(`Utenti unici: ${result.uniqueUsers}`);
console.log(`Record attivi: ${result.activeRecords}`);
console.log(`Record precedenti alla migrazione: ${result.legacyRecords}`);
console.log(`Aggiornato: ${result.generatedAt}`);
if (includeNames) {
  console.log("Nomi:");
  result.names.forEach((name) => console.log(`- ${name}`));
}
