import { it, expect } from "vitest";
import { parseSignal } from "../src/signals.js";

it("parses a PR signal", () => {
  expect(parseSignal("All done.\nPR: https://github.com/o/r/pull/42")).toEqual({
    kind: "pr",
    number: 42,
  });
});

it("parses a multi-line question", () => {
  expect(parseSignal("I'm blocked.\nQUESTION: Should the cache be\nper-user or global?")).toEqual({
    kind: "question",
    text: "Should the cache be\nper-user or global?",
  });
});

it("parses verdicts", () => {
  expect(parseSignal("Looks good.\nVERDICT: APPROVE")).toEqual({ kind: "verdict", approve: true });
  expect(parseSignal("Issues found.\nVERDICT: REQUEST_CHANGES")).toEqual({
    kind: "verdict",
    approve: false,
  });
});

it("uses the last marker when several appear", () => {
  expect(parseSignal("QUESTION: old?\nresolved it myself\nPR: https://x/pull/3")).toEqual({
    kind: "pr",
    number: 3,
  });
});

it("returns none when no marker is present", () => {
  expect(parseSignal("I gave up")).toEqual({ kind: "none" });
});
