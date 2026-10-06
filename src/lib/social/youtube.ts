import "server-only";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * YouTube posting: the creator connects their channel once (OAuth, offline
 * access), the server keeps only the refresh token, and hands the browser a
 * short-lived access token when it uploads. The video goes straight from the
 * creator's device to YouTube; it never touches this server.
 */

export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

export const youtubeConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const redirectUri = () => `${publicEnv.siteUrl}/api/youtube/callback`;

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google returns a refresh token even when reconnecting.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google token request failed: ${json.error ?? res.status}`);
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 3600 };
}

export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });

export const refreshAccess = (refreshToken: string) => tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

/** The channel's name, to show which account is connected. */
export async function channelName(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = (await res.json().catch(() => null)) as { items?: { snippet?: { title?: string } }[] } | null;
  return json?.items?.[0]?.snippet?.title ?? null;
}

export async function getConnection(userId: string): Promise<{ refreshToken: string; accountName: string | null } | null> {
  const { data } = await createAdminClient().from("social_connections").select("refresh_token, account_name").eq("user_id", userId).eq("provider", "youtube").maybeSingle();
  return data ? { refreshToken: data.refresh_token as string, accountName: (data.account_name as string | null) ?? null } : null;
}

export async function saveConnection(userId: string, refreshToken: string, accountName: string | null) {
  const { error } = await createAdminClient()
    .from("social_connections")
    .upsert({ user_id: userId, provider: "youtube", refresh_token: refreshToken, account_name: accountName }, { onConflict: "user_id,provider" });
  if (error) throw new Error(error.message);
}

export async function deleteConnection(userId: string) {
  const connection = await getConnection(userId);
  await createAdminClient().from("social_connections").delete().eq("user_id", userId).eq("provider", "youtube");
  if (connection) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
}
