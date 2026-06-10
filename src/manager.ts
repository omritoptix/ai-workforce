import { SessionResult } from "./claude.js";
import { Config } from "./config.js";
import { GhIssue, isDispatchable, modelLabel, priorityLabel } from "./issues.js";
import { hasProofOfExecution } from "./proof.js";
import { answerPrompt, branchName, fixPrompt, reviewerPrompt, workerPrompt } from "./prompts.js";
import { parseSignal } from "./signals.js";
import { IssueState, StateStore } from "./state.js";

export interface RunOpts {
  prompt: string;
  cwd: string;
  model: string;
  resume?: string;
}

export interface Deps {
  run(opts: RunOpts & { timeoutMs: number }): Promise<SessionResult>;
  listOpenIssues(repo: string): Promise<GhIssue[]>;
  setIssueLabels(repo: string, n: number, add: string[], remove: string[]): Promise<void>;
  commentOnIssue(repo: string, n: number, body: string): Promise<void>;
  assignMe(repo: string, n: number): Promise<void>;
  getPR(repo: string, n: number): Promise<{ body: string; mergedAt: string | null }>;
  createWorktree(repo: string, issue: number): Promise<string>;
  removeWorktree(repo: string, issue: number): Promise<void>;
  syncSkills(): Promise<void>;
  slackPost(text: string, threadTs?: string): Promise<string>;
  slackRegister(threadTs: string, issueKey: string): void;
  sleep(ms: number): Promise<void>;
  log(level: "debug" | "info" | "error", msg: string, fields?: object): void;
}

export function issueKey(repo: string, n: number): string {
  return `${repo}#${n}`;
}

export class Manager {
  private answerWaiters = new Map<string, (text: string) => void>();
  private driving = new Set<string>();

  constructor(
    private cfg: Config,
    private store: StateStore,
    private deps: Deps,
  ) {}

  onSlackReply(key: string, text: string): void {
    const waiter = this.answerWaiters.get(key);
    if (waiter) {
      this.answerWaiters.delete(key);
      waiter(text);
    }
  }

  async tick(): Promise<void> {
    await this.deps.syncSkills();
    for (const repo of this.cfg.repos) {
      const issues = await this.deps.listOpenIssues(repo);
      const open = new Set(issues.map((i) => i.number));
      for (const issue of issues) {
        const key = issueKey(repo, issue.number);
        if (this.driving.has(key) || this.store.get(repo, issue.number)) continue;
        if (!isDispatchable(issue, open)) continue;
        this.spawnDriver(key, () => this.driveNew(repo, issue));
      }
    }
    await this.watchMerges();
  }

  async recover(): Promise<void> {
    for (const state of this.store.list()) {
      const key = issueKey(state.repo, state.number);
      if (state.slackThreadTs) this.deps.slackRegister(state.slackThreadTs, key);
      if (state.status === "paused") {
        state.status = state.pausedFrom!;
        delete state.pausedFrom;
        this.store.save(state);
        await this.deps.setIssueLabels(state.repo, state.number, [], ["paused"]);
      }
      const status = state.status;
      if (status === "working") {
        this.spawnDriver(key, async () => {
          const result = await this.runWorker(
            state,
            "The manager restarted. Continue working on the issue per your original instructions and protocol.",
          );
          await this.handleSignals(state, result);
        });
      } else if (status === "reviewing") {
        this.spawnDriver(key, () => this.reviewPhase(state));
      } else if (status === "awaiting-answer") {
        this.spawnDriver(key, async () => {
          const answer = await this.askOmri(state, state.lastQuestion ?? "(question lost on restart — resume the session to see it)");
          const result = await this.runWorker(state, answerPrompt(answer));
          await this.handleSignals(state, result);
        });
      }
      // awaiting-final-review: watched by tick(); escalated: left for Omri.
    }
  }

  private spawnDriver(key: string, fn: () => Promise<void>): void {
    this.driving.add(key);
    fn()
      .catch((err) => this.deps.log("error", "driver crashed", { key, err: String(err) }))
      .finally(() => this.driving.delete(key));
  }

  private async driveNew(repo: string, issue: GhIssue): Promise<void> {
    const worktree = await this.deps.createWorktree(repo, issue.number);
    const state: IssueState = {
      repo,
      number: issue.number,
      title: issue.title,
      model: modelLabel(issue.labels)!,
      priority: priorityLabel(issue.labels),
      status: "working",
      reviewRounds: 0,
      worktree,
    };
    this.store.save(state);
    await this.deps.setIssueLabels(repo, issue.number, ["in-progress"], ["ready"]);
    await this.deps.assignMe(repo, issue.number);
    await this.deps.commentOnIssue(repo, issue.number, `Workforce worker dispatched (model: ${state.model}).`);
    const result = await this.runWithQuota(state, {
      prompt: workerPrompt(repo, issue, branchName(issue.number)),
      cwd: worktree,
      model: state.model,
    });
    if (result.sessionId) {
      state.sessionId = result.sessionId;
      this.store.save(state);
    }
    await this.handleSignals(state, result);
  }

  private async handleSignals(state: IssueState, result: SessionResult): Promise<void> {
    while (true) {
      const signal = parseSignal(result.text);
      if (signal.kind === "question") {
        const answer = await this.askOmri(state, signal.text);
        result = await this.runWorker(state, answerPrompt(answer));
        continue;
      }
      if (signal.kind === "pr") {
        state.prNumber = signal.number;
        this.store.save(state);
        await this.deps.commentOnIssue(state.repo, state.number, `PR opened: #${signal.number}`);
        await this.reviewPhase(state);
        return;
      }
      await this.abort(state, `Worker session ended without a PR or question. session=${state.sessionId}`);
      return;
    }
  }

