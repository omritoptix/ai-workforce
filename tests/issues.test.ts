import { it, expect } from "vitest";
import { GhIssue, blockedBy, isDispatchable, modelLabel, priorityLabel } from "../src/issues.js";

function issue(over: Partial<GhIssue>): GhIssue {
  return { number: 1, title: "t", body: "", labels: [], ...over };
}

it("extracts the model label", () => {
  expect(modelLabel(["ready", "model:opus"])).toBe("opus");
  expect(modelLabel(["ready"])).toBeUndefined();
});

it("extracts priority, defaulting to p2", () => {
  expect(priorityLabel(["p0", "ready"])).toBe(0);
  expect(priorityLabel(["ready"])).toBe(2);
});

it("parses blocked-by references from the body", () => {
  expect(blockedBy("Spec...\nblocked-by: #12\nblocked-by: #34")).toEqual([12, 34]);
  expect(blockedBy("no blockers here")).toEqual([]);
});

it("dispatches only ready issues with a model label and no open blockers", () => {
  const open = new Set([12]);
  expect(isDispatchable(issue({ labels: ["ready", "model:sonnet"] }), open)).toBe(true);
  expect(isDispatchable(issue({ labels: ["model:sonnet"] }), open)).toBe(false);
  expect(isDispatchable(issue({ labels: ["ready"] }), open)).toBe(false);
  expect(
    isDispatchable(issue({ labels: ["ready", "model:sonnet"], body: "blocked-by: #12" }), open),
  ).toBe(false);
  expect(
    isDispatchable(issue({ labels: ["ready", "model:sonnet"], body: "blocked-by: #99" }), open),
  ).toBe(true);
});

it("does not require a model label when requireModel is false", () => {
  expect(isDispatchable(issue({ labels: ["ready"] }), new Set(), false)).toBe(true);
  expect(isDispatchable(issue({ labels: ["ready"] }), new Set())).toBe(false);
});
