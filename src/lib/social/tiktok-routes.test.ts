import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateChunks } from "./tiktok-upload";

vi.mock("server-only", () => ({}));
let viewer: { user: { id: string } | null; plan: "free" | "pro" | "studio" } = { user: { id: "u1" }, plan: "studio" };
vi.mock("@/lib/billing/account", () => ({ getViewer: async () => viewer }));

let row: { refresh_token: string; account_name: string | null } | null = null;
const upsert = vi.fn(async () => ({ error: null }));
const query = {
  select: () => query,
  eq: () => query,
  maybeSingle: async () => ({ data: row }),
  delete: () => query,
  upsert,
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query }) }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { createElement } from "react";
import { renderToString } from "react-dom/server";
const { GET: connect } = await import("@/app/api/tiktok/connect/route");
const { GET: callback } = await import("@/app/api/tiktok/callback/route");
const { POST: token } = await import("@/app/api/tiktok/token/route");
const { GET: status } = await import("@/app/api/tiktok/status/route");
const { TikTokButton, YouTubeButton, WhatsAppButton, InstagramButton } = await import("@/app/editor/post-tools");

beforeEach(() => {
  viewer = { user: { id: "u1" }, plan: "studio" };
  row = null;
  fetchMock.mockReset();
  upsert.mockClear();
  vi.stubEnv("TIKTOK_CLIENT_KEY", "test-client-key");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "test-client-secret");
});

describe("TikTok connection and OAuth routes", () => {
  it("redirects Studio creators to TikTok authorize endpoint with PKCE challenge and state cookies", async () => {
    const res = await connect(new NextRequest("https://app.test/api/tiktok/connect"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    const to = new URL(location);
    expect(to.origin).toBe("https://www.tiktok.com");
    expect(to.pathname).toBe("/v2/auth/authorize/");
    expect(to.searchParams.get("client_key")).toBe("test-client-key");
    expect(to.searchParams.get("scope")).toContain("video.upload");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("code_challenge")).toBeDefined();

    const setCookies = res.headers.get("set-cookie") ?? "";
    expect(setCookies).toContain("tt_state=");
    expect(setCookies).toContain("tt_verifier=");
  });

  it("restricts non-Studio plans with an upgrade redirect", async () => {
    viewer = { user: { id: "u1" }, plan: "pro" };
    const res = await connect(new NextRequest("https://app.test/api/tiktok/connect"));
    expect(res.headers.get("location")).toContain("/tiktok-connected?error=upgrade");
    expect((await token()).status).toBe(402);
  });

  it("handles callback: verifies state, exchanges code with PKCE verifier, and saves refresh token", async () => {
    // Bad state
    const bad = await callback(
      new NextRequest("https://app.test/api/tiktok/callback?code=test-code&state=bad-state", {
        headers: { cookie: "tt_state=good-state; tt_verifier=test-verifier" },
      }),
    );
    expect(bad.headers.get("location")).toContain("error=state");

    // Good state
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              access_token: "mock-access-token",
              refresh_token: "mock-refresh-token",
              expires_in: 86400,
              open_id: "mock-open-id",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              user: {
                display_name: "Test Creator",
                username: "testcreator",
              },
            },
          }),
        ),
      );

    const ok = await callback(
      new NextRequest("https://app.test/api/tiktok/callback?code=test-code&state=valid-state", {
        headers: { cookie: "tt_state=valid-state; tt_verifier=test-verifier" },
      }),
    );
    expect(ok.headers.get("location")).toContain("ok=1");
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "u1",
        provider: "tiktok",
        refresh_token: "mock-refresh-token",
        account_name: "Test Creator",
      },
      { onConflict: "user_id,provider" },
    );
  });

  it("provides short-lived access token to browser without exposing refresh token", async () => {
    expect((await token()).status).toBe(409);
    row = { refresh_token: "stored-rt", account_name: "Test Creator" };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            access_token: "refreshed-token",
            expires_in: 7200,
            open_id: "user-123",
          },
        }),
      ),
    );
    const res = await token();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      accessToken: "refreshed-token",
      expiresIn: 7200,
      openId: "user-123",
    });
  });

  it("reports configured=false when TIKTOK_CLIENT_KEY is missing", async () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "");
    const res = await status();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.connected).toBe(false);
  });

  it("reports configured=true and connected=false when not connected", async () => {
    row = null;
    const res = await status();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.connected).toBe(false);
  });
});

