import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { GET: connect } = await import("@/app/api/youtube/connect/route");
const { GET: callback } = await import("@/app/api/youtube/callback/route");
const { POST: token } = await import("@/app/api/youtube/token/route");

beforeEach(() => {
  viewer = { user: { id: "u1" }, plan: "studio" };
  row = null;
  fetchMock.mockReset();
  upsert.mockClear();
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
});

describe("YouTube connection", () => {
  it("sends Studio creators to Google's consent screen with a state cookie, offline access and the upload scope", async () => {
    const res = await connect(new NextRequest("https://app.test/api/youtube/connect"));
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("scope")).toContain("youtube.upload");
    expect(to.searchParams.get("access_type")).toBe("offline");
    expect(res.headers.get("set-cookie")).toContain(`yt_state=${to.searchParams.get("state")}`);
  });

  it("keeps other plans out", async () => {
    viewer = { user: { id: "u1" }, plan: "pro" };
    const res = await connect(new NextRequest("https://app.test/api/youtube/connect"));
    expect(res.headers.get("location")).toContain("/youtube-connected?error=upgrade");
    expect((await token()).status).toBe(402);
  });

  it("rejects a callback whose state doesn't match, and saves the permission when it does", async () => {
    const bad = await callback(new NextRequest("https://app.test/api/youtube/callback?code=c&state=x", { headers: { cookie: "yt_state=y" } }));
    expect(bad.headers.get("location")).toContain("error=state");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ snippet: { title: "My Channel" } }] })));
    const ok = await callback(new NextRequest("https://app.test/api/youtube/callback?code=c&state=s", { headers: { cookie: "yt_state=s" } }));
    expect(ok.headers.get("location")).toContain("ok=1");
    expect(upsert).toHaveBeenCalledWith({ user_id: "u1", provider: "youtube", refresh_token: "rt", account_name: "My Channel" }, { onConflict: "user_id,provider" });
  });

  it("hands the browser a short-lived token, never the refresh token", async () => {
    expect((await token()).status).toBe(409);
    row = { refresh_token: "rt", account_name: "My Channel" };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh", expires_in: 3599 })));
    const res = await token();
    expect(await res.json()).toEqual({ accessToken: "fresh", expiresIn: 3599 });
  });
});
