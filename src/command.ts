import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Interactive update commands often prompt through a real TTY instead of plain stdout/stderr.
// Companion writes this helper to a temp file and runs it under Python so the TUI can keep
// control while still receiving the prompt text and forwarding the user's response.
const PTY_PROXY_SOURCE = `import os
import pty
import select
import signal
import subprocess
import sys

if len(sys.argv) < 2:
    sys.exit(2)

master_fd, slave_fd = pty.openpty()
proc = subprocess.Popen(
    sys.argv[1:],
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    close_fds=True,
)
os.close(slave_fd)

stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()

os.set_blocking(stdin_fd, False)
os.set_blocking(master_fd, False)

def forward_signal(signum, _frame):
    if proc.poll() is None:
        proc.send_signal(signum)

signal.signal(signal.SIGTERM, forward_signal)
signal.signal(signal.SIGINT, forward_signal)

stdin_open = True

while True:
    read_fds = [master_fd]
    if stdin_open:
        read_fds.append(stdin_fd)

    ready, _, _ = select.select(read_fds, [], [], 0.1)

    if stdin_open and stdin_fd in ready:
        try:
            data = os.read(stdin_fd, 4096)
        except BlockingIOError:
            data = b""

        if data:
            os.write(master_fd, data)
        else:
            stdin_open = False

    if master_fd in ready:
        try:
            data = os.read(master_fd, 4096)
        except OSError:
            data = b""

        if data:
            os.write(stdout_fd, data)
        elif proc.poll() is not None:
            break

    if proc.poll() is not None:
        try:
            data = os.read(master_fd, 4096)
        except OSError:
            data = b""

        if data:
            os.write(stdout_fd, data)
        else:
            break

sys.exit(proc.wait())
`;

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
  const ptyPython = resolvePtyPython();
  const commandToRun = ptyPython ?? command;
  const argsToRun = ptyPython ? [ensurePtyProxyScript(), command, ...args] : args;

  if (!ptyPython) {
    options.onLine("Companion could not find python3 for the PTY helper. Falling back to direct prompt capture.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandToRun, argsToRun, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let promptInFlight = false;

    const flushBuffer = (buffer: string): string => {
      const normalized = normalizeTerminalOutput(buffer);
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
  const candidate = normalizeTerminalOutput(buffer)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!candidate || candidate.length > 320) {
    return undefined;
  }

  const promptLike =
    /(?:password|passphrase|passcode|pin|verification code|one-time code|otp|token|apple id|username|email)/i.test(candidate) ||
    /[:?]\s*$/.test(candidate);

  if (!promptLike) {
    return undefined;
  }

  return {
    text: candidate,
    secret: /(?:password|passphrase|passcode|pin|verification code|one-time code|otp|token)/i.test(candidate)
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function normalizeTerminalOutput(value: string): string {
  return stripAnsi(value)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(/\u0007/g, "");
}

function resolvePtyPython(): string | undefined {
  if (existsSync("/usr/bin/python3")) {
    return "/usr/bin/python3";
  }

  const result = spawnSync("which", ["python3"], {
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (result.status !== 0) {
    return undefined;
  }

  const resolved = result.stdout.toString().trim();
  return resolved.length > 0 ? resolved : "python3";
}

function ensurePtyProxyScript(): string {
  const proxyPath = join(tmpdir(), "companion-pty-proxy.py");
  writeFileSync(proxyPath, PTY_PROXY_SOURCE, "utf8");
  chmodSync(proxyPath, 0o755);
  return proxyPath;
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
