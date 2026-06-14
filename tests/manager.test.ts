import { it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionResult } from "../src/claude.js";
import { Config } from "../src/config.js";
import { GhIssue } from "../src/issues.js";
import { Deps, Manager, RunOpts, issueKey } from "../src/manager.js";
import { StateStore } from "../src/state.js";

const cfg: Config = {
  repos: ["o/r"],
  workDir: "/tmp/wf",
  slackChannel: "C1",
  slackUserId: "U1",
  pollIntervalMs: 1000,
  maxReviewRounds: 3,
  sessionTimeoutMs: 1000,
  quotaRetryMs: 1,
};

const readyIssue: GhIssue = {
  number: 7,
  title: "do thing",
  body: "spec",
  labels: ["ready", "model:sonnet", "p1"],
};

function ok(text: string, sessionId = "s1"): SessionResult {
  return { sessionId, text, quotaHit: false, failed: false };
}

function harness(runResults: SessionResult[], issues: GhIssue[] = [readyIssue], cfgOverride: Config = cfg) {
  const calls = { run: [] as RunOpts[], labels: [] as { add: string[]; remove: string[] }[], slack: [] as string[] };
  const deps: Deps = {
    run: async (o) => {
      calls.run.push(o);
      return runResults.shift() ?? ok("VERDICT: APPROVE");
    },
    listOpenIssues: async () => issues,
    setIssueLabels: async (_r, _n, add, remove) => {
      calls.labels.push({ add, remove });
    },
    commentOnIssue: async () => {},
    assignMe: async () => {},
    getPR: async () => ({ body: "## Proof of execution\n12 tests passed", mergedAt: null }),
    createWorktree: async () => "/tmp/wt",
    removeWorktree: async () => {},
    syncSkills: async () => {},
    slackPost: async (text) => {
      calls.slack.push(text);
      return "ts1";
    },
    slackRegister: () => {},
    sleep: async () => {},
    log: () => {},
  };
  const store = new StateStore(mkdtempSync(join(tmpdir(), "wf-mgr-")));
  return { manager: new Manager(cfgOverride, store, deps), store, calls, deps };
}

it("drives a ready issue from dispatch to awaiting-final-review", async () => {
  const { manager, store, calls } = harness([
    ok("done\nPR: https://github.com/o/r/pull/5"),
    ok("VERDICT: APPROVE", "s2"),
  ]);
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
  expect(calls.labels[0]).toEqual({ add: ["in-progress"], remove: ["ready"] });
  expect(calls.run[0].prompt).toContain("do thing");
  expect(calls.run[1].prompt).toContain("/code-review");
  expect(calls.slack.some((t) => t.includes("dispatched"))).toBe(true);
  expect(calls.slack.some((t) => t.includes("final review"))).toBe(true);
});

it("forceModel overrides the issue model label for worker and reviewer", async () => {
  const { manager, store, calls } = harness(
    [ok("done\nPR: https://github.com/o/r/pull/5"), ok("VERDICT: APPROVE", "s2")],
    [{ ...readyIssue, labels: ["ready", "model:haiku"] }],
    { ...cfg, forceModel: "opus" },
  );
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
  expect(calls.run[0].model).toBe("opus");
  expect(calls.run[1].model).toBe("opus");
});

it("relays questions through slack and resumes with the answer", async () => {
  const { manager, store, calls } = harness([
    ok("QUESTION: global or per-user cache?"),
    ok("done\nPR: https://github.com/o/r/pull/5", "s2"),
    ok("VERDICT: APPROVE", "s3"),
  ]);
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-answer"));
  expect(calls.slack.some((t) => t.includes("global or per-user cache?"))).toBe(true);
  manager.onSlackReply(issueKey("o/r", 7), "global");
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
  expect(calls.run[1].prompt).toContain("global");
  expect(calls.run[1].resume).toBe("s1");
});

it("pauses on quota and retries", async () => {
  const { manager, store, calls } = harness([
    { sessionId: "", text: "usage limit reached", quotaHit: true, failed: true },
    ok("done\nPR: https://github.com/o/r/pull/5"),
    ok("VERDICT: APPROVE", "s2"),
  ]);
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
  expect(calls.labels.some((l) => l.add.includes("paused"))).toBe(true);
  expect(calls.labels.some((l) => l.remove.includes("paused"))).toBe(true);
});

it("gates new dispatches while quota is exhausted", async () => {
  const issues: GhIssue[] = [readyIssue];
  const { manager, store, calls, deps } = harness(
    [
      { sessionId: "", text: "usage limit reached", quotaHit: true, failed: true },
      ok("done\nPR: https://github.com/o/r/pull/5"),
      ok("VERDICT: APPROVE", "s2"),
      ok("done\nPR: https://github.com/o/r/pull/6", "s3"),
    ],
    issues,
  );
  let releaseSleep!: () => void;
  deps.sleep = () => new Promise((resolve) => (releaseSleep = resolve));
  await manager.tick();
  await vi.waitFor(() => expect(calls.labels.some((l) => l.add.includes("paused"))).toBe(true));
  issues.push({ ...readyIssue, number: 8 });
  await manager.tick();
  expect(calls.run.length).toBe(1);
  expect(store.get("o/r", 8)).toBeUndefined();
  releaseSleep();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 8)?.status).toBe("awaiting-final-review"));
});

