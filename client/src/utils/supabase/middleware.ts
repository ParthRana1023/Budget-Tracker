import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const updateSession = async (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Read before getUser(): a failed refresh clears the auth cookie on the request.
  const hadSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Signed-out pages; a signed-in visitor is sent on to the dashboard. (/reset-password is
  // not here: it needs the session the reset link creates.)
  const isAuthPage = ["/login", "/signup", "/verify", "/forgot-password"].some((p) => path.startsWith(p));
  const isPublicPage =
    path === "/" ||
    path.startsWith("/api") ||
    path.startsWith("/auth/") ||
    path === "/offline" ||
    path === "/session-expired";

  // Not signed in on a protected route: a stale sign-in cookie means the session ended
  // (show "Session expired"); no cookie at all means they never signed in (go to login).
  if (!user && !isAuthPage && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = hadSession ? "/session-expired" : "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Carry over cookie changes (e.g. the cleared stale session) from the refresh attempt.
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  // If user is signed in and visits /login or /signup, redirect to /dashboard
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
};
