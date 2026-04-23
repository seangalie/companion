import { describe, it, expect } from "vitest";

import { parseArgs, helpText } from "./args";

describe("parseArgs", () => {
  it("returns defaults with no arguments", () => {
    const result = parseArgs([]);
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
    expect(result.auto).toBe(false);
    expect(result.listTasks).toBe(false);
    expect(result.categories.size).toBe(0);
  });

  it("parses -h", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("parses -v", () => {
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  it("parses --version", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("parses -a", () => {
    expect(parseArgs(["-a"]).auto).toBe(true);
  });

  it("parses --auto", () => {
    expect(parseArgs(["--auto"]).auto).toBe(true);
  });

  it("parses -l", () => {
    expect(parseArgs(["-l"]).listTasks).toBe(true);
  });

  it("parses --list-tasks", () => {
    expect(parseArgs(["--list-tasks"]).listTasks).toBe(true);
  });

  it("parses category flags", () => {
    const flags: [string, string][] = [
      ["-u", "update"],
      ["--update", "update"],
      ["-m", "mas"],
      ["--mas", "mas"],
      ["-b", "brew"],
      ["--brew", "brew"],
      ["-n", "npm"],
      ["--npm", "npm"],
      ["-p", "python"],
      ["--python", "python"],
      ["-r", "rust"],
      ["--rust", "rust"],
      ["-c", "composer"],
      ["--composer", "composer"],
      ["-d", "docker"],
      ["--docker", "docker"]
    ];

    for (const [flag, category] of flags) {
      const result = parseArgs([flag]);
      expect(result.categories.has(category as any), `${flag} -> ${category}`).toBe(true);
    }
  });

  it("combines multiple category flags", () => {
    const result = parseArgs(["-b", "-n", "-r"]);
    expect(result.categories).toEqual(new Set(["brew", "npm", "rust"]));
  });

  it("throws on unknown argument", () => {
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument: --unknown");
  });
});

describe("helpText", () => {
  it("includes all category flags", () => {
    const text = helpText();
    expect(text).toContain("--update");
    expect(text).toContain("--mas");
    expect(text).toContain("--brew");
    expect(text).toContain("--npm");
    expect(text).toContain("--python");
    expect(text).toContain("--rust");
    expect(text).toContain("--composer");
    expect(text).toContain("--docker");
  });
});