it("normalizes paused state on recover and resumes the underlying phase", async () => {
  const { manager, store, calls } = harness([
    ok("done\nPR: https://github.com/o/r/pull/5", "s2"),
    ok("VERDICT: APPROVE", "r1"),
  ]);
  store.save({
    repo: "o/r",
    number: 7,
    title: "do thing",
    model: "sonnet",
    priority: 1,
    status: "paused",
    pausedFrom: "working",
    sessionId: "s1",
    reviewRounds: 0,
    worktree: "/tmp/wt",
  });
  await manager.recover();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
  expect(calls.labels.some((l) => l.remove.includes("paused"))).toBe(true);
  expect(store.get("o/r", 7)?.pausedFrom).toBeUndefined();
});

it("flips an issue back to ready when the worker ends without a signal", async () => {
  const { manager, store, calls } = harness([ok("I crashed and burned")]);
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)).toBeUndefined());
  expect(calls.labels.some((l) => l.add.includes("ready") && l.remove.includes("in-progress"))).toBe(true);
});

it("recover routes awaiting-answer+prNumber through reviewPhase not abort", async () => {
  const { manager, store, calls } = harness([
    ok("pushed fixes", "s2"),
    ok("VERDICT: APPROVE", "r1"),
  ]);
  store.save({
    repo: "o/r",
    number: 7,
    title: "do thing",
    model: "sonnet",
    priority: 1,
    status: "awaiting-answer",
    prNumber: 5,
    sessionId: "s1",
    reviewRounds: 0,
    worktree: "/tmp/wt",
    lastQuestion: "which db?",
    slackThreadTs: "ts1",
  });
  await manager.recover();
  // Wait until askOmri has posted the question to slack (waiter is registered)
  await vi.waitFor(() => expect(calls.slack.some((t) => t.includes("which db?"))).toBe(true));
  manager.onSlackReply(issueKey("o/r", 7), "use postgres");
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
});

it("recover aborts a session-less working issue instead of resuming into a void", async () => {
  const { manager, store, calls } = harness([ok("should never run")]);
  store.save({
    repo: "o/r",
    number: 7,
    title: "do thing",
    model: "sonnet",
    priority: 1,
    status: "working",
    reviewRounds: 0,
    worktree: "/tmp/wt",
  });
  await manager.recover();
  await vi.waitFor(() => expect(store.get("o/r", 7)).toBeUndefined());
  expect(calls.labels.some((l) => l.add.includes("ready") && l.remove.includes("in-progress"))).toBe(true);
  expect(calls.run).toEqual([]);
});

it("escalates after maxReviewRounds rejections", async () => {
  const { manager, store, calls } = harness([
    ok("done\nPR: https://github.com/o/r/pull/5"),
    ok("VERDICT: REQUEST_CHANGES", "r1"),
    ok("fixed\nPR: https://github.com/o/r/pull/5", "s2"),
    ok("VERDICT: REQUEST_CHANGES", "r2"),
    ok("fixed\nPR: https://github.com/o/r/pull/5", "s3"),
    ok("VERDICT: REQUEST_CHANGES", "r3"),
  ]);
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("escalated"));
  expect(calls.slack.some((t) => t.includes("Escalated"))).toBe(true);
});

it("cleans up when an awaiting-final-review PR is merged", async () => {
  const h = harness([], []);
  h.store.save({
    repo: "o/r",
    number: 7,
    title: "t",
    model: "sonnet",
    priority: 1,
    status: "awaiting-final-review",
    prNumber: 5,
    reviewRounds: 0,
    slackThreadTs: "ts1",
  });
  h.deps.getPR = async () => ({ body: "## Proof of execution\nx", mergedAt: "2026-06-10T00:00:00Z" });
  await h.manager.tick();
  expect(h.store.get("o/r", 7)).toBeUndefined();
  expect(h.calls.slack.some((t) => t.includes("merged"))).toBe(true);
});

it("recovers an awaiting-answer issue by re-posting the question", async () => {
  const { manager, store, calls } = harness([
    ok("done\nPR: https://github.com/o/r/pull/5", "s2"),
    ok("VERDICT: APPROVE", "r1"),
  ]);
  store.save({
    repo: "o/r",
    number: 7,
    title: "t",
    model: "sonnet",
    priority: 1,
    status: "awaiting-answer",
    sessionId: "s1",
    reviewRounds: 0,
    worktree: "/tmp/wt",
    slackThreadTs: "ts1",
    lastQuestion: "which db?",
  });
  await manager.recover();
  await vi.waitFor(() => expect(calls.slack.some((t) => t.includes("which db?"))).toBe(true));
  manager.onSlackReply(issueKey("o/r", 7), "postgres");
  await vi.waitFor(() => expect(store.get("o/r", 7)?.status).toBe("awaiting-final-review"));
});
