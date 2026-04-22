import { describe, it, expect } from "vitest";

import { selectAutoTasks, selectTasksByCategories } from "./catalog";
import type { TaskCategory, TaskState } from "./types";

function makeState(id: string, categories: TaskCategory[], available: boolean): TaskState {
  return {
    definition: {
      id,
      title: id,
      summary: "",
      categories,
      defaultSelected: true,
      commandLabel: id,
      checkAvailability: async () => ({ available }),
      run: async () => {}
    },
    availability: { available, reason: available ? undefined : "not found" }
  };
}

describe("selectAutoTasks", () => {
  it("selects only available tasks", () => {
    const states = [
      makeState("a", ["brew"], true),
      makeState("b", ["npm"], false),
      makeState("c", ["rust"], true)
    ];

    const selected = selectAutoTasks(states);
    expect(selected.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("returns empty when nothing is available", () => {
    const states = [makeState("a", ["brew"], false)];
    expect(selectAutoTasks(states)).toEqual([]);
  });
});

describe("selectTasksByCategories", () => {
  it("selects tasks matching the given categories", () => {
    const states = [
      makeState("a", ["brew"], true),
      makeState("b", ["npm"], true),
      makeState("c", ["rust"], true)
    ];

    const selected = selectTasksByCategories(states, new Set<TaskCategory>(["brew", "rust"]));
    expect(selected.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("excludes unavailable tasks even if category matches", () => {
    const states = [
      makeState("a", ["brew"], false),
      makeState("b", ["brew"], true)
    ];

    const selected = selectTasksByCategories(states, new Set<TaskCategory>(["brew"]));
    expect(selected.map((t) => t.id)).toEqual(["b"]);
  });

  it("returns empty when no categories match", () => {
    const states = [makeState("a", ["brew"], true)];
    const selected = selectTasksByCategories(states, new Set<TaskCategory>(["npm"]));
    expect(selected).toEqual([]);
  });
});
