/** Distinct colors so segments from the same source file are easy to spot. */
const PALETTE = ["#8b7bff", "#ff7ac6", "#3ddc97", "#fbbf24", "#5cc8ff", "#ff9a5c", "#c084fc", "#94e05c"];

export function clipColors(clipIds: string[]): Record<string, string> {
  return Object.fromEntries(clipIds.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}
