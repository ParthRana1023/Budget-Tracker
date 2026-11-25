// Cookie consent. Two groups: Necessary (sign-in cookies and settings you choose; always on) and
// Analytics (Vercel Analytics and Speed Insights; off until accepted). The choice lives in a
// first-party cookie, sf_consent = v<version>.a<0|1>.<YYYY-MM-DD>. A missing, unreadable or
// older-version cookie means no choice yet, so analytics stays off and the banner asks.

export const CONSENT_COOKIE = "sf_consent";
const VERSION = 1;
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days, then ask again
/** Fired on window when the choice changes, so the page can load analytics without a reload. */
export const CONSENT_EVENT = "sf-consent";

/**
 * The saved choice in a cookie string (document.cookie, or a request's Cookie header), or null.
 * @param {string} cookies @returns {{ analytics: boolean, date: string } | null}
 */
export function parseConsent(cookies) {
  const raw = cookies
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  const m = raw && /^v(\d+)\.a([01])\.(\d{4}-\d{2}-\d{2})$/.exec(raw.slice(CONSENT_COOKIE.length + 1));
  return m && Number(m[1]) === VERSION ? { analytics: m[2] === "1", date: m[3] } : null;
}

/** Analytics may load only after an explicit yes. @param {string} cookies */
export const analyticsAllowed = (cookies) => parseConsent(cookies)?.analytics === true;

/**
 * The Set-Cookie / document.cookie string for a choice.
 * @param {boolean} analytics @param {string} today YYYY-MM-DD @param {boolean} secure on https
 */
export const consentCookie = (analytics, today, secure) =>
  `${CONSENT_COOKIE}=v${VERSION}.a${analytics ? 1 : 0}.${today}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;

/**
 * Save a choice (null forgets it, so the banner asks again) and tell the page. Turning analytics
 * off after it has loaded needs a reload to unload its scripts; the caller does that.
 * @param {boolean | null} analytics @param {string} today YYYY-MM-DD
 * @param {{ cookie: string }} [doc] @param {{ location: { protocol: string }, dispatchEvent: (e: Event) => unknown }} [win]
 */
export function saveConsent(analytics, today, doc = document, win = window) {
  const secure = win.location.protocol === "https:";
  doc.cookie =
    analytics === null
      ? `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`
      : consentCookie(analytics, today, secure);
  win.dispatchEvent(new Event(CONSENT_EVENT));
}
