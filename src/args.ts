import type { ParsedArgs, TaskCategory } from "./types";

const categoryFlags: Record<string, TaskCategory> = {
  "-u": "update",
  "--update": "update",
  "-m": "mas",
  "--mas": "mas",
  "-b": "brew",
  "--brew": "brew",
  "-n": "npm",
  "--npm": "npm",
  "-p": "python",
  "--python": "python",
  "-r": "rust",
  "--rust": "rust",
  "-c": "composer",
  "--composer": "composer",
  "-d": "docker",
  "--docker": "docker"
};

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
    version: false,
    auto: false,
    listTasks: false,
    categories: new Set<TaskCategory>()
  };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      parsed.version = true;
      continue;
    }

    if (arg === "-a" || arg === "--auto") {
      parsed.auto = true;
      continue;
    }

    if (arg === "-l" || arg === "--list-tasks") {
      parsed.listTasks = true;
      continue;
    }

    if (arg in categoryFlags) {
      parsed.categories.add(categoryFlags[arg]);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function helpText(): string {
  return [
    "companion",
    "",
    "Usage:",
    "  companion                      Launch the TUI",
    "  companion -h, --help           Display CLI usage help",
    "  companion -v, --version        Display console version",
    "  companion -a, --auto           Run entire task catalog",
    "  companion -u, --update         Run macOS software update tasks",
    "  companion -m, --mas            Run Mac App Store upgrade tasks",
    "  companion -b, --brew           Run brew update, upgrade, and cleanup tasks",
    "  companion -n, --npm            Run npm update tasks",
    "  companion -p, --python         Run Python (pipx) update tasks",
    "  companion -r, --rust           Run Rust update tasks",
    "  companion -c, --composer       Run composer update tasks",
    "  companion -d, --docker         Run docker update tasks",
    "  companion -l, --list-tasks     List the task catalog",
    "",
    "With no flags, companion launches the interactive TUI."
  ].join("\n");
}
