import { describe, it, expect } from "vitest";

import { runTasks } from "./runner";
import type { RunnerEvent, TaskDefinition } from "./types";

function makeTask(id: string, behavior: (onOutput: (line: string) => void) => Promise<void>): TaskDefinition {
  return {
    id,
    title: id,
    summary: "",
    categories: [],
    defaultSelected: true,
    commandLabel: id,
    checkAvailability: async () => ({ available: true }),
    run: async ({ onOutput }) => behavior(onOutput)
  };
}

const noopRequestInput = async () => "";

describe("runTasks", () => {
  it("runs tasks sequentially and emits events", async () => {
    const events: RunnerEvent[] = [];
    const tasks = [
      makeTask("a", async (onOutput) => onOutput("hello from a")),
      makeTask("b", async (onOutput) => onOutput("hello from b"))
    ];

    const results = await runTasks(tasks, new AbortController().signal, (e) => events.push(e));

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("success");
    expect(results[1].status).toBe("success");

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "task-start",
      "task-output",
      "task-finish",
      "task-start",
      "task-output",
      "task-finish",
      "run-finish"
    ]);
  });

  it("marks a failing task as failed", async () => {
    const tasks = [
      makeTask("fail", async () => {
        throw new Error("boom");
      })
    ];

    const results = await runTasks(tasks, new AbortController().signal, () => {});

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
    expect(results[0].error?.message).toBe("boom");
  });

  it("stops on abort and marks as cancelled", async () => {
    const controller = new AbortController();
    const tasks = [
      makeTask("slow", async () => {
        controller.abort();
        throw new Error("aborted");
      }),
      makeTask("skipped", async () => {})
    ];

    const results = await runTasks(tasks, controller.signal, () => {});

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("cancelled");
  });

  it("records duration for each task", async () => {
    const tasks = [makeTask("quick", async () => {})];

    const results = await runTasks(tasks, new AbortController().signal, () => {});

    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
