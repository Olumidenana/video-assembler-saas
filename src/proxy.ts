import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv, supabaseConfigured } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on each page request so Server
 * Components always see a valid session. It never blocks or redirects; pages
 * decide what signed-out visitors see.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!supabaseConfigured) return response;

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Validates the token and refreshes it when needed. Don't run code between
  // creating the client and this call.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    // Skip static assets, the FFmpeg core files and the Paystack webhook (no user session there).
    "/((?!_next/static|_next/image|favicon.ico|ffmpeg/|api/paystack/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|js)$).*)",
  ],
};
