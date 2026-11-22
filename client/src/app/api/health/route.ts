import { NextResponse } from "next/server";

// Liveness check for uptime monitors and deploy smoke tests. Public, no Supabase call.
export function GET() {
  return NextResponse.json({ status: "ok", service: "savefirst", timestamp: new Date().toISOString() });
}
