import { describe, expect, it } from "vitest";
import { DEFAULT_SPEECH, migrateSpeech, pickModel, speechKey } from "./transcribe";

describe("pickModel", () => {
  it("uses the English-only model for English captions", () => {
    expect(pickModel({ language: "en", translate: false, quality: "standard" }, false)).toBe("Xenova/whisper-base.en");
  });

  it("uses a multilingual model for other languages, auto-detect and translation", () => {
    expect(pickModel({ language: "ja", translate: false, quality: "standard" }, false)).toBe("Xenova/whisper-base");
    expect(pickModel(DEFAULT_SPEECH, false)).toBe("Xenova/whisper-base");
    expect(pickModel({ language: "en", translate: true, quality: "standard" }, false)).toBe("Xenova/whisper-base");
  });

  it("goes bigger for high accuracy and smaller on weak devices", () => {
    expect(pickModel({ language: "yo", translate: false, quality: "high" }, false)).toBe("Xenova/whisper-small");
    expect(pickModel({ language: "yo", translate: false, quality: "high" }, true)).toBe("Xenova/whisper-base");
    expect(pickModel({ language: "en", translate: false, quality: "standard" }, true)).toBe("Xenova/whisper-tiny.en");
  });
});

describe("migrateSpeech", () => {
  it("upgrades the old English / Other setting", () => {
    expect(migrateSpeech("english")).toEqual({ language: "en", translate: false, quality: "standard" });
    expect(migrateSpeech("other")).toEqual(DEFAULT_SPEECH);
  });

  it("keeps valid saved options and rejects unknown languages", () => {
    expect(migrateSpeech({ language: "ja", translate: true, quality: "high" })).toEqual({ language: "ja", translate: true, quality: "high" });
    expect(migrateSpeech({ language: "xx" }).language).toBe("auto");
    expect(migrateSpeech(undefined)).toEqual(DEFAULT_SPEECH);
  });
});

it("gives different transcript keys for different settings", () => {
  expect(speechKey(DEFAULT_SPEECH)).not.toBe(speechKey({ ...DEFAULT_SPEECH, translate: true }));
});
