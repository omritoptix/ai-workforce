import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { destination, pino } from "pino";
import { runSession } from "./claude.js";
import { loadConfig } from "./config.js";
import * as github from "./gh.js";
import { Deps, Manager } from "./manager.js";
import { SlackBridge } from "./slack.js";
import { StateStore } from "./state.js";
import * as wt from "./worktree.js";

const configPath = process.argv[2];
if (!configPath) throw new Error("usage: tsx src/index.ts <config.json>");
const cfg = loadConfig(configPath);
mkdirSync(cfg.workDir, { recursive: true });

const logger = pino(destination(join(cfg.workDir, "manager.log")));
const log: Deps["log"] = (level, msg, fields = {}) => logger[level](fields, msg);

const store = new StateStore(join(cfg.workDir, "state"));
const slack = new SlackBridge(cfg.slackChannel);

const deps: Deps = {
  run: runSession,
  listOpenIssues: github.listOpenIssues,
  setIssueLabels: github.setIssueLabels,
  commentOnIssue: github.commentOnIssue,
  assignMe: github.assignMe,
  getPR: github.getPR,
  listIssueComments: github.listIssueComments,
  markReadyForReview: github.markReadyForReview,
  createWorktree: (repo, issue) => wt.createWorktree(cfg.workDir, repo, issue),
  removeWorktree: (repo, issue) => wt.removeWorktree(cfg.workDir, repo, issue),
  syncSkills: async () => {
    await execa("git", ["-C", join(homedir(), ".claude"), "pull", "--ff-only"]).catch((err) =>
      log("error", "skills sync failed", { err: String(err) }),
    );
  },
  slackPost: (text, threadTs) => slack.post(text, threadTs),
  slackRegister: (ts, key) => slack.router.register(ts, key),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log,
};

const manager = new Manager(cfg, store, deps);
slack.router.onReply = (key, text) => manager.onSlackReply(key, text);

await slack.start();
await manager.recover();
log("info", "workforce manager started", { repos: cfg.repos });

for (;;) {
  try {
    await manager.tick();
  } catch (err) {
    log("error", "tick crashed", { err: String(err) });
  }
  await deps.sleep(cfg.pollIntervalMs);
}
