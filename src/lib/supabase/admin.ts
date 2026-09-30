import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client with the secret key: bypasses row level security. Only used
 * by trusted server code (payment verification and the Paystack webhook), never
 * with user-controlled queries.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!publicEnv.supabaseUrl || !secret) throw new Error("Supabase secret key is not configured");
  return createClient(publicEnv.supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
