/**
 * Uploads a finished clip from the creator's device straight to their YouTube
 * channel (resumable upload), with a short-lived token from our server. A
 * scheduled post is uploaded private with a publish time; YouTube makes it
 * public then. Browser only.
 */

export interface YouTubePost {
  title: string;
  description: string;
  /** Publish later (YouTube switches it to public at this time). */
  publishAt?: Date | null;
  privacy: "public" | "unlisted" | "private";
}

export class YouTubeError extends Error {
  constructor(
    public code: "not_connected" | "upgrade" | "sign_in" | "not_configured" | "quota" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/** Shorts are vertical and up to 3 minutes; "#Shorts" in the title helps YouTube file it there. */
export function shortsTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim() || "New clip";
  const tagged = /#shorts/i.test(clean) ? clean : `${clean} #Shorts`;
  return tagged.length <= 100 ? tagged : `${clean.slice(0, 100 - 8).trim()} #Shorts`;
}

/** The body YouTube expects for a new video. */
export function videoResource(post: YouTubePost) {
  const scheduled = post.publishAt && post.publishAt.getTime() > Date.now() + 60_000;
  return {
    snippet: { title: shortsTitle(post.title), description: post.description.slice(0, 4900), categoryId: "22" },
    status: {
      privacyStatus: scheduled ? "private" : post.privacy,
      ...(scheduled ? { publishAt: post.publishAt!.toISOString() } : {}),
      selfDeclaredMadeForKids: false,
    },
  };
}

export async function uploadToYouTube(blob: Blob, post: YouTubePost, onProgress?: (ratio: number) => void): Promise<{ id: string; url: string }> {
  const tokenRes = await fetch("/api/youtube/token", { method: "POST" });
  const token = (await tokenRes.json().catch(() => null)) as { accessToken?: string; error?: YouTubeError["code"] } | null;
  if (!tokenRes.ok || !token?.accessToken) throw new YouTubeError(token?.error ?? "failed", "Couldn't get permission to post to YouTube.");

  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": blob.type || "video/mp4",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify(videoResource(post)),
  });
  const location = init.headers.get("Location");
  if (!init.ok || !location) {
    const body = (await init.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    if (/quota/i.test(reason)) throw new YouTubeError("quota", "YouTube's daily upload limit for this site is used up. Try again tomorrow.");
    throw new YouTubeError("failed", `YouTube didn't accept the upload${reason ? ` (${reason})` : ""}.`);
  }

  // XHR for upload progress, which fetch doesn't report.
  const id = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", location);
    xhr.setRequestHeader("Authorization", `Bearer ${token.accessToken}`);
    xhr.setRequestHeader("Content-Type", blob.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as { id?: string };
        if (xhr.status < 300 && json.id) resolve(json.id);
        else reject(new YouTubeError("failed", "YouTube didn't finish the upload."));
      } catch {
        reject(new YouTubeError("failed", "YouTube didn't finish the upload."));
      }
    };
    xhr.onerror = () => reject(new YouTubeError("failed", "The upload was interrupted. Check your connection and try again."));
    xhr.send(blob);
  });
  onProgress?.(1);
  return { id, url: `https://youtube.com/shorts/${id}` };
}
