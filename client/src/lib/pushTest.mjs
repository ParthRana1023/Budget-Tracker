// Settings › Notifications › Send a test (design handoff v3, Push): one push to this device now,
// ignoring quiet hours. The route (app/api/push/test) uses these checks; they're pure for tests.

/** What the test notification says. */
export const TEST_PUSH = {
  title: "Test from SaveFirst",
  body: "Push notifications work on this device.",
  url: "/settings?s=notif",
  tag: "test",
};

/** One test per user this often, so the button can't be used to flood a device. */
export const TEST_EVERY_MS = 30_000;

/**
 * Why a test can't be sent, or null when it can.
 * @param {{ userId: string | null | undefined, endpoint: unknown, lastSentAt?: number, now: number }} req
 * @returns {null | { status: number, message: string }}
 */
export function testProblem({ userId, endpoint, lastSentAt, now }) {
  if (!userId) return { status: 401, message: "Sign in again to send a test." };
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 1000)
    return { status: 400, message: "Turn push on for this device first." };
  if (lastSentAt !== undefined && now - lastSentAt < TEST_EVERY_MS)
    return { status: 429, message: "A test was just sent. Wait a few seconds and try again." };
  return null;
}

/** The push service says this subscription is gone (unsubscribed or expired). @param {unknown} err */
export const subscriptionGone = (err) => {
  const code = /** @type {{ statusCode?: number }} */ (err)?.statusCode;
  return code === 404 || code === 410;
};
