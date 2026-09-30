import { ImageResponse } from "next/og";

export const alt = "Anti-Timeout: AI video editor that cuts the best parts, right in your browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Shown when a link to the site is shared on WhatsApp, X, LinkedIn, etc.
export default function OpengraphImage() {
  const clips = [
    ["#8b7bff", 14, false],
    ["#ff7ac6", 18, true],
    ["#5cc8ff", 12, false],
    ["#3ddc97", 20, true],
    ["#c084fc", 11, false],
    ["#fbbf24", 17, true],
  ] as const;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(900px 500px at 20% 0%, #2a2160, #0a0a0d 70%)",
          color: "#f4f4f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontWeight: 600 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(135deg, #9d8fff, #ff7ac6)",
              display: "flex",
            }}
          />
          Anti-Timeout
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, display: "flex", flexDirection: "column" }}>
            <span>Drop in your videos.</span>
            <span style={{ color: "#c4a8ff" }}>AI cuts the best parts.</span>
          </div>
          <div style={{ fontSize: 30, color: "#a3a3b2" }}>Highlights, silence removal and stitching, right in your browser.</div>
        </div>
        <div style={{ display: "flex", gap: 8, height: 64, padding: 8, borderRadius: 16, background: "#121217" }}>
          {clips.map(([color, width, picked], i) => (
            <div
              key={i}
              style={{
                width: `${width}%`,
                borderRadius: 10,
                background: color,
                opacity: picked ? 1 : 0.4,
                border: picked ? "3px solid white" : "3px solid transparent",
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
