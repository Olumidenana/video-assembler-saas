import { describe, expect, it } from "vitest";
import { parseCommandLocally, sanitizeActions } from "./actions";

describe("parseCommandLocally", () => {
  it.each([
    ["Make a 30 second highlight", [{ type: "highlights", seconds: 30 }]],
    ["best moments please", [{ type: "highlights", seconds: null }]],
    ["give me a 1 minute recap", [{ type: "highlights", seconds: 60 }]],
    ["remove the silent parts", [{ type: "remove_silence" }]],
    ["cut out the dead air", [{ type: "remove_silence" }]],
    ["split into 15 second parts", [{ type: "split_every", seconds: 15, segment: null }]],
    ["chop it every 30s", [{ type: "split_every", seconds: 30, segment: null }]],
    ["remove the first 5 seconds", [{ type: "cut", segment: null, fromStart: 5, fromEnd: 0 }]],
    ["trim the last 3 secs", [{ type: "cut", segment: null, fromStart: 0, fromEnd: 3 }]],
    ["export as separate files", [{ type: "export", mode: "parts" }]],
    ["start over", [{ type: "reset" }]],
  ])("understands %j", (input, expected) => {
    expect(parseCommandLocally(input)).toEqual(expected);
  });

  it("chains several commands", () => {
    expect(parseCommandLocally("remove silences, then make a 20s highlight and export")).toEqual([
      { type: "remove_silence" },
      { type: "highlights", seconds: 20 },
      { type: "export", mode: null },
    ]);
  });

  it("hands anything it doesn't understand to the assistant", () => {
    expect(parseCommandLocally("put the funny part with the dog first")).toBeNull();
    expect(parseCommandLocally("remove silences and make it look cinematic")).toBeNull();
  });
});

describe("sanitizeActions", () => {
  it("keeps valid actions and drops malformed ones", () => {
    expect(
      sanitizeActions([
        { type: "highlights", seconds: 30 },
        { type: "split_every", seconds: -4 },
        { type: "keep_range", segment: 2, start: 10, end: 5 },
        { type: "move_segment", segment: 3, to: 1 },
        { type: "rm -rf" },
        { type: "export", mode: "parts" },
      ]),
    ).toEqual([
      { type: "highlights", seconds: 30 },
      { type: "move_segment", segment: 3, to: 1 },
      { type: "export", mode: "parts" },
    ]);
  });

  it("returns nothing for non-arrays", () => {
    expect(sanitizeActions("nope")).toEqual([]);
  });
});
