import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { recordSignIn } from "@/utils/supabase/admin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const linked = searchParams.get("linked") === "1";

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.searchParams.delete("token_hash");
  redirectTo.searchParams.delete("type");
  redirectTo.searchParams.delete("code");
  redirectTo.searchParams.delete("next");
  redirectTo.searchParams.delete("linked");

  // Bind cookie writes directly to the redirect response
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

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Linking Google from Account (linked=1) isn't a sign-in.
      if (!linked && data.user?.email)
        await recordSignIn(request.headers, {
          email: data.user.email,
          method: "google",
          success: true,
          accessToken: data.session?.access_token,
        });
      return response;
    }
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return response;
    }
  }

  // An OAuth provider (Google) that was cancelled or failed comes back with ?error=.
  const errorRedirect = request.nextUrl.clone();
  errorRedirect.pathname = "/login";
  // Only a known code goes in the URL; the login page turns it into a message.
  errorRedirect.search = "";
  errorRedirect.searchParams.set("error", searchParams.get("error") ? "google_cancelled" : "link_expired");
  return NextResponse.redirect(errorRedirect);
}
