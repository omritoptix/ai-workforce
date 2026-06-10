import { it, expect } from "vitest";
import { GhIssue } from "../src/issues.js";
import { answerPrompt, branchName, fixPrompt, reviewerPrompt, workerPrompt } from "../src/prompts.js";

const issue: GhIssue = {
  number: 9,
  title: "Add login",
  body: "## Goal\nLogin flow",
  labels: ["ready", "model:sonnet"],
};

it("builds a worker prompt with spec, branch, closes-line and protocol", () => {
  const p = workerPrompt("o/r", issue, branchName(9));
  expect(p).toContain("## Goal\nLogin flow");
  expect(p).toContain("omridagan/claude-issue-9");
  expect(p).toContain("Closes #9");
  expect(p).toContain("## Proof of execution");
  expect(p).toContain("PR: <");
  expect(p).toContain("QUESTION: <");
});

it("builds a reviewer prompt with the verdict protocol", () => {
  const p = reviewerPrompt("o/r", 42);
  expect(p).toContain("/code-review");
  expect(p).toContain("Proof of execution");
  expect(p).toContain("VERDICT: APPROVE");
  expect(p).toContain("VERDICT: REQUEST_CHANGES");
});

it("answer and fix prompts restate the protocol", () => {
  expect(answerPrompt("use global cache")).toContain("use global cache");
  expect(answerPrompt("x")).toContain("PR: <");
  expect(fixPrompt("address comments")).toContain("address comments");
  expect(fixPrompt("x")).toContain("PR: <");
});
