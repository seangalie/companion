import { hostname as getNodeHostname } from "node:os";

import { commandExists, runCommandCapture } from "./command";
import type { SystemSnapshot } from "./types";
import { formatBytes } from "./utils";

async function safeCapture(command: string, args: string[]): Promise<string> {
  try {
    return await runCommandCapture({ command, args });
  } catch {
    return "";
  }
}

export async function collectSnapshot(): Promise<SystemSnapshot> {
  const [osName, osVersion, architecture, uptime, diskRaw, vmStatRaw, memoryPressureRaw] = await Promise.all([
    safeCapture("sw_vers", ["-productName"]),
    safeCapture("sw_vers", ["-productVersion"]),
    safeCapture("uname", ["-m"]),
    safeCapture("uptime", []),
    getDiskUsageRaw(),
    safeCapture("vm_stat", []),
    safeCapture("memory_pressure", [])
  ]);

  return {
    hostname: getNodeHostname() || process.env.HOSTNAME || process.env.COMPUTERNAME || "Unknown host",
    osName: osName || "macOS",
    osVersion: osVersion || "Unknown version",
    architecture: architecture || "Unknown arch",
    uptime: formatUptime(uptime),
    memory: formatMemory(vmStatRaw, memoryPressureRaw),
    diskUsage: formatDiskUsage(diskRaw),
    refreshedAt: new Date()
  };
}

export async function getFastfetchOutput(): Promise<string> {
  if (!(await commandExists("fastfetch"))) {
    throw new Error("fastfetch is not installed");
  }

  return await runCommandCapture({
    command: "fastfetch",
    args: ["--logo", "none", "--pipe", "true", "--show-errors", "false"]
  });
}

async function getDiskUsageRaw(): Promise<string> {
  const primary = await safeCapture("df", ["-k", "/System/Volumes/Data"]);
  if (primary) {
    return primary;
  }

  return await safeCapture("df", ["-k", "/"]);
}

function formatUptime(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Unavailable";
  }

  const parts = trimmed.split(" up ");
  if (parts.length >= 2) {
    return `Up ${parts.slice(1).join(" up ").trim()}`;
  }

  return trimmed;
}

function formatDiskUsage(raw: string): string {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return "Unavailable";
  }

  const fields = lines[1].trim().split(/\s+/);
  if (fields.length < 5) {
    return "Unavailable";
  }

  const totalBlocks = Number(fields[1]);
  const usedBlocks = Number(fields[2]);
  const availableBlocks = Number(fields[3]);
  const percent = fields[4];

  if (!Number.isFinite(totalBlocks) || !Number.isFinite(usedBlocks) || !Number.isFinite(availableBlocks)) {
    return "Unavailable";
  }

  return `${formatBytes(usedBlocks * 1024)} / ${formatBytes(totalBlocks * 1024)} used (${percent}), ${formatBytes(availableBlocks * 1024)} free`;
}

function formatMemory(vmStatRaw: string, memoryPressureRaw: string): string {
  const totalBytesMatch = memoryPressureRaw.match(/The system has\s+(\d+)/);
  const pageSizeMatch = vmStatRaw.match(/page size of\s+(\d+)\s+bytes/);

  if (!totalBytesMatch || !pageSizeMatch) {
    return "Unavailable";
  }

  const totalBytes = Number(totalBytesMatch[1]);
  const pageSize = Number(pageSizeMatch[1]);
  if (!Number.isFinite(totalBytes) || !Number.isFinite(pageSize)) {
    return "Unavailable";
  }

  const pageCounts = parsePageCounts(vmStatRaw);
  const activePages = pageCounts["Pages active"] ?? 0;
  const wiredPages = pageCounts["Pages wired down"] ?? 0;
  const compressedPages =
    pageCounts["Pages occupied by compressor"] ??
    pageCounts["Pages used by compressor"] ??
    pageCounts["Pages stored in compressor"] ??
    0;

  const usedBytes = Math.min(totalBytes, (activePages + wiredPages + compressedPages) * pageSize);
  const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} used (${usedPercent}%)`;
}

function parsePageCounts(raw: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const line of raw.split(/\r?\n/)) {
    const [label, valuePart] = line.split(":");
    if (!label || !valuePart) {
      continue;
    }

    const cleaned = valuePart.trim().replace(/\.$/, "");
    const value = Number(cleaned.split(/\s+/)[0]);
    if (!Number.isFinite(value)) {
      continue;
    }

    counts[label.replace(/"/g, "").trim()] = value;
  }

  return counts;
}
