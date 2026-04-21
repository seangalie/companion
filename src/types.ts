export type TaskCategory =
  | "update"
  | "brew"
  | "npm"
  | "python"
  | "rust"
  | "composer"
  | "docker";

export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface TaskAvailability {
  available: boolean;
  reason?: string;
}

export interface TaskDefinition {
  id: string;
  title: string;
  summary: string;
  categories: TaskCategory[];
  defaultSelected: boolean;
  commandLabel: string;
  checkAvailability: () => Promise<TaskAvailability>;
  run: (context: TaskRunContext) => Promise<void>;
}

export interface TaskState {
  definition: TaskDefinition;
  availability: TaskAvailability;
}

export interface TaskRunContext {
  signal: AbortSignal;
  onOutput: (line: string) => void;
  runCommandForeground: (command: string, args?: string[]) => Promise<void>;
}

export interface TaskResult {
  task: TaskDefinition;
  status: TaskStatus;
  durationMs: number;
  error?: Error;
}

export type RunnerEvent =
  | {
      type: "task-start";
      task: TaskDefinition;
      index: number;
      total: number;
    }
  | {
      type: "task-output";
      task: TaskDefinition;
      line: string;
    }
  | {
      type: "task-finish";
      task: TaskDefinition;
      status: TaskStatus;
      durationMs: number;
      error?: Error;
    }
  | {
      type: "run-finish";
      results: TaskResult[];
    };

export interface SystemSnapshot {
  hostname: string;
  osName: string;
  osVersion: string;
  architecture: string;
  uptime: string;
  memory: string;
  diskUsage: string;
  refreshedAt: Date;
}

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  auto: boolean;
  listTasks: boolean;
  categories: Set<TaskCategory>;
}
