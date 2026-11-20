import { log } from "@/lib/log.mjs";

// Browser error reports (lib/log.mjs reportClientError), logged as "browser:<event>".
const MAX_BYTES = 8_000;
const PER_MINUTE = 30;
// shortcut: the rate limit is per server instance (in memory); move it to a shared store if abuse shows up.
const hits = new Map<string, { n: number; at: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const h = hits.get(ip);
  if (h && now - h.at < 60_000) {
    if (++h.n > PER_MINUTE) return new Response(null, { status: 429 });
  } else {
    if (hits.size > 5_000) hits.clear();
    hits.set(ip, { n: 1, at: now });
  }

  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BYTES) return new Response(null, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(null, { status: 400 });
  const { event, ...fields } = body as Record<string, unknown>;
  log.error(`browser:${typeof event === "string" ? event : "error"}`, { ...fields, source: "browser" });
  return new Response(null, { status: 204 });
}
