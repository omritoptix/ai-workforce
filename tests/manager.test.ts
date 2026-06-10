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
  assignees: [],
};

function ok(text: string, sessionId = "s1"): SessionResult {
  return { sessionId, text, quotaHit: false, failed: false };
}

function harness(runResults: SessionResult[], issues: GhIssue[] = [readyIssue]) {
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
  return { manager: new Manager(cfg, store, deps), store, calls, deps };
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
  expect(calls.slack.some((t) => t.includes("final review"))).toBe(true);
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
