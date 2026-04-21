import { collectSnapshot } from "./system";
import type { TaskDefinition, TaskResult, TaskState } from "./types";
import { formatDuration } from "./utils";
import { runTasks } from "./runner";
import { runCommandForeground } from "./command";

export function printTaskList(states: TaskState[]): void {
  for (const state of states) {
    const status = state.availability.available ? "ready" : state.availability.reason ?? "unavailable";
    console.log(
      `${state.definition.id.padEnd(24)} ${state.definition.title.padEnd(30)} ${status.padEnd(20)} ${state.definition.commandLabel}`
    );
  }
}

export async function runPlainMode(tasks: TaskDefinition[]): Promise<number> {
  if (tasks.length === 0) {
    console.error("No runnable tasks were selected.");
    return 1;
  }

  const snapshot = await collectSnapshot();
  console.log("Companion");
  console.log(`Hostname:   ${snapshot.hostname}`);
  console.log(`OS:         ${snapshot.osName} ${snapshot.osVersion} (${snapshot.architecture})`);
  console.log(`Memory:     ${snapshot.memory}`);
  console.log(`Disk Usage: ${snapshot.diskUsage}`);
  console.log(`Uptime:     ${snapshot.uptime}`);
  console.log("");

  const controller = new AbortController();
  const handleSigInt = () => controller.abort();
  process.once("SIGINT", handleSigInt);

  let results: TaskResult[] = [];

  results = await runTasks(
    tasks,
    controller.signal,
    (event) => {
      switch (event.type) {
        case "task-start":
          console.log(`[${event.index}/${event.total}] ${event.task.title}`);
          console.log(`$ ${event.task.commandLabel}`);
          break;
        case "task-output":
          console.log(event.line);
          break;
        case "task-finish":
          console.log(`-> ${event.status} (${formatDuration(event.durationMs)})`);
          console.log("");
          break;
        case "run-finish":
          results = event.results;
          break;
      }
    },
    {
      runCommandInteractive: (command, args = []) =>
        runCommandForeground(
          {
            command,
            args
          },
          {
            signal: controller.signal
          }
        )
    }
  );

  process.removeListener("SIGINT", handleSigInt);

  const failures = results.filter((result) => result.status === "failed" || result.status === "cancelled").length;
  console.log(`Finished: ${results.length} task(s), ${failures} failure(s)`);

  return failures === 0 ? 0 : 1;
}
