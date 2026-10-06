/**
 * "Follow the speaker": reframing a wide video to vertical by keeping the
 * person talking in frame, the way the big clipping tools do. Face positions
 * are sampled a couple of times a second (face-track.ts); this turns them
 * into a camera path that moves like an operator would (holds still, then
 * glides to the new subject; never jitters) and into the crop expression
 * FFmpeg follows. Pure functions, unit-tested.
 */

/** One sample: time in the segment, and the face's horizontal center (0..1), or null when none was found. */
export interface FaceSample {
  t: number;
  x: number | null;
}

/** A point on the camera path: at time t (segment seconds) the crop is centered on x (0..1 of the source width). */
export interface PathKey {
  t: number;
  x: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Smooths face samples into a few camera moves. Gaps (no face, a cutaway)
 * keep the last framing; a move only happens when the subject sits more than
 * `deadZone` (of the source width) away for at least two samples in a row,
 * and takes `glide` seconds, so a nod or a gesture never moves the frame; a
 * jump bigger than `snap` (another person, a camera switch) is a cut.
 */
export function cameraPath(
  samples: FaceSample[],
  {
    deadZone = 0.08,
    glide = 0.4,
    snap = 0.25,
    cuts = [],
  }: {
    deadZone?: number;
    glide?: number;
    snap?: number;
    /** Shot changes (segment seconds): a cut to another person happens on the shot change, not when the next sample sees it. */
    cuts?: number[];
  } = {},
): PathKey[] {
  const known = samples.filter((s): s is PathKey => s.x !== null);
  if (known.length === 0) return [{ t: 0, x: 0.5 }];
  // Median of three removes single-frame detector glitches.
  const x = known.map((s, i) => {
    const w = known.slice(Math.max(0, i - 1), i + 2).map((k) => k.x).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  const keys: PathKey[] = [{ t: 0, x: r3(x[0]) }];
  let at = x[0];
  for (let i = 1; i < known.length; i++) {
    const far = Math.abs(x[i] - at) > deadZone;
    const settled = i + 1 < known.length ? Math.abs(x[i + 1] - x[i]) < deadZone : true;
    if (!far || !settled) continue;
    const t = known[i].t;
    const last = keys[keys.length - 1];
    // A big jump is a different person or a camera switch: cut to them, as an editor would. Small shifts glide.
    let to = t;
    if (Math.abs(x[i] - at) > snap) {
      const cut = cuts.find((c) => c > known[i - 1].t && c <= t);
      if (cut !== undefined) to = cut;
    }
    const from = Math.abs(x[i] - at) > snap ? Math.max(last.t, to - 1 / 30) : Math.max(last.t, to - glide);
    if (from > last.t) keys.push({ t: r3(from), x: r3(at) });
    keys.push({ t: r3(to), x: r3(x[i]) });
    at = x[i];
  }
  return keys;
}

/**
 * The crop's left edge over time, as an FFmpeg expression: piecewise linear
 * between the path's keys, clamped to the frame. `iw`/`ow` are the crop
 * filter's input and output widths, `t` the frame time.
 */
export function cropXExpression(path: PathKey[]): string {
  const center = (x: number) => `${x.toFixed(4)}*iw`;
  let expr = center(path[path.length - 1].x);
  for (let i = path.length - 2; i >= 0; i--) {
    const a = path[i];
    const b = path[i + 1];
    const seg =
      b.x === a.x || b.t <= a.t
        ? center(a.x)
        : `(${a.x.toFixed(4)}+${(b.x - a.x).toFixed(4)}*(t-${a.t.toFixed(3)})/${(b.t - a.t).toFixed(3)})*iw`;
    expr = `if(lt(t,${b.t.toFixed(3)}),${seg},${expr})`;
  }
  return `clip(${expr}-ow/2,0,iw-ow)`;
}
