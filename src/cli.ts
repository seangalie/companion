#!/usr/bin/env node

import { helpText, parseArgs } from "./args";
import { resolveTaskStates, selectAutoTasks, selectTasksByCategories } from "./catalog";
import { runPlainMode, printTaskList } from "./plain";
import { runTui } from "./tui";
import { getVersion } from "./version";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const version = getVersion();

  if (args.help) {
    console.log(helpText());
    return;
  }

  if (args.version) {
    console.log(version);
    return;
  }

  const states = await resolveTaskStates();

  if (args.listTasks) {
    printTaskList(states);
    return;
  }

  if (args.auto || args.categories.size > 0) {
    const selected = args.auto ? selectAutoTasks(states) : selectTasksByCategories(states, args.categories);
    process.exitCode = await runPlainMode(selected);
    return;
  }

  await runTui(states, version);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
