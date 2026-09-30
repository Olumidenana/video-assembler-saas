/**
 * Public config (inlined into the browser bundle at build time). Server-only
 * secrets are read where they're used, in modules guarded by "server-only".
 */
/**
 * Reduces a URL to its origin. The Supabase dashboard also shows endpoint URLs
 * like "https://x.supabase.co/rest/v1/"; pasting one of those would silently
 * break auth, so only the origin is kept.
 */
function origin(value: string | undefined, fallback = ""): string {
  if (!value?.trim()) return fallback;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return fallback;
  }
}

export const publicEnv = {
  siteUrl: origin(process.env.NEXT_PUBLIC_SITE_URL, "http://localhost:3000"),
  supabaseUrl: origin(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  paystackPublicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
};

/** False in a fresh checkout without .env.local; the app then runs as "logged out, free plan". */
export const supabaseConfigured = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseKey);