describe("calculateChunks for TikTok upload", () => {
  it("creates a single chunk when file is smaller than chunk size", () => {
    const { chunkSize, chunks } = calculateChunks(4 * 1024 * 1024, 10 * 1024 * 1024);
    expect(chunkSize).toBe(4 * 1024 * 1024);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      index: 0,
      start: 0,
      end: 4 * 1024 * 1024 - 1,
      size: 4 * 1024 * 1024,
      total: 4 * 1024 * 1024,
    });
  });

  it("splits larger files into valid chunks with minimum size 5MB", () => {
    const totalSize = 25 * 1024 * 1024;
    const { chunkSize, chunks } = calculateChunks(totalSize, 10 * 1024 * 1024);
    expect(chunkSize).toBe(10 * 1024 * 1024);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].size).toBe(10 * 1024 * 1024);
    expect(chunks[1].size).toBe(10 * 1024 * 1024);
    expect(chunks[2].size).toBe(5 * 1024 * 1024);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(10 * 1024 * 1024 - 1);
    expect(chunks[1].start).toBe(10 * 1024 * 1024);
    expect(chunks[2].end).toBe(totalSize - 1);
  });
});

describe("Post panel destination buttons state check", () => {
  const dummyFile = { url: "blob:http://localhost/video.mp4", name: "clip.mp4", shareText: "Cool Short #viral" };

  it("renders disabled state with honest tooltip when no keys are set", () => {
    const unconfiguredTikTok = renderToString(createElement(TikTokButton, { file: dummyFile, status: { configured: false, allowed: true, connected: false, account: null }, refresh: () => {} }));
    expect(unconfiguredTikTok).toContain("TikTok posting not set up by the site owner");

    const nullTikTok = renderToString(createElement(TikTokButton, { file: dummyFile, status: null, refresh: () => {} }));
    expect(nullTikTok).toContain("TikTok posting not set up by the site owner");

    const unconfiguredYouTube = renderToString(createElement(YouTubeButton, { file: dummyFile, status: { configured: false, allowed: true, connected: false, account: null }, refresh: () => {} }));
    expect(unconfiguredYouTube).toContain("YouTube posting not set up by the site owner");

    const nullYouTube = renderToString(createElement(YouTubeButton, { file: dummyFile, status: null, refresh: () => {} }));
    expect(nullYouTube).toContain("YouTube posting not set up by the site owner");
  });

  it("renders plan upgrade lock when plan is not allowed", () => {
    const proTikTok = renderToString(createElement(TikTokButton, { file: dummyFile, status: { configured: true, allowed: false, connected: false, account: null }, refresh: () => {} }));
    expect(proTikTok).toContain("Post straight to TikTok on Studio");

    const proYouTube = renderToString(createElement(YouTubeButton, { file: dummyFile, status: { configured: true, allowed: false, connected: false, account: null }, refresh: () => {} }));
    expect(proYouTube).toContain("Post and schedule straight to YouTube on Studio");
  });

  it("renders connect button when configured and allowed but not connected", () => {
    const disconnectedTikTok = renderToString(createElement(TikTokButton, { file: dummyFile, status: { configured: true, allowed: true, connected: false, account: null }, refresh: () => {} }));
    expect(disconnectedTikTok).toContain("Connect your TikTok account");

    const disconnectedYouTube = renderToString(createElement(YouTubeButton, { file: dummyFile, status: { configured: true, allowed: true, connected: false, account: null }, refresh: () => {} }));
    expect(disconnectedYouTube).toContain("Connect your YouTube channel");
  });

  it("renders WhatsApp and Instagram share buttons with proper titles", () => {
    const wa = renderToString(createElement(WhatsAppButton, { file: dummyFile }));
    expect(wa).toContain("WhatsApp");

    const ig = renderToString(createElement(InstagramButton, { file: dummyFile }));
    expect(ig).toContain("Instagram");
  });
});
