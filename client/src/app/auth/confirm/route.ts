import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { recordSignIn } from "@/utils/supabase/admin";
import { errorFields, log } from "@/lib/log.mjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Build the success redirect URL
  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.searchParams.delete("token_hash");
  redirectTo.searchParams.delete("type");
  redirectTo.searchParams.delete("code");
  redirectTo.searchParams.delete("next");

  // Create a redirect response FIRST, then bind the Supabase client's
  // cookie writes directly to it. This ensures session cookies are
  // included in the redirect response headers.
  let response = NextResponse.redirect(redirectTo);

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Handle PKCE code exchange (primary flow for @supabase/ssr)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return response;
    }
    log.warn("auth_confirm_exchange_failed", { ...errorFields(error), route: "/auth/confirm" });
  }

  // Handle token_hash verification (email confirmation / magic link fallback)
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Sign-in and sign-up links count as sign-ins; email-change and reset links don't.
      if ((type === "magiclink" || type === "signup" || type === "email") && data.user?.email)
        await recordSignIn(request.headers, {
          email: data.user.email,
          method: "link",
          success: true,
          accessToken: data.session?.access_token,
        });
      return response;
    }
    log.warn("auth_confirm_verify_otp_failed", { ...errorFields(error), route: "/auth/confirm" });
  }

  // Verification failed — redirect to login with error message
  const errorRedirect = request.nextUrl.clone();
  errorRedirect.pathname = "/login";
  // Only a known code goes in the URL; the login page turns it into a message.
  errorRedirect.search = "";
  errorRedirect.searchParams.set("error", "link_expired");
  return NextResponse.redirect(errorRedirect);
}
