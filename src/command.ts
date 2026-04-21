import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { trimLines } from "./utils";

export interface CommandSpec {
  command: string;
  args?: string[];
}

interface ForegroundSpawnOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit";
}

type SpawnLike = (command: string, args: string[], options: ForegroundSpawnOptions) => ChildProcess;

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

export async function runCommandForeground(
  spec: CommandSpec,
  options: {
    signal: AbortSignal;
    spawnProcess?: SpawnLike;
  }
): Promise<void> {
  const { command, args = [] } = spec;
  const spawnProcess = options.spawnProcess ?? spawn;

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, args, {
      env: process.env,
      stdio: "inherit"
    });

    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      options.signal.removeEventListener("abort", abortHandler);

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

export async function runCommandInteractive(
  spec: CommandSpec,
  options: {
    signal: AbortSignal;
    onLine: (line: string) => void;
    requestInput: (prompt: { text: string; secret: boolean }) => Promise<string>;
  }
): Promise<void> {
  const { command, args = [] } = spec;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let promptInFlight = false;

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

    const maybePrompt = (buffer: string, stream: "stdout" | "stderr"): string => {
      if (promptInFlight) {
        return buffer;
      }

      const prompt = extractPrompt(buffer);
      if (!prompt) {
        return buffer;
      }

      promptInFlight = true;
      options.onLine(prompt.text);

      void options.requestInput(prompt)
        .then((value) => {
          if (!child.stdin.destroyed) {
            child.stdin.write(`${value}\n`);
          }
        })
        .catch((error: unknown) => {
          child.kill("SIGTERM");
          finish(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          promptInFlight = false;
        });

      if (stream === "stdout") {
        stdoutBuffer = "";
      } else {
        stderrBuffer = "";
      }

      return "";
    };

    options.signal.addEventListener("abort", abortHandler);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = flushBuffer(stdoutBuffer);
      stdoutBuffer = maybePrompt(stdoutBuffer, "stdout");
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      stderrBuffer = flushBuffer(stderrBuffer);
      stderrBuffer = maybePrompt(stderrBuffer, "stderr");
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

function extractPrompt(buffer: string): { text: string; secret: boolean } | undefined {
  const cleaned = stripAnsi(buffer).trim();
  if (!cleaned || cleaned.length > 160) {
    return undefined;
  }

  const promptLike =
    /(?:password|passphrase|passcode|pin|verification code|one-time code|otp|token|apple id|username|email)/i.test(cleaned) ||
    /[:?]\s*$/.test(cleaned);

  if (!promptLike) {
    return undefined;
  }

  return {
    text: cleaned,
    secret: /(?:password|passphrase|passcode|pin|verification code|one-time code|otp|token)/i.test(cleaned)
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
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
