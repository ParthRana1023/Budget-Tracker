// Structured logging: one JSON line per event on stdout/stderr, which Vercel collects in its
// log viewer. Never logs personal data: only allow-listed fields are kept, and free text is
// scrubbed of emails and long numbers (amounts, phone numbers, card numbers).

const FIELDS = new Set([
  "route",
  "method",
  "status",
  "ms",
  "code",
  "userId",
  "rpc",
  "table",
  "source",
  "name",
  "message",
  "stack",
  "digest",
  "line",
  "col",
  "count",
]);
const NUMERIC = new Set(["ms", "status", "line", "col", "count"]);
const MAX = 500;

/** Remove emails and runs of 4+ digits from free text. */
export const scrub = (/** @type {unknown} */ v) =>
  String(v)
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, "[email]")
    .replace(/\d[\d,.\s]{2,}\d/g, "[n]")
    .slice(0, MAX);

/**
 * The log record for an event: allow-listed fields only, text scrubbed.
 * @param {"info" | "warn" | "error"} level @param {string} event @param {Record<string, unknown>} [fields]
 */
export function record(level, event, fields = {}) {
  /** @type {Record<string, unknown>} */
  const out = { t: new Date().toISOString(), level, event: scrub(event) };
  for (const [k, v] of Object.entries(fields)) {
    if (!FIELDS.has(k) || v === undefined || v === null || v === "") continue;
    out[k] = NUMERIC.has(k) && typeof v === "number" ? v : scrub(v);
  }
  return out;
}

/** @param {"info" | "warn" | "error"} level */
const write = (level) => (/** @type {string} */ event, /** @type {Record<string, unknown>} */ fields) => {
  const line = JSON.stringify(record(level, event, fields));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export const log = { info: write("info"), warn: write("warn"), error: write("error") };

/** Fields for an Error, or a Supabase/PostgREST error object ({ code, message }). */
export const errorFields = (/** @type {any} */ err) =>
  err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { code: err?.code, message: err?.message ?? String(err) };

/**
 * Browser only: report an error to /api/log so it reaches the server logs. Never throws.
 * @param {string} event @param {Record<string, unknown>} [fields]
 */
export function reportClientError(event, fields = {}) {
  try {
    const body = JSON.stringify({ ...record("error", event, fields), event });
    const sent = navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }));
    if (!sent) {
      void fetch("/api/log", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Reporting must never break the page.
  }
}
