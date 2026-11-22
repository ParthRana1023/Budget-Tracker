import { NextResponse, type NextRequest } from "next/server";
import { periodFromQuery } from "@/lib/budgetCalculator.mjs";

// The cycle containing ?date= (default today) for a cycle starting on ?monthStartDay= (1-28).
export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const result = periodFromQuery(q.get("monthStartDay"), q.get("date"));
  if (result.error !== undefined) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
