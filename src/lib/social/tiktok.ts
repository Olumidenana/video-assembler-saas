import "server-only";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * TikTok Content Posting API:
 * Creators connect their TikTok account once via OAuth v2 with PKCE.
 * The server securely stores only the refresh token in `social_connections`,
 * and issues short-lived access tokens to the browser for direct client-side
 * uploads. Videos never touch our database or storage.
 */

export const directPostEnabled = () => process.env.TIKTOK_DIRECT_POST === "1";

export const tiktokScopes = () =>
  directPostEnabled() ? ["user.info.basic", "video.upload", "video.publish"] : ["user.info.basic", "video.upload"];

export const tiktokConfigured = () => Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

export const redirectUri = () => `${publicEnv.siteUrl}/api/tiktok/callback`;

export function authUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    scope: tiktokScopes().join(","),
    response_type: "code",
    redirect_uri: redirectUri(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number; open_id: string }> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      ...body,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string };
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
    error?: string;
    error_description?: string;
    message?: string;
  };
  const tokenData = json.data ?? json;
  if (!res.ok || !tokenData.access_token) {
    throw new Error(`TikTok token request failed: ${json.error_description ?? json.error ?? json.message ?? res.status}`);
  }
  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? "",
    expires_in: tokenData.expires_in ?? 86400,
    open_id: tokenData.open_id ?? "",
  };
}

export const exchangeCode = (code: string, codeVerifier: string) =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(), code_verifier: codeVerifier });

export const refreshAccess = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

/** Retrieves creator's username or display name to label the connected account. */
export async function accountName(accessToken: string): Promise<string | null> {
  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { user?: { display_name?: string; username?: string } };
  } | null;
  return json?.data?.user?.display_name ?? json?.data?.user?.username ?? null;
}

export async function getConnection(userId: string): Promise<{ refreshToken: string; accountName: string | null } | null> {
  const { data } = await createAdminClient()
    .from("social_connections")
    .select("refresh_token, account_name")
    .eq("user_id", userId)
    .eq("provider", "tiktok")
    .maybeSingle();
  return data ? { refreshToken: data.refresh_token as string, accountName: (data.account_name as string | null) ?? null } : null;
}

export async function saveConnection(userId: string, refreshToken: string, name: string | null) {
  const { error } = await createAdminClient()
    .from("social_connections")
    .upsert({ user_id: userId, provider: "tiktok", refresh_token: refreshToken, account_name: name }, { onConflict: "user_id,provider" });
  if (error) throw new Error(error.message);
}

export async function deleteConnection(userId: string) {
  const connection = await getConnection(userId);
  await createAdminClient().from("social_connections").delete().eq("user_id", userId).eq("provider", "tiktok");
  if (connection && process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) {
    await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        token: connection.refreshToken,
      }),
    }).catch(() => {});
  }
}
