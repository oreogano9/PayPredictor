export default async function handler(request, response) {
  const { url } = request.query;
  const calendarUrl = Array.isArray(url) ? url[0] : url;

  if (!calendarUrl) {
    response.status(400).json({ error: "Missing iCal URL" });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(calendarUrl);
  } catch {
    response.status(400).json({ error: "Invalid iCal URL" });
    return;
  }

  const isAllowedProtocol = parsedUrl.protocol === "https:";
  const isCalendarHost =
    parsedUrl.hostname === "calendar.google.com" ||
    parsedUrl.hostname.endsWith(".calendar.google.com") ||
    parsedUrl.hostname === "calendar.googleusercontent.com";

  if (!isAllowedProtocol || !isCalendarHost) {
    response.status(400).json({ error: "Unsupported iCal URL" });
    return;
  }

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      headers: {
        accept: "text/calendar,text/plain,*/*",
      },
    });

    if (!upstream.ok) {
      response.status(upstream.status).json({ error: "Unable to fetch iCal feed" });
      return;
    }

    const body = await upstream.text();
    response.setHeader("content-type", "text/calendar; charset=utf-8");
    response.setHeader("cache-control", "private, max-age=300");
    response.status(200).send(body);
  } catch (error) {
    console.error("iCal proxy error", error);
    response.status(502).json({ error: "Unable to fetch iCal feed" });
  }
}
