/**
 * Public config (inlined into the browser bundle at build time). Server-only
 * secrets are read where they're used, in modules guarded by "server-only".
 */
export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  paystackPublicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
};

/** False in a fresh checkout without .env.local; the app then runs as "logged out, free plan". */
export const supabaseConfigured = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseKey);
