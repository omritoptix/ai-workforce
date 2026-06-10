import { it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IssueState, StateStore } from "../src/state.js";

function fresh(): StateStore {
  return new StateStore(mkdtempSync(join(tmpdir(), "wf-state-")));
}

const sample: IssueState = {
  repo: "o/r",
  number: 7,
  title: "do thing",
  model: "sonnet",
  priority: 1,
  status: "working",
  reviewRounds: 0,
};

it("saves, gets, lists and removes issue state", () => {
  const store = fresh();
  expect(store.get("o/r", 7)).toBeUndefined();
  store.save(sample);
  expect(store.get("o/r", 7)?.title).toBe("do thing");
  expect(store.list()).toHaveLength(1);
  store.remove("o/r", 7);
  expect(store.get("o/r", 7)).toBeUndefined();
  expect(store.list()).toHaveLength(0);
});

it("keeps repos with the same issue number separate", () => {
  const store = fresh();
  store.save(sample);
  store.save({ ...sample, repo: "o/other" });
  expect(store.list()).toHaveLength(2);
});
