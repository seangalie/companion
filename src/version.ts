import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PackageMetadata {
  version?: string;
}

export function getVersion(): string {
  try {
    const packagePath = resolve(__dirname, "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as PackageMetadata;
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
