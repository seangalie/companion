import blessed from "blessed";

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
  private readonly inputBox: blessed.Widgets.BoxElement;
  private readonly inputLabel: blessed.Widgets.BoxElement;
  private readonly inputField: blessed.Widgets.TextboxElement;
  private readonly inputFooter: blessed.Widgets.BoxElement;
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
  private spinnerIndex = 0;
  private readonly spinnerFrames = ["-", "\\", "|", "/"];
  private spinnerTimer?: ReturnType<typeof setInterval>;
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

    this.inputBox = blessed.box({
      parent: this.screen,
      tags: true,
      border: "line",
      label: this.renderPanelLabel(" Password Required "),
      style: {
        fg: palette.text,
        border: {
          fg: palette.border
        }
      }
    });
    this.inputBox.hide();

    this.inputLabel = blessed.box({
      parent: this.inputBox,
      tags: true,
      style: {
        fg: palette.text
      }
    });

    this.inputField = blessed.textbox({
      parent: this.inputBox,
      tags: true,
      censor: true,
      inputOnFocus: true,
      style: {
        fg: palette.titleFg,
        bg: palette.titleBg
      }
    });

    this.inputFooter = blessed.box({
      parent: this.inputBox,
      tags: true,
      style: {
        fg: palette.muted
      }
    });

    this.registerKeys();
    this.screen.on("resize", () => this.render());

    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      if (this.snapshotLoading || this.fastfetchLoading || this.mode === "running") {
        this.render();
      }
    }, 120);
    this.spinnerTimer.unref();
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
      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.scroll(-10);
      this.screen.render();
    });

    this.screen.key(["pagedown"], () => {
      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.scroll(10);
      this.screen.render();
    });

    this.screen.key(["g"], () => {
      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.setScroll(0);
      this.screen.render();
    });

    this.screen.key(["G"], () => {
      if (!this.fastfetchVisible) {
        return;
      }

      this.overlayContent.setScrollPerc(100);
      this.screen.render();
    });

    this.screen.key(["space"], () => {
      if (this.fastfetchVisible || this.mode !== "select") {
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
      if (this.fastfetchVisible || this.mode !== "select") {
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
      this.fastfetchVisible = !this.fastfetchVisible;
      if (this.fastfetchVisible) {
        await this.refreshFastfetch();
      } else {
        this.render();
      }
    });

    this.screen.key(["c"], () => {
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
      (prompt, options) => this.showInputPrompt(prompt, options)
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

  private async showInputPrompt(prompt: string, options?: { masked?: boolean }): Promise<string> {
    const width = this.screen.width as number;
    const height = this.screen.height as number;
    const boxWidth = Math.min(60, width - 4);
    const boxHeight = 7;
    const boxLeft = Math.floor((width - boxWidth) / 2);
    const boxTop = Math.floor((height - boxHeight) / 2);

    this.inputBox.left = boxLeft;
    this.inputBox.top = boxTop;
    this.inputBox.width = boxWidth;
    this.inputBox.height = boxHeight;
    this.inputBox.show();
    this.inputBox.setFront();

    const innerWidth = Math.max(1, boxWidth - 4);
    this.inputLabel.left = 1;
    this.inputLabel.top = 0;
    this.inputLabel.width = innerWidth;
    this.inputLabel.height = 1;
    this.inputLabel.setContent(prompt);

    this.inputField.left = 1;
    this.inputField.top = 2;
    this.inputField.width = innerWidth;
    this.inputField.height = 1;
    this.inputField.censor = options?.masked !== false;
    this.inputField.setValue("");

    this.inputFooter.left = 1;
    this.inputFooter.top = 4;
    this.inputFooter.width = innerWidth;
    this.inputFooter.height = 1;
    this.inputFooter.setContent(
      `${this.tagFg("enter", palette.command)} ${this.tagFg("submit", palette.muted)}`
    );

    this.screen.render();
    this.inputField.focus();
    this.inputField.readInput();

    return await new Promise<string>((resolve) => {
      this.inputField.once("submit", (value: string) => {
        this.inputBox.hide();
        this.render();
        resolve(value ?? "");
      });
    });
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
    clearInterval(this.spinnerTimer);
    this.abortController?.abort();
    this.screen.destroy();
    this.resolveExit?.();
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
