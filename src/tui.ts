import blessed from "blessed";

import { runCommandInteractive } from "./command";
import { collectSnapshot, getFastfetchOutput } from "./system";
import { runTasks } from "./runner";
import type { RunnerEvent, SystemSnapshot, TaskDefinition, TaskResult, TaskState, TaskStatus } from "./types";
import { formatDuration } from "./utils";

interface TaskRow {
  state: TaskState;
  selected: boolean;
  status: TaskStatus;
  durationMs: number;
  error?: Error;
}

type ScreenMode = "select" | "running" | "done";

interface FooterItem {
  command: string;
  description: string;
}

const palette = {
  shell: "#0B1F33",
  titleBg: "#123B68",
  titleFg: "#F3F8FF",
  subtitle: "#73A9E6",
  border: "#3B82D0",
  text: "#F3F8FF",
  muted: "#6F8BA7",
  label: "#8DA7C4",
  command: "#A9D1FF",
  separator: "#4B6990",
  selectedBg: "#2563B8",
  selectedFg: "#F3F8FF",
  success: "#5BA7F7",
  warning: "#8AC6FF",
  error: "#D1495B"
} as const;

export async function runTui(states: TaskState[], version: string): Promise<void> {
  const app = new CompanionTui(states, version);
  await app.run();
}

class CompanionTui {
  private readonly screen: blessed.Widgets.Screen;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly subtitleBox: blessed.Widgets.BoxElement;
  private readonly queueBox: blessed.Widgets.BoxElement;
  private readonly snapshotBox: blessed.Widgets.BoxElement;
  private readonly bottomBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;
  private readonly overlayBox: blessed.Widgets.BoxElement;
  private readonly overlayContent: blessed.Widgets.BoxElement;
  private readonly overlayFooter: blessed.Widgets.BoxElement;
  private readonly promptBackdrop: blessed.Widgets.BoxElement;
  private readonly promptBox: blessed.Widgets.BoxElement;
  private readonly promptStatusBox: blessed.Widgets.BoxElement;
  private readonly promptMessageBox: blessed.Widgets.BoxElement;
  private readonly promptInput: blessed.Widgets.TextboxElement;
  private readonly promptOutputBox: blessed.Widgets.BoxElement;
  private readonly promptFooterBox: blessed.Widgets.BoxElement;
  private readonly rows: TaskRow[];

  private mode: ScreenMode = "select";
  private cursor = 0;
  private logs: string[] = [];
  private statusMessage = "Choose the update steps to run.";
  private snapshotLoading = true;
  private snapshot?: SystemSnapshot;
  private snapshotError?: string;
  private currentTaskId?: string;
  private currentTaskStartedAt?: number;
  private lastResults: TaskResult[] = [];
  private abortController?: AbortController;
  private fastfetchVisible = false;
  private fastfetchLoading = false;
  private fastfetchError?: string;
  private promptVisible = false;
  private promptInputActive = false;
  private promptMessage = "";
  private promptSecret = false;
  private spinnerIndex = 0;
  private readonly spinnerFrames = ["-", "\\", "|", "/"];
  private resolveExit?: () => void;
  private exited = false;

