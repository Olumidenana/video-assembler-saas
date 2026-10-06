/**
 * Finds the speaker in sampled frames with MediaPipe's face detector, run in
 * the browser from our own origin (the editor is cross-origin isolated). Only
 * decoded stills are looked at, never uploaded. Browser only.
 */
import type { FaceDetector } from "@mediapipe/tasks-vision";
import type { FaceSample } from "./reframe";

let detector: Promise<FaceDetector> | null = null;

function load(): Promise<FaceDetector> {
  detector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(`${window.location.origin}/vendor/mediapipe`);
    return FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${window.location.origin}/models/blaze_face_short_range.tflite`, delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    });
  })();
  detector.catch(() => {
    detector = null;
  });
  return detector;
}

/**
 * The horizontal center (0..1) of the main face in each frame: the largest,
 * or when two are close in size, the one nearest the previous pick, so the
 * frame doesn't flip between people. Null where there's no face.
 */
export async function faceCenters(frames: { t: number; jpeg: Uint8Array | null }[]): Promise<FaceSample[]> {
  const d = await load();
  const out: FaceSample[] = [];
  let previous: number | null = null;
  for (const f of frames) {
    if (!f.jpeg) {
      out.push({ t: f.t, x: null });
      continue;
    }
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(f.jpeg)], { type: "image/jpeg" }));
    try {
      const faces = await detectAll(d, bitmap);
      if (faces.length === 0) {
        out.push({ t: f.t, x: null });
        continue;
      }
      const biggest = Math.max(...faces.map((c) => c.size));
      const contenders = faces.filter((c) => c.size >= biggest * 0.7);
      const prev: number | null = previous;
      const pick: { x: number; size: number } = prev === null ? contenders.sort((a, b) => b.size - a.size)[0] : contenders.sort((a, b) => Math.abs(a.x - prev) - Math.abs(b.x - prev))[0];
      previous = pick.x;
      out.push({ t: f.t, x: pick.x });
    } finally {
      bitmap.close();
    }
  }
  return out;
}

/**
 * Faces in a frame as horizontal centers (0..1) and sizes. The detector is
 * built for faces that fill a good part of the picture; in wide shots (a
 * two-person podcast) faces are small, so when the whole frame finds none it
 * looks again at the overlapping left and right halves, where each face is
 * twice as big.
 */
async function detectAll(d: FaceDetector, bitmap: ImageBitmap): Promise<{ x: number; size: number }[]> {
  const W = bitmap.width;
  const read = (img: ImageBitmap, offset: number, scale: number) =>
    d.detect(img).detections.flatMap((det) =>
      det.boundingBox ? [{ x: (offset + ((det.boundingBox.originX + det.boundingBox.width / 2) / img.width) * scale * W) / W, size: det.boundingBox.width * det.boundingBox.height * scale * scale }] : [],
    );
  const whole = read(bitmap, 0, 1);
  if (whole.length) return whole;
  const found: { x: number; size: number }[] = [];
  for (const from of [0, 0.4]) {
    const tile = await createImageBitmap(bitmap, Math.round(from * W), 0, Math.round(0.6 * W), bitmap.height);
    try {
      for (const face of read(tile, from * W, 0.6)) if (!found.some((g) => Math.abs(g.x - face.x) < 0.05)) found.push(face);
    } finally {
      tile.close();
    }
  }
  return found;
}
