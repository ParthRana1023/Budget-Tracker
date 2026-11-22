import { NextResponse } from "next/server";
import { calculateSafeToSpend, parseBudgetInput } from "@/lib/budgetCalculator.mjs";

// Stateless Safe-to-Spend calculation. An empty body uses the defaults (all zero, 30 days left).
export async function POST(request: Request) {
  const text = await request.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });

  const parsed = parseBudgetInput(body as Record<string, unknown>);
  if (parsed.error !== undefined) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json(calculateSafeToSpend(parsed.values));
}
