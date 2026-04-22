import { describe, it, expect } from "vitest";

import { formatBytes, trimLines, formatDuration } from "./utils";

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kibibytes", () => {
    expect(formatBytes(1024)).toBe("1.00 KiB");
    expect(formatBytes(1536)).toBe("1.50 KiB");
  });

  it("formats mebibytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MiB");
  });

  it("formats gibibytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GiB");
  });

  it("formats tebibytes", () => {
    expect(formatBytes(1024 ** 4)).toBe("1.00 TiB");
  });
});

describe("trimLines", () => {
  it("splits and trims lines", () => {
    expect(trimLines("foo  \nbar  \n")).toEqual(["foo", "bar"]);
  });

  it("handles empty string", () => {
    expect(trimLines("")).toEqual([]);
  });

  it("preserves non-trailing empty lines", () => {
    expect(trimLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  it("handles windows line endings", () => {
    expect(trimLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

describe("formatDuration", () => {
  it("formats sub-second durations as milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats durations >= 1s as seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(60000)).toBe("60.0s");
  });
});
