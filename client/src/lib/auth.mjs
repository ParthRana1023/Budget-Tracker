// Auth copy and checks for the sign-in screens (design handoff, Landing and Auth).

export const isValidEmail = (/** @type {string} */ email) => /\S+@\S+\.\S+/.test(email.trim());

/**
 * Sign in through the app's server route (app/api/auth/sign-in), so the attempt is kept in the
 * user's sign-in history. `secret` is the password, or the 6-digit code for method "code".
 * The session cookies come back on the response.
 * @param {"password" | "code"} method @param {string} email @param {string} secret
 * @returns {Promise<{ error: { code?: string, name?: string, message?: string, status?: number } | null }>}
 */
export async function signInVia(method, email, secret) {
  try {
    const res = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, email: email.trim(), [method === "password" ? "password" : "token"]: secret }),
    });
    if (res.ok) return { error: null };
    const body = await res.json().catch(() => null);
    return { error: body?.error ?? { status: res.status } };
  } catch {
    return { error: { name: "AuthRetryableFetchError", status: 0 } };
  }
}

/**
 * Password strength 0-4 for the 4-segment meter. Anything under 6 characters is 1 ("Too weak").
 * @param {string} pw
 */
export function passwordScore(pw) {
  if (!pw) return 0;
  if (pw.length < 6) return 1;
  let score = 1;
  if (pw.length >= 10) score++;
  if ((/[A-Z]/.test(pw) && /[a-z]/.test(pw)) || /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}
export const PASSWORD_HINTS = ["At least 6 characters", "Too weak", "Okay", "Good", "Strong"];

/**
 * @typedef {"forgot" | "verify" | "resend"} AuthAction
 * What the error banner's link does: go to Forgot password, go to Verify email, or send a new code.
 */

/** Codes the app puts in ?error= on /login (never free text, so the page can't be made to say anything). */
const QUERY_ERRORS = /** @type {Record<string, { message: string, action?: AuthAction }>} */ ({
  link_expired: { message: "Email verification link has expired or is invalid. Request a new one." },
  google_cancelled: { message: "Google sign-in was cancelled before it finished. Try again, or use your email." },
});
export const errorFromQuery = (/** @type {string | null} */ code) => (code && QUERY_ERRORS[code]) || null;

/**
 * Supabase auth error -> the handoff's wording and follow-up action.
 * @param {{ code?: string, name?: string, message?: string, status?: number } | null | undefined} error
 * @returns {{ message: string, action?: AuthAction }}
 */
export function authErrorFor(error) {
  const code = error?.code ?? "";
  if (code === "invalid_credentials") {
    return {
      message: "That email and password don’t match. Check for typos or reset your password.",
      action: "forgot",
    };
  }
  if (code === "email_not_confirmed") {
    return {
      message: "This email hasn’t been confirmed yet. Open the link we sent, or get a new one.",
      action: "verify",
    };
  }
  if (code === "otp_expired") {
    return { message: "That code has expired. Request a new one and use it within 10 minutes.", action: "resend" };
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return { message: "Too many emails in a short time. Wait a minute, then try again." };
  }
  if (code === "user_already_exists" || code === "email_exists") {
    return { message: "An account with this email already exists. Sign in instead." };
  }
  if (code === "weak_password") return { message: "Choose a stronger password: at least 6 characters." };
  if (error?.name === "AuthRetryableFetchError" || error?.status === 0 || /fetch|network/i.test(error?.message ?? "")) {
    return { message: "We couldn’t reach SaveFirst. Check your connection and try again." };
  }
  return { message: error?.message || "Something went wrong. Please try again." };
}
