import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/billing/status";
import { createClient } from "@/lib/supabase/server";

/** Google sends the user back here via Supabase with a one-time code. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.error("[auth] code exchange failed", error.message);
  }
  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
