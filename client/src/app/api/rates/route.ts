import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { CURRENCIES } from "@/lib/money.mjs";
import { frankfurterUrl, parseFrankfurter } from "@/lib/fx.mjs";
import { errorFields, log } from "@/lib/log.mjs";

// GET /api/rates?currency=USD&date=2026-11-25: 1 USD in the signed-in user's base currency, for
// the cycle starting on `date`. Cache (fx_rates) first, then Frankfurter (ECB), saved with the
// secret key. If Frankfurter is down, the newest cached rate comes back with stale: true; with
// none at all, 503 and the app asks for the rate by hand.
const FIRST_ECB_DATE = "1999-01-04";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const currency = q.get("currency") ?? "";
  const date = q.get("date") ?? "";
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (!CURRENCIES.includes(currency)) return NextResponse.json({ error: "Unsupported currency." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date < FIRST_ECB_DATE || date > tomorrow)
    return NextResponse.json({ error: "date must be a cycle start, YYYY-MM-DD." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again to get exchange rates." }, { status: 401 });
  const { data: settings } = await supabase
    .from("user_settings")
    .select("currency")
    .eq("user_id", user.id)
    .maybeSingle();
  // ?base= prices against another currency (a base switch needs old -> new); default: the user's base.
  const asked = q.get("base");
  if (asked && !CURRENCIES.includes(asked))
    return NextResponse.json({ error: "Unsupported currency." }, { status: 400 });
  const base = asked || settings?.currency || "INR";
  if (currency === base) return NextResponse.json({ rate: 1, date, stale: false });

  const { data: cached } = await supabase
    .from("fx_rates")
    .select("rate")
    .eq("quote", currency)
    .eq("base", base)
    .eq("rate_date", date)
    .maybeSingle();
  if (cached) return NextResponse.json({ rate: Number(cached.rate), date, stale: false });

  try {
    const res = await fetch(frankfurterUrl(currency, base, date), { signal: AbortSignal.timeout(5000) });
    const parsed = res.ok ? parseFrankfurter(await res.json(), base) : null;
    if (!parsed) throw new Error(`Frankfurter ${res.status}`);
    const key = process.env.SUPABASE_SECRET_KEY;
    if (key) {
      const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin
        .from("fx_rates")
        .upsert(
          { quote: currency, base, rate_date: date, rate: parsed.rate, ecb_date: parsed.ecbDate },
          { onConflict: "quote,base,rate_date", ignoreDuplicates: true },
        );
      if (error) log.warn("fx_rate_cache_failed", { ...errorFields(error), route: "/api/rates" });
    }
    return NextResponse.json({ rate: parsed.rate, date, stale: false });
  } catch (e) {
    log.warn("fx_rate_fetch_failed", { ...errorFields(e), route: "/api/rates", currency, base });
    const { data: last } = await supabase
      .from("fx_rates")
      .select("rate, rate_date")
      .eq("quote", currency)
      .eq("base", base)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) return NextResponse.json({ rate: Number(last.rate), date: last.rate_date, stale: true });
    return NextResponse.json(
      { error: "Exchange rates aren’t available right now. Enter the rate yourself." },
      { status: 503 },
    );
  }
}