  private async reviewPhase(state: IssueState): Promise<void> {
    state.status = "reviewing";
    this.store.save(state);
    let proofRetried = false;
    while (true) {
      const pr = await this.deps.getPR(state.repo, state.prNumber!);
      if (!hasProofOfExecution(pr.body)) {
        if (proofRetried) {
          await this.escalate(state, `PR #${state.prNumber} still has no Proof of execution section after a retry.`);
          return;
        }
        proofRetried = true;
        await this.runWorker(
          state,
          fixPrompt("The PR body is missing a non-empty '## Proof of execution' section. Produce the evidence and update the PR body with gh pr edit."),
        );
        continue;
      }
      const review = await this.runWithQuota(state, {
        prompt: reviewerPrompt(state.repo, state.prNumber!),
        cwd: state.worktree!,
        model: "sonnet",
      });
      const signal = parseSignal(review.text);
      if (signal.kind === "verdict" && signal.approve) {
        state.status = "awaiting-final-review";
        this.store.save(state);
        await this.notify(state, `:white_check_mark: PR #${state.prNumber} approved by reviewers — ready for your final review.`);
        return;
      }
      state.reviewRounds++;
      this.store.save(state);
      if (state.reviewRounds >= this.cfg.maxReviewRounds) {
        await this.escalate(state, `Review loop hit ${state.reviewRounds} rounds on PR #${state.prNumber} without approval.`);
        return;
      }
      await this.runWorker(
        state,
        fixPrompt(`Reviewers requested changes on PR #${state.prNumber}. Read the review comments with gh, address them, and push.`),
      );
    }
  }

  private async watchMerges(): Promise<void> {
    for (const state of this.store.list()) {
      if (state.status !== "awaiting-final-review") continue;
      const pr = await this.deps.getPR(state.repo, state.prNumber!);
      if (!pr.mergedAt) continue;
      await this.deps.removeWorktree(state.repo, state.number);
      this.store.remove(state.repo, state.number);
      await this.deps.slackPost(
        `:tada: PR #${state.prNumber} merged — ${issueKey(state.repo, state.number)} done.`,
        state.slackThreadTs,
      );
      this.deps.log("info", "issue completed", { key: issueKey(state.repo, state.number) });
    }
  }

  private async runWorker(state: IssueState, prompt: string): Promise<SessionResult> {
    const result = await this.runWithQuota(state, {
      prompt,
      cwd: state.worktree!,
      model: state.model,
      resume: state.sessionId,
    });
    if (result.sessionId) {
      state.sessionId = result.sessionId;
      this.store.save(state);
    }
    return result;
  }

  private async runWithQuota(state: IssueState, opts: RunOpts): Promise<SessionResult> {
    while (true) {
      const result = await this.deps.run({ ...opts, timeoutMs: this.cfg.sessionTimeoutMs });
      if (!result.quotaHit) return result;
      const resumeFrom = result.sessionId || opts.resume;
      state.pausedFrom = state.status;
      state.status = "paused";
      this.store.save(state);
      await this.deps.setIssueLabels(state.repo, state.number, ["paused"], []);
      await this.notify(state, `:hourglass: Paused on usage limit (p${state.priority}). Will retry automatically.`);
      await this.deps.sleep(this.cfg.quotaRetryMs + state.priority * 60_000);
      state.status = state.pausedFrom!;
      delete state.pausedFrom;
      this.store.save(state);
      await this.deps.setIssueLabels(state.repo, state.number, [], ["paused"]);
      if (resumeFrom) {
        opts = { prompt: "Continue.", cwd: opts.cwd, model: opts.model, resume: resumeFrom };
      }
    }
  }

  private async askOmri(state: IssueState, question: string): Promise<string> {
    state.status = "awaiting-answer";
    state.lastQuestion = question;
    this.store.save(state);
    await this.notify(
      state,
      `:question: ${question}\n_Escalate: ssh to the server, then \`claude --resume ${state.sessionId}\` in \`${state.worktree}\`_`,
    );
    const key = issueKey(state.repo, state.number);
    const answer = await new Promise<string>((resolve) => this.answerWaiters.set(key, resolve));
    state.status = "working";
    delete state.lastQuestion;
    this.store.save(state);
    return answer;
  }

  private async notify(state: IssueState, text: string): Promise<void> {
    if (!state.slackThreadTs) {
      state.slackThreadTs = await this.deps.slackPost(`*${issueKey(state.repo, state.number)}* ${state.title}`);
      this.deps.slackRegister(state.slackThreadTs, issueKey(state.repo, state.number));
      this.store.save(state);
    }
    await this.deps.slackPost(text, state.slackThreadTs);
  }

  private async escalate(state: IssueState, reason: string): Promise<void> {
    state.status = "escalated";
    this.store.save(state);
    await this.notify(state, `:rotating_light: Escalated: ${reason}\n_Session: \`claude --resume ${state.sessionId}\` in \`${state.worktree}\`_`);
  }

  private async abort(state: IssueState, reason: string): Promise<void> {
    await this.notify(state, `:x: ${reason} — issue flipped back to ready.`);
    await this.deps.setIssueLabels(state.repo, state.number, ["ready"], ["in-progress"]);
    this.store.remove(state.repo, state.number);
    this.deps.log("error", "issue aborted", { key: issueKey(state.repo, state.number), reason });
  }
}