  constructor(states: TaskState[], private readonly version: string) {
    this.rows = states.map((state) => ({
      state,
      selected: state.availability.available && state.definition.defaultSelected,
      status: "pending",
      durationMs: 0
    }));

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: `Companion v${version}`
    });

    this.headerBox = blessed.box({
      parent: this.screen,
      tags: true,
      style: {
        fg: palette.titleFg,
        bg: palette.titleBg
      }
    });

    this.subtitleBox = blessed.box({
      parent: this.screen,
      tags: true,
      style: {
        fg: palette.subtitle
      }
    });

    this.queueBox = this.createPanel(" Update Queue ");
    this.snapshotBox = this.createPanel(" System Snapshot ");
    this.bottomBox = this.createPanel(" Task Details ");

    this.footerBox = blessed.box({
      parent: this.screen,
      tags: true,
      style: {
        fg: palette.muted
      }
    });

    this.overlayBox = this.createOverlayPanel(" System Details ");
    this.overlayBox.hide();

    this.overlayContent = blessed.box({
      parent: this.overlayBox,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: false,
      vi: false,
      mouse: true,
      scrollbar: {
        ch: " ",
        style: {
          inverse: true
        }
      },
      style: {
        fg: palette.text
      }
    });

    this.overlayFooter = blessed.box({
      parent: this.overlayBox,
      tags: true,
      style: {
        fg: palette.muted
      }
    });

    this.promptBackdrop = blessed.box({
      parent: this.screen,
      hidden: true,
      style: {
        bg: "#050C14"
      }
    });

    this.promptBox = this.createOverlayPanel(" Action Required ");
    this.promptBox.hide();

    this.promptStatusBox = blessed.box({
      parent: this.promptBox,
      tags: true,
      style: {
        fg: palette.warning
      }
    });

    this.promptMessageBox = blessed.box({
      parent: this.promptBox,
      tags: true,
      style: {
        fg: palette.text
      }
    });

    this.promptInput = blessed.textbox({
      parent: this.promptBox,
      keys: true,
      mouse: true,
      style: {
        fg: palette.text,
        bg: palette.shell,
        border: {
          fg: palette.border
        }
      },
      border: "line",
      censor: true
    });

    this.promptOutputBox = blessed.box({
      parent: this.promptBox,
      tags: true,
      border: "line",
      label: this.renderPanelLabel(" Recent Output "),
      style: {
        fg: palette.text,
        border: {
          fg: palette.separator
        }
      },
      padding: {
        left: 1,
        right: 1
      }
    });

    this.promptFooterBox = blessed.box({
      parent: this.promptBox,
      tags: true,
      style: {
        fg: palette.muted
      }
    });

    this.registerKeys();
    this.screen.on("resize", () => this.render());

    setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      if (this.snapshotLoading || this.fastfetchLoading || this.mode === "running") {
        this.render();
      }
    }, 120).unref();
  }

  async run(): Promise<void> {
    await this.refreshSnapshot();
    this.render();

    return await new Promise<void>((resolve) => {
      this.resolveExit = resolve;
      this.screen.render();
    });
  }

  private createPanel(label: string): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      tags: true,
      border: "line",
      label: `{${palette.command}-fg}${label}{/}`,
      style: {
        fg: palette.text,
        border: {
          fg: palette.border
        }
      },
      padding: {
        left: 1,
        right: 1
      }
    });
  }

  private createOverlayPanel(label: string): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      tags: true,
      border: "line",
      label: this.renderPanelLabel(label),
      style: {
        fg: palette.text,
        border: {
          fg: palette.border
        }
      }
    });
  }

  private registerKeys(): void {
    this.screen.key(["C-c"], () => this.exit());

    this.screen.key(["q"], () => {
      if (this.promptVisible && this.promptInputActive) {
        return;
      }

      if (this.promptVisible && this.mode === "running") {
        this.abortController?.abort();
        this.statusMessage = "Cancellation requested. Waiting for the active task to stop...";
        this.render();
        return;
      }

      if (this.fastfetchVisible) {
        this.exit();
        return;
      }

      if (this.mode === "running") {
        this.abortController?.abort();
        this.statusMessage = "Cancellation requested. Waiting for the active task to stop...";
        this.render();
        return;
      }

      this.exit();
    });

    this.screen.key(["up", "k"], () => {
      if (this.promptVisible) {
        return;
      }

      if (this.fastfetchVisible) {
        this.overlayContent.scroll(-1);
        this.screen.render();
        return;
      }

      if (this.mode !== "select") {
        return;
      }

      this.cursor = Math.max(0, this.cursor - 1);
      this.render();
    });

    this.screen.key(["down", "j"], () => {
      if (this.promptVisible) {
        return;
      }

      if (this.fastfetchVisible) {
        this.overlayContent.scroll(1);
        this.screen.render();
        return;
      }

      if (this.mode !== "select") {
        return;
      }

      this.cursor = Math.min(this.rows.length - 1, this.cursor + 1);
      this.render();
    });

    this.screen.key(["pageup"], () => {
      if (this.promptVisible) {
        return;
      }

      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.scroll(-10);
      this.screen.render();
    });

    this.screen.key(["pagedown"], () => {
      if (this.promptVisible) {
        return;
      }

      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.scroll(10);
      this.screen.render();
    });

    this.screen.key(["g"], () => {
      if (this.promptVisible) {
        return;
      }

      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.setScroll(0);
      this.screen.render();
    });

    this.screen.key(["G"], () => {
      if (this.promptVisible) {
        return;
      }

      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.setScrollPerc(100);
      this.screen.render();
    });

    this.screen.key(["space"], () => {
      if (this.promptVisible || this.fastfetchVisible || this.mode !== "select") {
        return;
      }

      const row = this.rows[this.cursor];
      if (!row.state.availability.available) {
        return;
      }

      row.selected = !row.selected;
      this.render();
    });

    this.screen.key(["a"], () => {
      if (this.promptVisible || this.fastfetchVisible || this.mode !== "select") {
        return;
      }

      const allSelected = this.rows
        .filter((row) => row.state.availability.available)
        .every((row) => row.selected);

      for (const row of this.rows) {
        if (row.state.availability.available) {
          row.selected = !allSelected;
        }
      }

      this.render();
    });

    this.screen.key(["enter"], async () => {
      if (this.promptVisible) {
        return;
      }

      if (this.fastfetchVisible) {
        this.fastfetchVisible = false;
        this.render();
        return;
      }

      if (this.mode === "done") {
        this.mode = "select";
        this.statusMessage = "Review the queue or run it again.";
        this.render();
        return;
      }

      if (this.mode !== "select") {
        return;
      }

      await this.startRun();
    });

    this.screen.key(["r"], async () => {
      if (this.promptVisible) {
        return;
      }

      if (this.fastfetchVisible) {
        await this.refreshFastfetch();
        return;
      }

      if (this.mode === "done") {
        await this.startRun();
        return;
      }

      this.statusMessage = "Refreshing system snapshot...";
      this.render();
      await this.refreshSnapshot();
    });

    this.screen.key(["f"], async () => {
      if (this.promptVisible) {
        return;
      }

      this.fastfetchVisible = !this.fastfetchVisible;
      if (this.fastfetchVisible) {
        await this.refreshFastfetch();
      } else {
        this.render();
      }
    });

    this.screen.key(["c"], () => {
      if (this.promptVisible) {
        return;
      }

      if (!this.fastfetchVisible) {
        return;
      }

      this.fastfetchVisible = false;
      this.render();
    });
  }

  private async refreshSnapshot(): Promise<void> {
    this.snapshotLoading = true;
    this.snapshotError = undefined;
    this.render();

    try {
      this.snapshot = await collectSnapshot();
    } catch (error) {
      this.snapshotError = error instanceof Error ? error.message : String(error);
    } finally {
      this.snapshotLoading = false;
      this.render();
    }
  }

  private async refreshFastfetch(): Promise<void> {
    this.fastfetchVisible = true;
    this.fastfetchLoading = true;
    this.fastfetchError = undefined;
    this.overlayContent.setContent("");
    this.render();

    try {
      const output = await getFastfetchOutput();
      this.overlayContent.setContent(output || "No fastfetch output is available.");
      this.overlayContent.setScroll(0);
    } catch (error) {
      this.fastfetchError = error instanceof Error ? error.message : String(error);
      this.overlayContent.setContent(this.fastfetchError);
    } finally {
      this.fastfetchLoading = false;
      this.render();
    }
  }

  private async startRun(): Promise<void> {
    const tasks = this.rows
      .filter((row) => row.selected && row.state.availability.available)
      .map((row) => row.state.definition);

    if (tasks.length === 0) {
      this.statusMessage = "Select at least one available task.";
      this.render();
      return;
    }

    for (const row of this.rows) {
      row.status = "pending";
      row.durationMs = 0;
      row.error = undefined;
    }

    this.logs = [];
    this.currentTaskId = undefined;
    this.currentTaskStartedAt = undefined;
    this.lastResults = [];
    this.mode = "running";
    this.statusMessage = "Running selected update steps...";
    this.abortController = new AbortController();
    this.render();

    const results = await runTasks(
      tasks,
      this.abortController.signal,
      (event) => {
        this.applyRunnerEvent(event);
        this.render();
      },
      {
        runCommandInteractive: (command, args = []) => this.runInteractiveCommand(command, args)
      }
    );

    this.abortController = undefined;
    this.lastResults = results;
    this.mode = "done";

    const failures = results.filter((result) => result.status === "failed" || result.status === "cancelled").length;
    this.statusMessage =
      failures === 0
        ? "Update run finished without command failures."
        : `Update run finished with ${failures} failed task(s).`;

    this.render();
  }

  private applyRunnerEvent(event: RunnerEvent): void {
    switch (event.type) {
      case "task-start":
        this.currentTaskId = event.task.id;
        this.currentTaskStartedAt = Date.now();
        this.appendLog(`$ ${event.task.commandLabel}`);
        this.findRow(event.task.id).status = "running";
        break;
      case "task-output":
        this.appendLog(event.line);
        break;
      case "task-finish": {
        const row = this.findRow(event.task.id);
        row.status = event.status;
        row.durationMs = event.durationMs;
        row.error = event.error;
        if (event.error) {
          this.appendLog(`! ${event.task.title} failed: ${event.error.message}`);
        } else {
          this.appendLog(`+ ${event.task.title} finished in ${formatDuration(event.durationMs)}`);
        }
        this.currentTaskId = undefined;
        this.currentTaskStartedAt = undefined;
        break;
      }
      case "run-finish":
        this.lastResults = event.results;
        this.currentTaskId = undefined;
        this.currentTaskStartedAt = undefined;
        break;
    }
  }

  private render(): void {
    if (this.exited) {
      return;
    }

    const width = this.screen.width as number;
    const height = this.screen.height as number;

    this.headerBox.setFront();
    this.headerBox.top = 0;
    this.headerBox.left = 0;
    this.headerBox.width = width;
    this.headerBox.height = 1;
    this.headerBox.setContent(` {bold}${this.tagFg("Companion", palette.titleFg)}{/bold}`);

    this.subtitleBox.top = 1;
    this.subtitleBox.left = 0;
    this.subtitleBox.width = width;
    this.subtitleBox.height = 1;
    this.subtitleBox.setContent(` ${this.tagFg(`A compact macOS update console  v${this.version}`, palette.subtitle)}`);

    const footerLines = this.getFooterLines();
    const footerHeight = footerLines.length;
    const contentTop = 3;
    const gap = 1;
    const footerTop = height - footerHeight;
    const contentHeight = Math.max(10, footerTop - contentTop - gap);
    const topWidthGap = 1;
    const leftWidth = Math.floor((width - topWidthGap) / 2);
    const rightWidth = width - leftWidth - topWidthGap;

    const queueInnerWidth = Math.max(10, leftWidth - 4);
    const snapshotInnerWidth = Math.max(10, rightWidth - 4);
    const bottomInnerWidth = Math.max(20, width - 4);

    const queueContentLines = this.getQueueLines(queueInnerWidth, Number.MAX_SAFE_INTEGER);
    const snapshotContentLines = this.getSnapshotLines(snapshotInnerWidth);
    const desiredTopHeight = Math.max(queueContentLines.length, snapshotContentLines.length) + 2;
    const minBottomHeight = 10;
    const maxTopHeight = Math.max(8, contentHeight - gap - minBottomHeight);
    const topHeight = Math.max(8, Math.min(desiredTopHeight, maxTopHeight));
    const bottomHeight = Math.max(minBottomHeight, contentHeight - gap - topHeight);
    const visibleQueueLines = Math.max(1, topHeight - 2);

    this.queueBox.top = contentTop;
    this.queueBox.left = 0;
    this.queueBox.width = leftWidth;
    this.queueBox.height = topHeight;
    this.queueBox.setContent(this.getQueueLines(queueInnerWidth, visibleQueueLines).join("\n"));

    this.snapshotBox.top = contentTop;
    this.snapshotBox.left = leftWidth + topWidthGap;
    this.snapshotBox.width = rightWidth;
    this.snapshotBox.height = topHeight;
    this.snapshotBox.setContent(this.getSnapshotLines(snapshotInnerWidth).join("\n"));

    this.bottomBox.top = contentTop + topHeight + gap;
    this.bottomBox.left = 0;
    this.bottomBox.width = width;
    this.bottomBox.height = bottomHeight;
    this.bottomBox.setLabel(this.renderPanelLabel(this.getBottomLabel()));
    this.bottomBox.setContent(this.getBottomLines(bottomInnerWidth, Math.max(1, bottomHeight - 2)).join("\n"));

    this.footerBox.top = footerTop;
    this.footerBox.left = 0;
    this.footerBox.width = width;
    this.footerBox.height = footerHeight;
    this.footerBox.setContent(footerLines.join("\n"));

    if (this.fastfetchVisible) {
      this.overlayBox.show();
      this.overlayBox.top = 0;
      this.overlayBox.left = 0;
      this.overlayBox.width = width;
      this.overlayBox.height = height;
      this.overlayBox.setFront();

      const overlayFooterLines = [this.renderFooterLine([
        { command: "j/k or up/down", description: "scroll" },
        { command: "pgup/pgdn", description: "move faster" },
        { command: "r", description: "refresh" },
        { command: "c", description: "close" },
        { command: "q", description: "quit" }
      ])];
      const overlayInnerWidth = Math.max(1, width - 2);
      const overlayInnerHeight = Math.max(1, height - 2);
      const overlayFooterHeight = overlayFooterLines.length;

      this.overlayFooter.left = 0;
      this.overlayFooter.width = overlayInnerWidth;
      this.overlayFooter.height = overlayFooterHeight;
      this.overlayFooter.top = Math.max(0, overlayInnerHeight - overlayFooterHeight);
      this.overlayFooter.setContent(overlayFooterLines.join("\n"));

      this.overlayContent.left = 0;
      this.overlayContent.top = 0;
      this.overlayContent.width = overlayInnerWidth;
      this.overlayContent.height = Math.max(1, overlayInnerHeight - overlayFooterHeight);
      this.overlayContent.setContent(
        this.fastfetchLoading
          ? `${this.spinnerFrames[this.spinnerIndex]} loading fastfetch output...`
          : this.fastfetchError || this.overlayContent.getContent()
      );
    } else {
      this.overlayBox.hide();
    }

    if (this.promptVisible) {
      this.promptBackdrop.show();
      this.promptBackdrop.top = 0;
      this.promptBackdrop.left = 0;
      this.promptBackdrop.width = width;
      this.promptBackdrop.height = height;
      this.promptBackdrop.setFront();

      this.promptBox.show();
      const promptWidth = Math.max(58, Math.min(width - 8, 88));
      const promptInnerWidth = Math.max(1, promptWidth - 2);
      const promptMessageText = this.promptInputActive
        ? this.promptMessage
        : `Companion is monitoring ${this.getActiveTaskTitle()} for a credential request. Recent output from the running command is shown below.`;
      const promptStatusLines = [
        this.tagFg(
          `${this.spinnerFrames[this.spinnerIndex]} Waiting on ${this.getActiveTaskTitle()} to continue`,
          palette.warning
        ),
        this.tagFg(
          this.promptInputActive
            ? "The update queue is paused until you respond to this prompt."
            : "The update queue is paused while Companion waits for the command to ask for input.",
          palette.muted
        )
      ];
      const promptMessageLines = wrapText(promptMessageText, Math.max(1, promptInnerWidth - 2));
      const outputHeight = this.promptInputActive
        ? Math.min(6, Math.max(4, Math.floor(height / 5)))
        : Math.min(8, Math.max(5, Math.floor(height / 4)));
      const promptOutputWidth = Math.max(1, promptInnerWidth - 4);
      const promptOutputLines = this.getPromptOutputLines(promptOutputWidth, Math.max(1, outputHeight - 2));
      const promptFooter = this.promptInputActive
        ? this.renderFooterLine([
            { command: "enter", description: "submit" },
            { command: "esc", description: "cancel" }
          ])
        : this.renderFooterLine([{ command: "q", description: "cancel current run" }]);
      const inputHeight = this.promptInputActive ? 4 : 0;
      const promptHeight = Math.max(14, promptStatusLines.length + promptMessageLines.length + outputHeight + inputHeight + 5);
      const promptLeft = Math.max(0, Math.floor((width - promptWidth) / 2));
      const promptTop = Math.max(0, Math.floor((height - promptHeight) / 2));
      let cursorTop = 1;

      this.promptBox.top = promptTop;
      this.promptBox.left = promptLeft;
      this.promptBox.width = promptWidth;
      this.promptBox.height = promptHeight;
      this.promptBox.setFront();

      this.promptStatusBox.top = cursorTop;
      this.promptStatusBox.left = 1;
      this.promptStatusBox.width = Math.max(1, promptInnerWidth);
      this.promptStatusBox.height = promptStatusLines.length;
      this.promptStatusBox.setContent(promptStatusLines.join("\n"));
      cursorTop += promptStatusLines.length + 1;

      this.promptMessageBox.top = cursorTop;
      this.promptMessageBox.left = 1;
      this.promptMessageBox.width = Math.max(1, promptInnerWidth);
      this.promptMessageBox.height = Math.max(1, promptMessageLines.length);
      this.promptMessageBox.setContent(promptMessageLines.join("\n"));
      cursorTop += promptMessageLines.length + 1;

      if (this.promptInputActive) {
        this.promptInput.show();
        this.promptInput.top = cursorTop;
        this.promptInput.left = 1;
        this.promptInput.width = Math.max(1, promptInnerWidth);
        this.promptInput.height = 3;
        this.promptInput.secret = this.promptSecret;
        this.promptInput.censor = this.promptSecret;
        cursorTop += 4;
      } else {
        this.promptInput.hide();
      }

      this.promptOutputBox.top = cursorTop;
      this.promptOutputBox.left = 1;
      this.promptOutputBox.width = Math.max(1, promptInnerWidth);
      this.promptOutputBox.height = outputHeight;
      this.promptOutputBox.setContent(promptOutputLines.join("\n"));

      this.promptFooterBox.top = promptHeight - 2;
      this.promptFooterBox.left = 1;
      this.promptFooterBox.width = Math.max(1, promptInnerWidth);
      this.promptFooterBox.height = 1;
      this.promptFooterBox.setContent(promptFooter);
    } else {
      this.promptBackdrop.hide();
      this.promptBox.hide();
      this.promptInput.hide();
    }

    this.screen.render();
  }

  private getQueueLines(innerWidth: number, maxLines: number): string[] {
    const lines = this.rows.map((row, index) => {
      const prefix = this.mode === "select" && index === this.cursor ? "> " : "  ";
      const token =
        this.mode === "select"
          ? row.selected
            ? "[x]"
            : "[ ]"
          : this.statusToken(row.status);
      const unavailable = row.state.availability.available ? "" : ` (${row.state.availability.reason})`;
      let line = `${prefix}${token} ${row.state.definition.title}${unavailable}`;
      line = truncate(line, innerWidth);

      if (this.mode === "select" && index === this.cursor) {
        return `{${palette.selectedFg}-fg}{${palette.selectedBg}-bg}${line}{/}`;
      }

      if (!row.state.availability.available) {
        return this.tagFg(line, palette.muted);
      }

      switch (row.status) {
        case "success":
          return this.tagFg(line, palette.success);
        case "failed":
        case "cancelled":
          return this.tagFg(line, palette.error);
        case "running":
          return this.tagFg(line, palette.warning);
        default:
          return line;
      }
    });

    if (lines.length <= maxLines) {
      return lines;
    }

    const start = Math.max(0, Math.min(this.cursor - Math.floor(maxLines / 2), lines.length - maxLines));
    return lines.slice(start, start + maxLines);
  }

  private getSnapshotLines(innerWidth: number): string[] {
    if (this.snapshotLoading) {
      return [`${this.spinnerFrames[this.spinnerIndex]} collecting current machine data...`];
    }

    if (this.snapshotError) {
      return [this.tagFg(this.snapshotError, palette.error)];
    }

    if (!this.snapshot) {
      return [this.tagFg("No system snapshot is available.", palette.muted)];
    }

    return [
      ...formatLabelValue("Hostname", this.snapshot.hostname, innerWidth),
      ...formatLabelValue("OS", `${this.snapshot.osName} ${this.snapshot.osVersion} (${this.snapshot.architecture})`, innerWidth),
      ...formatLabelValue("Uptime", this.snapshot.uptime, innerWidth),
      ...formatLabelValue("Memory", this.snapshot.memory, innerWidth),
      ...formatLabelValue("Disk Usage", this.snapshot.diskUsage, innerWidth)
    ];
  }

  private getBottomLabel(): string {
    switch (this.mode) {
      case "running":
        return " Live Output ";
      case "done":
        return " Run Summary ";
      default:
        return " Task Details ";
    }
  }

  private getBottomLines(innerWidth: number, maxLines: number): string[] {
    let lines: string[];
    switch (this.mode) {
      case "running":
        lines = this.getRunningLines(innerWidth, maxLines);
        break;
      case "done":
        lines = this.getSummaryLines(innerWidth);
        break;
      default:
        lines = this.getDetailLines(innerWidth);
        break;
    }

    if (lines.length <= maxLines) {
      return lines;
    }

    return lines.slice(lines.length - maxLines);
  }

  private getDetailLines(innerWidth: number): string[] {
    const row = this.rows[this.cursor];
    const lines = [
      ...formatLabelValue("Task", row.state.definition.title, innerWidth),
      ...formatLabelValue("ID", row.state.definition.id, innerWidth),
      ...formatLabelValue("Runs", row.state.definition.commandLabel, innerWidth),
      "",
      ...wrapText(row.state.definition.summary, innerWidth)
    ];

    if (!row.state.availability.available && row.state.availability.reason) {
      lines.push("");
      lines.push(this.tagFg(`Unavailable: ${row.state.availability.reason}`, palette.error));
    }

    if (this.statusMessage) {
      lines.push("");
      lines.push(this.tagFg(this.statusMessage, palette.muted));
    }

    return lines;
  }

  private getRunningLines(innerWidth: number, maxLines: number): string[] {
    const headerLines = [
      ...formatLabelValue(
        "Progress",
        `${this.rows.filter((row) => row.status === "success" || row.status === "failed" || row.status === "cancelled").length} / ${this.rows.filter((row) => row.selected && row.state.availability.available).length} complete`,
        innerWidth
      )
    ];

    if (this.currentTaskId) {
      const row = this.findRow(this.currentTaskId);
      headerLines.push(...formatLabelValue("Current", row.state.definition.title, innerWidth));

      if (this.currentTaskStartedAt) {
        const elapsedMs = Date.now() - this.currentTaskStartedAt;
        const activity = `${this.spinnerFrames[this.spinnerIndex]} still running (${formatDuration(elapsedMs)})`;
        headerLines.push(...formatLabelValue("Activity", activity, innerWidth));
      }
    }

    const footerLines = ["", this.tagFg(this.statusMessage, palette.muted)];
    const maxLogLines = Math.max(1, maxLines - headerLines.length - footerLines.length - 1);
    const visibleLogs = this.logs.slice(-maxLogLines);

    return [
      ...headerLines,
      "",
      ...(visibleLogs.length === 0
        ? [this.tagFg("Waiting for command output...", palette.muted)]
        : visibleLogs.map((line) => truncate(line, innerWidth))),
      ...footerLines
    ];
  }

  private getSummaryLines(innerWidth: number): string[] {
    const successes = this.lastResults.filter((result) => result.status === "success").length;
    const failures = this.lastResults.filter((result) => result.status === "failed").length;
    const cancelled = this.lastResults.filter((result) => result.status === "cancelled").length;

    const lines = [
      ...formatLabelValue("Successful", String(successes), innerWidth),
      ...formatLabelValue("Failed", String(failures), innerWidth),
      ...formatLabelValue("Cancelled", String(cancelled), innerWidth),
      ""
    ];

    for (const row of this.rows.filter((entry) => entry.selected)) {
      const suffix = row.durationMs > 0 ? ` (${formatDuration(row.durationMs)})` : "";
      const details = row.error ? `: ${row.error.message}` : "";
      const line = `${this.statusToken(row.status)} ${row.state.definition.title}${suffix}${details}`;
      lines.push(truncate(line, innerWidth));
    }

    lines.push("");
    lines.push(this.tagFg(this.statusMessage, palette.muted));

    return lines;
  }

  private getFooterLines(): string[] {
    const items = this.mode === "running"
      ? [
          [{ command: "q", description: "cancel current run" }],
          [{ command: "f", description: "more system details" }]
        ]
      : this.mode === "done"
        ? [
            [
              { command: "enter", description: "back to selection" },
              { command: "r", description: "run again" },
              { command: "q", description: "quit" }
            ],
            [{ command: "f", description: "more system details" }]
          ]
        : [
            [
              { command: "up/down", description: "move" },
              { command: "space", description: "toggle" },
              { command: "a", description: "toggle all" },
              { command: "enter", description: "run" },
              { command: "r", description: "refresh snapshot" },
              { command: "q", description: "quit" }
            ],
            [{ command: "f", description: "more system details" }]
          ];

    return items.map((line) => this.renderFooterLine(line));
  }

  private renderFooterLine(items: FooterItem[]): string {
    return items
      .map((item) => `${this.tagFg(item.command, palette.command)} ${this.tagFg(item.description, palette.muted)}`)
      .join(this.tagFg(" | ", palette.separator));
  }

  private renderPanelLabel(label: string): string {
    return `{${palette.command}-fg}${label}{/}`;
  }

  private tagFg(text: string, color: string): string {
    return `{${color}-fg}${text}{/}`;
  }

  private statusToken(status: TaskStatus): string {
    switch (status) {
      case "running":
        return "[RUN]";
      case "success":
        return "[OK ]";
      case "failed":
        return "[ERR]";
      case "cancelled":
        return "[CAN]";
      default:
        return "[...]";
    }
  }

  private appendLog(line: string): void {
    if (line.trim().length === 0) {
      return;
    }

    this.logs.push(line);
    if (this.logs.length > 200) {
      this.logs = this.logs.slice(-200);
    }
  }

  private getActiveTaskTitle(): string {
    if (!this.currentTaskId) {
      return "the active task";
    }

    return this.findRow(this.currentTaskId).state.definition.title;
  }

  private getPromptOutputLines(innerWidth: number, maxLines: number): string[] {
    const lines = this.logs
      .slice(-maxLines)
      .map((line) => truncate(line, innerWidth));

    if (lines.length > 0) {
      return lines;
    }

    return [this.tagFg("Waiting for additional command output...", palette.muted)];
  }

  private async runInteractiveCommand(command: string, args: string[]): Promise<void> {
    if (!this.abortController) {
      throw new Error("No active run is available.");
    }

    this.promptVisible = true;
    this.promptInputActive = false;
    this.promptMessage = "";
    this.promptSecret = false;
    this.promptInput.clearValue();
    this.render();
    await this.waitForRenderFrame();

    try {
      await runCommandInteractive(
        {
          command,
          args
        },
        {
          signal: this.abortController.signal,
          onLine: (line) => {
            this.appendLog(line);
            this.render();
          },
          requestInput: ({ text, secret }) => this.requestPromptInput(text, secret)
        }
      );
    } finally {
      this.promptVisible = false;
      this.promptInputActive = false;
      this.promptMessage = "";
      this.promptSecret = false;
      this.promptInput.clearValue();
      this.render();
    }
  }

  private async requestPromptInput(text: string, secret: boolean): Promise<string> {
    this.promptVisible = true;
    this.promptInputActive = true;
    this.promptMessage = text;
    this.promptSecret = secret;
    this.promptInput.clearValue();
    this.render();
    await this.waitForRenderFrame();

    return await new Promise<string>((resolve, reject) => {
      this.promptInput.focus();
      this.promptInput.readInput((error, value) => {
        this.promptInputActive = false;
        this.promptMessage = error
          ? "Interactive input was cancelled."
          : "Input received. Waiting for the command to continue...";
        this.promptSecret = false;
        this.promptInput.clearValue();
        this.render();

        if (error) {
          reject(new Error("Interactive input cancelled"));
          return;
        }

        resolve(value ?? "");
      });
    });
  }

  private findRow(taskId: string): TaskRow {
    const row = this.rows.find((entry) => entry.state.definition.id === taskId);
    if (!row) {
      throw new Error(`Unknown task id: ${taskId}`);
    }

    return row;
  }

  private exit(): void {
    if (this.exited) {
      return;
    }

    this.exited = true;
    this.abortController?.abort();
    this.screen.destroy();
    this.resolveExit?.();
  }

  private async waitForRenderFrame(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function formatLabelValue(label: string, value: string, width: number): string[] {
  const prefix = `${label}: `;
  const availableWidth = Math.max(1, width - prefix.length);
  const wrapped = wrapText(value, availableWidth);

  if (wrapped.length === 0) {
    return [`${prefix}`];
  }

  return wrapped.map((line, index) => (index === 0 ? `${prefix}${line}` : `${" ".repeat(prefix.length)}${line}`));
}

function wrapText(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.flatMap((line) => splitLongLine(line, width));
}

function splitLongLine(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }

  const lines: string[] = [];
  let remainder = text;
  while (remainder.length > width) {
    lines.push(remainder.slice(0, width));
    remainder = remainder.slice(width);
  }

  if (remainder.length > 0) {
    lines.push(remainder);
  }

  return lines;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }

  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
