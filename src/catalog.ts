import { commandExists, runCommandCapture, runCommandStreaming } from "./command";
import type { TaskAvailability, TaskCategory, TaskDefinition, TaskState } from "./types";

async function requiresCommands(...commands: string[]): Promise<TaskAvailability> {
  for (const command of commands) {
    if (!(await commandExists(command))) {
      return {
        available: false,
        reason: `${command} not found`
      };
    }
  }

  return { available: true };
}

async function requiresDockerDaemon(): Promise<TaskAvailability> {
  const cliAvailability = await requiresCommands("docker");
  if (!cliAvailability.available) {
    return cliAvailability;
  }

  try {
    await runCommandCapture({
      command: "docker",
      args: ["info", "--format", "{{.ServerVersion}}"]
    });

    return { available: true };
  } catch {
    return {
      available: false,
      reason: "docker daemon not running"
    };
  }
}

function shellTask(options: {
  id: string;
  title: string;
  summary: string;
  categories: TaskCategory[];
  commandLabel: string;
  command: string;
  args: string[];
  requirements: string[];
  checkAvailability?: () => Promise<TaskAvailability>;
}): TaskDefinition {
  return {
    id: options.id,
    title: options.title,
    summary: options.summary,
    categories: options.categories,
    defaultSelected: true,
    commandLabel: options.commandLabel,
    checkAvailability: options.checkAvailability ?? (() => requiresCommands(...options.requirements)),
    run: async ({ signal, onOutput }) => {
      await runCommandStreaming(
        {
          command: options.command,
          args: options.args
        },
        {
          signal,
          onLine: onOutput
        }
      );
    }
  };
}

const dockerRefreshTask: TaskDefinition = {
  id: "docker-refresh-running",
  title: "Docker container image refresh",
  summary: "Pulls the latest images for running containers and reports which containers should be recreated.",
  categories: ["docker"],
  defaultSelected: true,
  commandLabel: "docker ps + docker pull <running images>",
  checkAvailability: () => requiresDockerDaemon(),
  run: async ({ signal, onOutput }) => {
    const availability = await requiresDockerDaemon();
    if (!availability.available) {
      throw new Error(availability.reason ?? "docker daemon not running");
    }

    const raw = await runCommandCapture({
      command: "docker",
      args: ["ps", "--format", "{{.Image}}\t{{.Names}}"]
    });

    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      onOutput("No running docker containers found.");
      return;
    }

    const images = new Map<string, string[]>();
    for (const line of lines) {
      const [image, name] = line.split("\t");
      if (!image || !name) {
        continue;
      }

      const names = images.get(image) ?? [];
      names.push(name);
      images.set(image, names);
    }

    for (const [image, names] of images.entries()) {
      onOutput(`Pulling ${image} for ${names.join(", ")}`);
      await runCommandStreaming(
        {
          command: "docker",
          args: ["pull", image]
        },
        {
          signal,
          onLine: (line) => onOutput(`[${image}] ${line}`)
        }
      );
    }

    onOutput("Latest images pulled. Recreate containers to apply any updated images.");
  }
};

const catalog: TaskDefinition[] = [
  shellTask({
    id: "softwareupdate",
    title: "macOS software updates",
    summary: "Runs Apple's built-in system updater to install all available macOS updates.",
    categories: ["update"],
    commandLabel: "softwareupdate -i -a",
    command: "softwareupdate",
    args: ["-i", "-a"],
    requirements: ["softwareupdate"]
  }),
  shellTask({
    id: "brew-update",
    title: "Homebrew metadata",
    summary: "Fetches the latest Homebrew formula and cask metadata.",
    categories: ["brew"],
    commandLabel: "brew update",
    command: "brew",
    args: ["update"],
    requirements: ["brew"]
  }),
  shellTask({
    id: "brew-upgrade",
    title: "Homebrew upgrades",
    summary: "Upgrades installed Homebrew formulae and casks.",
    categories: ["brew"],
    commandLabel: "brew upgrade",
    command: "brew",
    args: ["upgrade"],
    requirements: ["brew"]
  }),
  shellTask({
    id: "brew-cleanup",
    title: "Homebrew cleanup",
    summary: "Removes stale Homebrew downloads and outdated package versions.",
    categories: ["brew"],
    commandLabel: "brew cleanup",
    command: "brew",
    args: ["cleanup"],
    requirements: ["brew"]
  }),
  shellTask({
    id: "npm-global",
    title: "Global npm packages",
    summary: "Updates globally installed npm packages.",
    categories: ["npm"],
    commandLabel: "npm update -g",
    command: "npm",
    args: ["update", "-g"],
    requirements: ["npm"]
  }),
  shellTask({
    id: "pipx-upgrade-all",
    title: "pipx upgrades",
    summary: "Upgrades all installed pipx applications.",
    categories: ["python"],
    commandLabel: "pipx upgrade-all",
    command: "pipx",
    args: ["upgrade-all"],
    requirements: ["pipx"]
  }),
  shellTask({
    id: "rustup-update",
    title: "Rust toolchains",
    summary: "Updates installed Rust toolchains and components.",
    categories: ["rust"],
    commandLabel: "rustup update",
    command: "rustup",
    args: ["update"],
    requirements: ["rustup"]
  }),
  shellTask({
    id: "cargo-install-update",
    title: "Cargo install-update",
    summary: "Upgrades installed Cargo binaries via cargo-install-update.",
    categories: ["rust"],
    commandLabel: "cargo install-update -a",
    command: "cargo",
    args: ["install-update", "-a"],
    requirements: ["cargo", "cargo-install-update"]
  }),
  shellTask({
    id: "composer-global-update",
    title: "Composer global packages",
    summary: "Updates globally installed Composer packages.",
    categories: ["composer"],
    commandLabel: "composer global update",
    command: "composer",
    args: ["global", "update"],
    requirements: ["composer"]
  }),
  dockerRefreshTask
];

export async function resolveTaskStates(): Promise<TaskState[]> {
  return await Promise.all(
    catalog.map(async (definition) => ({
      definition,
      availability: await definition.checkAvailability()
    }))
  );
}

export function getCatalog(): TaskDefinition[] {
  return catalog;
}

export function selectAutoTasks(states: TaskState[]): TaskDefinition[] {
  return states.filter((state) => state.availability.available).map((state) => state.definition);
}

export function selectTasksByCategories(states: TaskState[], categories: Set<TaskCategory>): TaskDefinition[] {
  return states
    .filter((state) => state.availability.available)
    .filter((state) => state.definition.categories.some((category) => categories.has(category)))
    .map((state) => state.definition);
}
