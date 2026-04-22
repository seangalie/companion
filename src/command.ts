import { spawn, spawnSync } from "node:child_process";

import { trimLines } from "./utils";

export interface CommandSpec {
  command: string;
  args?: string[];
}

export async function commandExists(command: string): Promise<boolean> {
  const result = spawnSync("which", [command], {
    stdio: "ignore"
  });

  return result.status === 0;
}

export async function runCommandStreaming(
  spec: CommandSpec,
  options: {
    signal: AbortSignal;
    onLine: (line: string) => void;
  }
): Promise<void> {
  const { command, args = [] } = spec;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const flushBuffer = (buffer: string): string => {
      const normalized = buffer.replace(/\r/g, "");
      const segments = normalized.split("\n");
      const remainder = segments.pop() ?? "";

      for (const segment of segments) {
        const line = segment.trimEnd();
        if (line.length > 0) {
          options.onLine(line);
        }
      }

      return remainder;
    };

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      options.signal.removeEventListener("abort", abortHandler);

      const trailing = [...trimLines(stdoutBuffer), ...trimLines(stderrBuffer)];
      for (const line of trailing) {
        if (line.length > 0) {
          options.onLine(line);
        }
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const abortHandler = () => {
      child.kill("SIGTERM");
    };

    options.signal.addEventListener("abort", abortHandler);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = flushBuffer(stdoutBuffer);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      stderrBuffer = flushBuffer(stderrBuffer);
    });

    child.on("error", (error) => finish(error));

    child.on("close", (code, signal) => {
      if (signal === "SIGTERM" && options.signal.aborted) {
        finish(new Error("Command cancelled"));
        return;
      }

      if (code === 0) {
        finish();
        return;
      }

      finish(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

export async function runCommandCapture(spec: CommandSpec): Promise<string> {
  const { command, args = [] } = spec;

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 1}`));
    });
  });
}
