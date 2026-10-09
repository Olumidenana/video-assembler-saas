/**
 * Client-side TikTok upload:
 * Uploads finished videos straight from creator's device to TikTok using the
 * Content Posting API (FILE_UPLOAD chunked upload). A server relay fallback
 * is used only if cross-origin isolation (COOP/COEP) prevents direct browser PUTs
 * to TikTok's upload CDN.
 */

export interface TikTokPost {
  title?: string;
  directPost?: boolean;
}

export class TikTokError extends Error {
  constructor(
    public code: "not_connected" | "upgrade" | "sign_in" | "not_configured" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export interface ChunkRange {
  index: number;
  start: number;
  end: number; // inclusive
  size: number;
  total: number;
}

/**
 * Calculates byte chunk ranges for TikTok's Content Posting API.
 * TikTok requires chunk size >= 5MB (5,242,880 bytes) for all chunks except the final one.
 */
export function calculateChunks(totalSize: number, targetChunkSize = 10 * 1024 * 1024): { chunkSize: number; chunks: ChunkRange[] } {
  if (totalSize <= 0) {
    return { chunkSize: 0, chunks: [] };
  }
  const minChunk = 5 * 1024 * 1024;
  const chunkSize = totalSize <= targetChunkSize ? totalSize : Math.max(minChunk, targetChunkSize);
  const chunks: ChunkRange[] = [];
  let start = 0;
  let index = 0;
  while (start < totalSize) {
    const end = Math.min(start + chunkSize - 1, totalSize - 1);
    chunks.push({
      index,
      start,
      end,
      size: end - start + 1,
      total: totalSize,
    });
    start = end + 1;
    index++;
  }
  return { chunkSize, chunks };
}

export async function uploadToTikTok(
  blob: Blob,
  post: TikTokPost = {},
  onProgress?: (ratio: number) => void,
): Promise<{ publishId: string; mode: "inbox" | "direct" }> {
  const tokenRes = await fetch("/api/tiktok/token", { method: "POST" });
  const token = (await tokenRes.json().catch(() => null)) as {
    accessToken?: string;
    error?: TikTokError["code"];
  } | null;

  if (!tokenRes.ok || !token?.accessToken) {
    throw new TikTokError(token?.error ?? "failed", "Couldn't get permission to post to TikTok.");
  }

  const { chunkSize, chunks } = calculateChunks(blob.size);
  const mode = post.directPost ? "direct" : "inbox";
  const initEndpoint = post.directPost
    ? "https://open.tiktokapis.com/v2/post/publish/video/init/"
    : "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";

  const initBody: Record<string, unknown> = {
    source_info: {
      source: "FILE_UPLOAD",
      video_size: blob.size,
      chunk_size: chunkSize,
      total_chunk_count: chunks.length,
    },
  };
  if (post.directPost) {
    initBody.post_info = {
      title: (post.title || "New video").slice(0, 150),
      privacy_level: "SELF_ONLY",
      disable_duet: false,
      disable_stitch: false,
      disable_comment: false,
      video_cover_timestamp_ms: 1000,
    };
  }

  const initRes = await fetch(initEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(initBody),
  });

  const initJson = (await initRes.json().catch(() => null)) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  } | null;

  if (!initRes.ok || !initJson?.data?.upload_url || !initJson?.data?.publish_id) {
    const msg = initJson?.error?.message || `Init failed (${initRes.status})`;
    throw new TikTokError("failed", `TikTok didn't accept the upload request: ${msg}`);
  }

  const { upload_url, publish_id } = initJson.data;
  let bytesSent = 0;

  for (const chunk of chunks) {
    const chunkBlob = blob.slice(chunk.start, chunk.end + 1);
    const contentRange = `bytes ${chunk.start}-${chunk.end}/${chunk.total}`;

    let success = false;

    // First attempt: direct browser upload
    try {
      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
          "Content-Type": "video/mp4",
        },
        body: chunkBlob,
      });
      if (putRes.ok || putRes.status === 308) {
        success = true;
      }
    } catch {
      // CORS or network error from cross-origin-isolated editor: fall back to streaming relay
    }

    // Fallback: server streaming relay
    if (!success) {
      const relayRes = await fetch(`/api/tiktok/relay?url=${encodeURIComponent(upload_url)}`, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
          "Content-Type": "video/mp4",
        },
        body: chunkBlob,
      });
      if (!relayRes.ok && relayRes.status !== 308) {
        throw new TikTokError("failed", `Failed to upload chunk ${chunk.index + 1}/${chunks.length} to TikTok.`);
      }
    }

    bytesSent += chunk.size;
    onProgress?.(bytesSent / blob.size);
  }

  onProgress?.(1);
  return { publishId: publish_id, mode };
}
