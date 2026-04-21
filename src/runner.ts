import type { RunnerEvent, TaskDefinition, TaskResult, TaskStatus } from "./types";

export async function runTasks(
  tasks: TaskDefinition[],
  signal: AbortSignal,
  onEvent: (event: RunnerEvent) => void
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];

  for (const [index, task] of tasks.entries()) {
    if (signal.aborted) {
      break;
    }

    onEvent({
      type: "task-start",
      task,
      index: index + 1,
      total: tasks.length
    });

    const startedAt = Date.now();
    let status: TaskStatus = "success";
    let error: Error | undefined;

    try {
      await task.run({
        signal,
        onOutput: (line) => {
          onEvent({
            type: "task-output",
            task,
            line
          });
        }
      });
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
      status = signal.aborted ? "cancelled" : "failed";
    }

    const durationMs = Date.now() - startedAt;
    const result: TaskResult = {
      task,
      status,
      durationMs,
      error
    };

    results.push(result);

    onEvent({
      type: "task-finish",
      task,
      status,
      durationMs,
      error
    });
  }

  onEvent({
    type: "run-finish",
    results
  });

  return results;
}
