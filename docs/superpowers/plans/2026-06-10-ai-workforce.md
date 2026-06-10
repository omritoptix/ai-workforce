# AI Workforce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AI workforce per `docs/superpowers/specs/2026-06-10-ai-workforce-design.md`: a deterministic manager daemon on a Hetzner server that dispatches headless Claude Code worker/reviewer sessions for architect-specified GitHub issues, bridges questions through Slack, and pings Omri when a PR is ready for final review.

**Architecture:** One Node/TypeScript daemon (the manager — zero LLM) polls GitHub via the `gh` CLI, drives a per-issue async state machine (work → question loop → PR → proof check → review loop → final review), and spawns `claude -p` headless sessions with the model taken from the issue's `model:*` label. Sessions communicate back through a line protocol in their final message (`PR:` / `QUESTION:` / `VERDICT:`). Slack (Bolt, socket mode) carries questions and notifications; GitHub labels are the source of truth for work state; per-issue JSON files on disk hold runtime bookkeeping only.

**Tech Stack:** Node 22+, TypeScript (strict, ESM, run via tsx), vitest, `@slack/bolt` (socket mode), `execa` (subprocesses: `gh`, `git`, `claude`), pino (logging), systemd (deployment).

## File structure

```
config.json                     # target repos, paths, intervals (not committed — config.example.json is)
package.json / tsconfig.json
src/config.ts                   # load + validate config (all keys required)
src/issues.ts                   # GhIssue type; label/body parsing; dispatch eligibility (pure)
src/state.ts                    # per-issue runtime state, JSON files on disk
src/proof.ts                    # "## Proof of execution" structural check (pure)
src/signals.ts                  # parse PR:/QUESTION:/VERDICT: protocol from session output (pure)
src/claude.ts                   # spawn/resume headless claude sessions; quota detection
src/gh.ts                       # thin gh CLI wrapper (issues, labels, comments, PRs)
src/worktree.ts                 # server-side clones + per-issue worktrees
src/prompts.ts                  # worker/reviewer/answer prompt builders; branch naming
src/slack.ts                    # ThreadRouter (pure) + SlackBridge (Bolt socket mode)
src/manager.ts                  # the state machine: tick/dispatch, work phase, review phase, quota pause, recovery
src/index.ts                    # wiring: config, deps, slack start, recover, poll loop
tests/*.test.ts                 # one test file per src module with logic
skills/architect/SKILL.md       # the architect skill (symlinked into ~/.claude/skills)
deploy/slack-manifest.json      # Slack app manifest (socket mode)
deploy/workforce.service        # systemd unit
deploy/setup-server.sh          # Hetzner bootstrap commands
README.md
```

---

### Task 1: Project scaffold + config loader

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `config.example.json`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Scaffold the project**

`package.json`:

```json
{
  "name": "ai-workforce",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@slack/bolt": "^4",
    "execa": "^9",
    "pino": "^9"
  },
  "devDependencies": {
    "@types/node": "^22",
    "tsx": "^4",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`.gitignore`:

```
node_modules/
config.json
```

`config.example.json`:

```json
{
  "repos": ["dymensionxyz/example-repo"],
  "workDir": "/home/workforce/work",
  "slackChannel": "C0XXXXXXX",
  "pollIntervalMs": 60000,
  "maxReviewRounds": 3,
  "sessionTimeoutMs": 3600000,
  "quotaRetryMs": 900000
}
```

Run: `npm install`
Expected: lockfile created, no errors.

- [ ] **Step 2: Write the failing config test**

`tests/config.test.ts`:

```ts
import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

const valid = {
  repos: ["o/r"],
  workDir: "/tmp/wf",
  slackChannel: "C123",
  pollIntervalMs: 60000,
  maxReviewRounds: 3,
  sessionTimeoutMs: 3600000,
  quotaRetryMs: 900000,
};

function writeTmp(obj: object): string {
  const p = join(mkdtempSync(join(tmpdir(), "wf-")), "c.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

it("loads a valid config", () => {
  expect(loadConfig(writeTmp(valid)).repos).toEqual(["o/r"]);
});

it("throws on a missing key", () => {
  const { quotaRetryMs, ...incomplete } = valid;
  expect(() => loadConfig(writeTmp(incomplete))).toThrow("quotaRetryMs");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find `../src/config.js`.

- [ ] **Step 4: Implement the config loader**

`src/config.ts`:

```ts
import { readFileSync } from "node:fs";

export interface Config {
  repos: string[];
  workDir: string;
  slackChannel: string;
  pollIntervalMs: number;
  maxReviewRounds: number;
  sessionTimeoutMs: number;
  quotaRetryMs: number;
}

const KEYS: (keyof Config)[] = [
  "repos",
  "workDir",
  "slackChannel",
  "pollIntervalMs",
  "maxReviewRounds",
  "sessionTimeoutMs",
  "quotaRetryMs",
];

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  for (const key of KEYS) {
    if (raw[key] === undefined) throw new Error(`config missing key: ${key}`);
  }
  return raw as Config;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/config.test.ts && npx tsc --noEmit`
Expected: 2 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore config.example.json src/config.ts tests/config.test.ts
git commit -m "claude: feat(config): scaffold project with validated config loader"
```

---

### Task 2: Issue parsing and dispatch eligibility

**Files:**
- Create: `src/issues.ts`
- Test: `tests/issues.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/issues.test.ts`:

```ts
import { it, expect } from "vitest";
import { GhIssue, blockedBy, isDispatchable, modelLabel, priorityLabel } from "../src/issues.js";

function issue(over: Partial<GhIssue>): GhIssue {
  return { number: 1, title: "t", body: "", labels: [], assignees: [], ...over };
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/issues.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/issues.ts`:

```ts
export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

export function modelLabel(labels: string[]): string | undefined {
  return labels.find((l) => l.startsWith("model:"))?.slice("model:".length);
}

export function priorityLabel(labels: string[]): number {
  const l = labels.find((l) => /^p[0-9]$/.test(l));
  return l ? Number(l.slice(1)) : 2;
}

export function blockedBy(body: string): number[] {
  return [...body.matchAll(/^blocked-by:\s*#(\d+)/gim)].map((m) => Number(m[1]));
}

export function isDispatchable(issue: GhIssue, openNumbers: Set<number>): boolean {
  if (!issue.labels.includes("ready")) return false;
  if (modelLabel(issue.labels) === undefined) return false;
  return blockedBy(issue.body).every((n) => !openNumbers.has(n));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/issues.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/issues.ts tests/issues.test.ts
git commit -m "claude: feat(issues): parse labels and dispatch eligibility"
```

---

### Task 3: State store

**Files:**
- Create: `src/state.ts`
- Test: `tests/state.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/state.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type IssueStatus =
  | "working"
  | "awaiting-answer"
  | "reviewing"
  | "awaiting-final-review"
  | "paused"
  | "escalated";

export interface IssueState {
  repo: string; // "owner/name"
  number: number;
  title: string;
  model: string;
  priority: number;
  status: IssueStatus;
  pausedFrom?: IssueStatus;
  sessionId?: string;
  prNumber?: number;
  reviewRounds: number;
  slackThreadTs?: string;
  worktree?: string;
  lastQuestion?: string;
}

export class StateStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(repo: string, number: number): string {
    return join(this.dir, `${repo.replace("/", "__")}__${number}.json`);
  }

  get(repo: string, number: number): IssueState | undefined {
    const f = this.file(repo, number);
    if (!existsSync(f)) return undefined;
    return JSON.parse(readFileSync(f, "utf8"));
  }

  save(state: IssueState): void {
    writeFileSync(this.file(state.repo, state.number), JSON.stringify(state, null, 2));
  }

  remove(repo: string, number: number): void {
    rmSync(this.file(repo, number), { force: true });
  }

  list(): IssueState[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/state.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "claude: feat(state): per-issue runtime state on disk"
```

---

### Task 4: Proof-of-execution check

**Files:**
- Create: `src/proof.ts`
- Test: `tests/proof.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/proof.test.ts`:

```ts
import { it, expect } from "vitest";
import { hasProofOfExecution } from "../src/proof.js";

it("accepts a PR body with a non-empty proof section", () => {
  expect(hasProofOfExecution("Closes #1\n\n## Proof of execution\n- test output: 12 passed")).toBe(true);
});

it("accepts when proof is followed by another section", () => {
  expect(hasProofOfExecution("## Proof of execution\nvideo.mp4 attached\n## Notes\nfoo")).toBe(true);
});

it("rejects a missing section", () => {
  expect(hasProofOfExecution("Closes #1\njust a description")).toBe(false);
});

it("rejects an empty section", () => {
  expect(hasProofOfExecution("## Proof of execution\n\n## Notes\nfoo")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/proof.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/proof.ts`:

```ts
export function hasProofOfExecution(prBody: string): boolean {
  const m = prBody.match(/^##\s*Proof of execution\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);
  return !!m && m[1].trim().length > 0;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/proof.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proof.ts tests/proof.test.ts
git commit -m "claude: feat(proof): structural proof-of-execution check"
```

---

### Task 5: Session signal protocol

**Files:**
- Create: `src/signals.ts`
- Test: `tests/signals.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/signals.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/signals.ts`:

```ts
export type Signal =
  | { kind: "question"; text: string }
  | { kind: "pr"; number: number }
  | { kind: "verdict"; approve: boolean }
  | { kind: "none" };

export function parseSignal(text: string): Signal {
  const lines = text.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("QUESTION:")) {
      const rest = [line.slice("QUESTION:".length), ...lines.slice(i + 1)].join("\n").trim();
      return { kind: "question", text: rest };
    }
    const pr = line.match(/^PR:\s*\S*\/pull\/(\d+)/);
    if (pr) return { kind: "pr", number: Number(pr[1]) };
    const v = line.match(/^VERDICT:\s*(APPROVE|REQUEST_CHANGES)\b/);
    if (v) return { kind: "verdict", approve: v[1] === "APPROVE" };
  }
  return { kind: "none" };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/signals.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/signals.ts tests/signals.test.ts
git commit -m "claude: feat(signals): parse session protocol markers"
```

---

### Task 6: Claude session runner

**Files:**
- Create: `src/claude.ts`
- Test: `tests/claude.test.ts`

Headless invocation reference: `claude -p --output-format json` prints a single JSON object to stdout with `session_id`, `result` (final message text), and `is_error`. `--resume <session-id>` continues a previous session. `--dangerously-skip-permissions` is required for unattended runs (the server is a dedicated sandbox — acceptable per spec).

- [ ] **Step 1: Write the failing tests (pure parsing only)**

`tests/claude.test.ts`:

```ts
import { it, expect } from "vitest";
import { isQuotaError, parseSessionOutput } from "../src/claude.js";

it("parses a successful session", () => {
  const out = JSON.stringify({ session_id: "abc", result: "PR: https://x/pull/1", is_error: false });
  expect(parseSessionOutput(out)).toEqual({
    sessionId: "abc",
    text: "PR: https://x/pull/1",
    quotaHit: false,
    failed: false,
  });
});

it("flags quota errors", () => {
  const out = JSON.stringify({ session_id: "abc", result: "5-hour usage limit reached", is_error: true });
  const r = parseSessionOutput(out);
  expect(r.quotaHit).toBe(true);
  expect(r.failed).toBe(true);
});

it("detects quota phrasing variants", () => {
  expect(isQuotaError("Claude usage limit reached|resets 6pm")).toBe(true);
  expect(isQuotaError("rate limit exceeded")).toBe(true);
  expect(isQuotaError("type error in foo.ts")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/claude.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/claude.ts`:

```ts
import { execa } from "execa";

export interface SessionResult {
  sessionId: string;
  text: string;
  quotaHit: boolean;
  failed: boolean;
}

export interface RunSessionOpts {
  prompt: string;
  cwd: string;
  model: string;
  resume?: string;
  timeoutMs: number;
}

export function isQuotaError(text: string): boolean {
  return /usage limit|rate.?limit/i.test(text);
}

export function parseSessionOutput(stdout: string): SessionResult {
  const json = JSON.parse(stdout);
  const text: string = json.result ?? "";
  return {
    sessionId: json.session_id ?? "",
    text,
    quotaHit: json.is_error === true && isQuotaError(text),
    failed: json.is_error === true,
  };
}

export async function runSession(opts: RunSessionOpts): Promise<SessionResult> {
  const args = ["-p", "--output-format", "json", "--dangerously-skip-permissions", "--model", opts.model];
  if (opts.resume) args.push("--resume", opts.resume);
  args.push(opts.prompt);
  try {
    const { stdout } = await execa("claude", args, { cwd: opts.cwd, timeout: opts.timeoutMs });
    return parseSessionOutput(stdout);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    return { sessionId: opts.resume ?? "", text: out, quotaHit: isQuotaError(out), failed: true };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/claude.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claude.ts tests/claude.test.ts
git commit -m "claude: feat(claude): headless session runner with quota detection"
```

---

### Task 7: GitHub CLI wrapper

**Files:**
- Create: `src/gh.ts`
- Test: `tests/gh.test.ts`

All GitHub access goes through the `gh` CLI (auth handled by `gh auth login` on the server, no token management in code).

- [ ] **Step 1: Write the failing test (mocked execa)**

`tests/gh.test.ts`:

```ts
import { it, expect, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";
import { listOpenIssues } from "../src/gh.js";

it("maps gh issue JSON to GhIssue", async () => {
  vi.mocked(execa).mockResolvedValueOnce({
    stdout: JSON.stringify([
      { number: 5, title: "t", body: null, labels: [{ name: "ready" }], assignees: [{ login: "omri" }] },
    ]),
  } as never);
  const issues = await listOpenIssues("o/r");
  expect(issues).toEqual([
    { number: 5, title: "t", body: "", labels: ["ready"], assignees: ["omri"] },
  ]);
  expect(vi.mocked(execa).mock.calls[0][1]).toContain("--repo");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/gh.ts`:

```ts
import { execa } from "execa";
import { GhIssue } from "./issues.js";

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execa("gh", args);
  return stdout;
}

interface RawLabel {
  name: string;
}
interface RawUser {
  login: string;
}
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  labels: RawLabel[];
  assignees: RawUser[];
}

export async function listOpenIssues(repo: string): Promise<GhIssue[]> {
  const out = await gh([
    "issue", "list", "--repo", repo, "--state", "open", "--limit", "200",
    "--json", "number,title,body,labels,assignees",
  ]);
  return (JSON.parse(out) as RawIssue[]).map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: i.labels.map((l) => l.name),
    assignees: i.assignees.map((a) => a.login),
  }));
}

export async function setIssueLabels(
  repo: string,
  number: number,
  add: string[],
  remove: string[],
): Promise<void> {
  if (add.length + remove.length === 0) return;
  const args = ["issue", "edit", String(number), "--repo", repo];
  for (const l of add) args.push("--add-label", l);
  for (const l of remove) args.push("--remove-label", l);
  await gh(args);
}

export async function commentOnIssue(repo: string, number: number, body: string): Promise<void> {
  await gh(["issue", "comment", String(number), "--repo", repo, "--body", body]);
}

export async function assignMe(repo: string, number: number): Promise<void> {
  await gh(["issue", "edit", String(number), "--repo", repo, "--add-assignee", "@me"]);
}

export async function getPR(
  repo: string,
  number: number,
): Promise<{ body: string; mergedAt: string | null }> {
  const out = await gh(["pr", "view", String(number), "--repo", repo, "--json", "body,mergedAt"]);
  const pr = JSON.parse(out) as { body: string | null; mergedAt: string | null };
  return { body: pr.body ?? "", mergedAt: pr.mergedAt ?? null };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/gh.test.ts`
Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gh.ts tests/gh.test.ts
git commit -m "claude: feat(gh): thin gh CLI wrapper"
```

---

### Task 8: Prompt templates and branch naming

**Files:**
- Create: `src/prompts.ts`
- Test: `tests/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/prompts.test.ts`:

```ts
import { it, expect } from "vitest";
import { GhIssue } from "../src/issues.js";
import { answerPrompt, branchName, fixPrompt, reviewerPrompt, workerPrompt } from "../src/prompts.js";

const issue: GhIssue = {
  number: 9,
  title: "Add login",
  body: "## Goal\nLogin flow",
  labels: ["ready", "model:sonnet"],
  assignees: [],
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/prompts.ts`:

```ts
import { GhIssue } from "./issues.js";

export function branchName(issue: number): string {
  return `omridagan/claude-issue-${issue}`;
}

export function workerPrompt(repo: string, issue: GhIssue, branch: string): string {
  return `You are an autonomous workforce engineer working in a checkout of ${repo} on branch ${branch}.

Implement GitHub issue #${issue.number}: ${issue.title}

--- ISSUE SPEC (authoritative) ---
${issue.body}
--- END SPEC ---

Rules:
- Implement exactly what the spec asks, nothing more.
- Follow repository conventions; run formatters, linters and tests before finishing.
- You MUST produce proof of execution using the available verification skills (recorded UI flows for frontend, test/benchmark output for backend).
- Commit using conventional commits prefixed "claude:".
- Push the branch and open a PR: gh pr create --repo ${repo} --title "..." --body "..."
  The PR body MUST contain the line "Closes #${issue.number}" and a "## Proof of execution" section with concrete evidence.

Protocol — the LAST line of your final message must be exactly one of:
- PR: <full URL of the PR you opened>
- QUESTION: <question for Omri — only if you are truly blocked on a decision only he can make>`;
}

export function reviewerPrompt(repo: string, prNumber: number): string {
  return `You are a workforce code reviewer for PR #${prNumber} on ${repo}. The PR branch is checked out in this directory.

- Review the changes using the /code-review skill.
- Verify the PR body's "## Proof of execution" section: the evidence must be concrete and actually demonstrate the change works. Hollow or missing proof is an automatic request-changes.
- Post your findings to the PR: gh pr review ${prNumber} --repo ${repo} --comment --body "..." (one comment summarizing all findings).

Protocol — the LAST line of your final message must be exactly one of:
- VERDICT: APPROVE
- VERDICT: REQUEST_CHANGES`;
}

export function answerPrompt(answer: string): string {
  return `Answer from Omri:
${answer}

Continue working. Protocol reminder — end your final message with one of:
- PR: <url>
- QUESTION: <text>`;
}

export function fixPrompt(instruction: string): string {
  return `${instruction}

Protocol reminder — end your final message with one of:
- PR: <url of the existing PR>
- QUESTION: <text>`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/prompts.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompts.ts tests/prompts.test.ts
git commit -m "claude: feat(prompts): worker and reviewer prompt templates"
```

---

### Task 9: Worktree management

**Files:**
- Create: `src/worktree.ts`

Thin git/gh subprocess glue — no unit tests; verified end-to-end in Task 15's smoke test.

- [ ] **Step 1: Implement**

`src/worktree.ts`:

```ts
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { branchName } from "./prompts.js";

function repoDirName(repo: string): string {
  return repo.replace("/", "__");
}

export async function ensureClone(workDir: string, repo: string): Promise<string> {
  const dir = join(workDir, "repos", repoDirName(repo));
  if (!existsSync(dir)) {
    mkdirSync(join(workDir, "repos"), { recursive: true });
    await execa("gh", ["repo", "clone", repo, dir]);
  }
  return dir;
}

export async function createWorktree(workDir: string, repo: string, issue: number): Promise<string> {
  const clone = await ensureClone(workDir, repo);
  const wt = join(workDir, "worktrees", `${repoDirName(repo)}__${issue}`);
  if (existsSync(wt)) return wt;
  mkdirSync(join(workDir, "worktrees"), { recursive: true });
  await execa("git", ["-C", clone, "fetch", "origin"]);
  const { stdout: head } = await execa("git", [
    "-C", clone, "symbolic-ref", "refs/remotes/origin/HEAD", "--short",
  ]);
  await execa("git", ["-C", clone, "worktree", "add", "-b", branchName(issue), wt, head.trim()]);
  return wt;
}

export async function removeWorktree(workDir: string, repo: string, issue: number): Promise<void> {
  const clone = join(workDir, "repos", repoDirName(repo));
  const wt = join(workDir, "worktrees", `${repoDirName(repo)}__${issue}`);
  await execa("git", ["-C", clone, "worktree", "remove", "--force", wt]).catch(() => {});
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/worktree.ts
git commit -m "claude: feat(worktree): server-side clones and per-issue worktrees"
```

---

### Task 10: Slack bridge

**Files:**
- Create: `src/slack.ts`
- Test: `tests/slack.test.ts`

`ThreadRouter` is pure and tested; `SlackBridge` wraps Bolt (socket mode) and is verified live in Task 15.

- [ ] **Step 1: Write the failing router tests**

`tests/slack.test.ts`:

```ts
import { it, expect, vi } from "vitest";
import { ThreadRouter } from "../src/slack.js";

it("routes thread replies to the registered issue", () => {
  const router = new ThreadRouter();
  const onReply = vi.fn();
  router.onReply = onReply;
  router.register("171.001", "o/r#7");
  router.handle({ thread_ts: "171.001", text: "use the global cache" });
  expect(onReply).toHaveBeenCalledWith("o/r#7", "use the global cache");
});

it("ignores bot messages, top-level messages and unknown threads", () => {
  const router = new ThreadRouter();
  const onReply = vi.fn();
  router.onReply = onReply;
  router.register("171.001", "o/r#7");
  router.handle({ thread_ts: "171.001", text: "x", bot_id: "B1" });
  router.handle({ text: "no thread" });
  router.handle({ thread_ts: "999.999", text: "x" });
  expect(onReply).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/slack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/slack.ts`:

```ts
import pkg from "@slack/bolt";
const { App } = pkg;

export interface IncomingMessage {
  thread_ts?: string;
  bot_id?: string;
  text?: string;
}

export class ThreadRouter {
  private threadToIssue = new Map<string, string>();
  onReply: (issueKey: string, text: string) => void = () => {};

  register(threadTs: string, issueKey: string): void {
    this.threadToIssue.set(threadTs, issueKey);
  }

  handle(m: IncomingMessage): void {
    if (!m.thread_ts || m.bot_id || !m.text) return;
    const key = this.threadToIssue.get(m.thread_ts);
    if (key) this.onReply(key, m.text);
  }
}

export class SlackBridge {
  readonly router = new ThreadRouter();
  private app: InstanceType<typeof App>;

  constructor(private channel: string) {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
    });
    this.app.message(async ({ message }) => this.router.handle(message as IncomingMessage));
  }

  async post(text: string, threadTs?: string): Promise<string> {
    const res = await this.app.client.chat.postMessage({
      channel: this.channel,
      text,
      thread_ts: threadTs,
    });
    return res.ts as string;
  }

  async start(): Promise<void> {
    await this.app.start();
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/slack.test.ts && npx tsc --noEmit`
Expected: 2 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/slack.ts tests/slack.test.ts
git commit -m "claude: feat(slack): thread router and socket-mode bridge"
```

---

### Task 11: Manager — dispatch and work phase

**Files:**
- Create: `src/manager.ts`
- Test: `tests/manager.test.ts`

The manager takes all side effects through an injected `Deps` interface so the state machine is testable with fakes.

- [ ] **Step 1: Write the failing tests**

`tests/manager.test.ts`:

```ts
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

it("flips an issue back to ready when the worker ends without a signal", async () => {
  const { manager, store, calls } = harness([ok("I crashed and burned")]);
  await manager.tick();
  await vi.waitFor(() => expect(store.get("o/r", 7)).toBeUndefined());
  expect(calls.labels.some((l) => l.add.includes("ready") && l.remove.includes("in-progress"))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the manager (work phase; review phase stub completes in Task 12)**

`src/manager.ts` — full file; `reviewPhase`, `watchMerges` and `recover` bodies are written here too (Task 12 only adds their tests):

```ts
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
      const status = state.status === "paused" ? state.pausedFrom! : state.status;
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/manager.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Run full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/manager.ts tests/manager.test.ts
git commit -m "claude: feat(manager): dispatch, work phase, quota pause, slack question loop"
```

---

### Task 12: Manager — review escalation, merge watch, recovery tests

**Files:**
- Modify: `tests/manager.test.ts` (append tests; implementation already landed in Task 11)

- [ ] **Step 1: Append the failing-or-passing tests**

Append to `tests/manager.test.ts`:

```ts
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
```

(The `deps` object is captured by reference in the harness — Task 11's harness returns it — so mutating `h.deps.getPR` after construction works without touching `Manager`.)

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/manager.test.ts`
Expected: all manager tests PASS (7 total).

- [ ] **Step 3: Commit**

```bash
git add tests/manager.test.ts
git commit -m "claude: test(manager): review escalation, merge watch, recovery"
```

---

### Task 13: Entry point and logging

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement**

`src/index.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { pino } from "pino";
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

const logger = pino(pino.destination(join(cfg.workDir, "manager.log")));
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
```

- [ ] **Step 2: Verify it boots and fails cleanly without args**

Run: `npx tsc --noEmit && npx tsx src/index.ts 2>&1 | head -3`
Expected: typecheck clean; runtime error `usage: tsx src/index.ts <config.json>`.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "claude: feat(index): wire deps and start the manager loop"
```

---

### Task 14: Architect skill

**Files:**
- Create: `skills/architect/SKILL.md`

- [ ] **Step 1: Write the skill**

`skills/architect/SKILL.md`:

```markdown
---
name: architect
description: Use when Omri wants to groom the backlog — discuss product goals and priorities, then turn decisions into fully-specified, dispatchable GitHub issues for the AI workforce.
---

# Chief Architect

You are Omri's chief architect. Your output is GitHub issues so complete that an autonomous
worker can implement them without ever asking a question. Run with the strongest available
model (opus).

## Workflow

1. Determine which repos are in scope (default: the `repos` list in the ai-workforce `config.json`).
2. Read the current state: `gh issue list --repo <repo> --state open`, recent PRs, and the
   relevant code areas for anything under discussion.
3. Discuss goals and priorities with Omri. Front-load EVERY clarifying question now — scope,
   edge cases, UX decisions, naming, acceptance bar. A question you skip here becomes a Slack
   interrupt later.
4. For each agreed piece of work, create one issue whose body is a complete spec:

   ## Goal
   ## Context            (pointers to relevant code areas, prior art, constraints)
   ## Requirements       (exact, testable)
   ## Acceptance criteria
   ## Proof of execution expected   (e.g. "recorded video of the login flow", "benchmark output")

   Express dependencies as plain lines in the body: `blocked-by: #N` (same repo only).

5. Label every issue before marking it ready:
   - exactly one priority: `p0` | `p1` | `p2`
   - exactly one model: `model:opus` (design-heavy or cross-cutting) | `model:sonnet`
     (well-specified routine work — the common case) | `model:haiku` (chores: docs, renames,
     dependency bumps)
   - `ready` LAST, only once the spec is final — the manager dispatches the moment it sees it.

6. Ensure the labels exist first (idempotent, ignore "already exists" errors):

   for l in ready in-progress paused p0 p1 p2 model:opus model:sonnet model:haiku; do
     gh label create "$l" --repo <repo> 2>/dev/null || true
   done

## Issue quality bar

- A worker with zero conversation context must be able to implement from the body alone.
- Scope each issue to a single PR. Split anything larger.
- If you and Omri have not settled a decision, the issue is not ready — keep discussing or
  leave it unlabeled.
```

- [ ] **Step 2: Install into ~/.claude and verify**

```bash
ln -sfn "$(pwd)/skills/architect" ~/.claude/skills/architect
ls -la ~/.claude/skills/architect/SKILL.md
```

Expected: symlink resolves to the repo file.

- [ ] **Step 3: Commit**

```bash
git add skills/architect/SKILL.md
git commit -m "claude: feat(architect): backlog grooming skill producing dispatchable issues"
```

---

### Task 15: Deploy — Slack app, ~/.claude sync repo, server bootstrap, systemd

**Files:**
- Create: `deploy/slack-manifest.json`, `deploy/workforce.service`, `deploy/setup-server.sh`

These are ops steps; the smoke test at the end is the verification.

- [ ] **Step 1: Slack app manifest**

`deploy/slack-manifest.json`:

```json
{
  "display_information": { "name": "AI Workforce" },
  "features": {
    "bot_user": { "display_name": "workforce", "always_online": true }
  },
  "oauth_config": {
    "scopes": {
      "bot": ["chat:write", "channels:history", "channels:read"]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": ["message.channels"]
    },
    "interactivity": { "is_enabled": false },
    "socket_mode_enabled": true
  }
}
```

Create the app at https://api.slack.com/apps → "From a manifest" → paste the JSON. Then:
- Generate an app-level token with `connections:write` scope → `SLACK_APP_TOKEN` (xapp-…).
- Install to workspace → `SLACK_BOT_TOKEN` (xoxb-…).
- Create the channel, invite the bot, copy the channel ID into `config.json` (`slackChannel`).

- [ ] **Step 2: Make ~/.claude a synced git repo (run on the laptop)**

```bash
cd ~/.claude
cat > .gitignore <<'EOF'
projects/
todos/
statsig/
shell-snapshots/
session-*
*.log
.credentials.json
EOF
git init && git add -A && git commit -m "claude: chore: initial claude config"
gh repo create omritoptix/claude-config --private --source . --push
```

Verify: `gh repo view omritoptix/claude-config` shows the repo. Review `git ls-files` before pushing — nothing credential-like may be tracked.

- [ ] **Step 3: Server bootstrap script**

`deploy/setup-server.sh`:

```bash
#!/usr/bin/env bash
# Run ON the Hetzner server as the dedicated 'workforce' user (one-time bootstrap).
set -euo pipefail

# toolchain
sudo apt-get update
sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
(type -p wget >/dev/null || sudo apt-get install -y wget) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
  && sudo apt-get update && sudo apt-get install -y gh
sudo npm install -g @anthropic-ai/claude-code

# auth (interactive)
gh auth login
claude setup-token   # authenticates Claude Code against the Max subscription

# config + code
git clone https://github.com/omritoptix/claude-config.git ~/.claude
git clone https://github.com/omritoptix/ai-workforce.git ~/ai-workforce
cd ~/ai-workforce && npm install
cp config.example.json config.json   # then edit: repos, workDir=/home/workforce/work, slackChannel
mkdir -p /home/workforce/work

echo "Now create /home/workforce/workforce.env with SLACK_BOT_TOKEN and SLACK_APP_TOKEN,"
echo "then: sudo cp deploy/workforce.service /etc/systemd/system/ && sudo systemctl enable --now workforce"
```

- [ ] **Step 4: systemd unit**

`deploy/workforce.service`:

```ini
[Unit]
Description=AI workforce manager
After=network-online.target
Wants=network-online.target

[Service]
User=workforce
WorkingDirectory=/home/workforce/ai-workforce
EnvironmentFile=/home/workforce/workforce.env
ExecStart=/usr/bin/npm start -- /home/workforce/ai-workforce/config.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Commit**

```bash
git add deploy/slack-manifest.json deploy/workforce.service deploy/setup-server.sh
git commit -m "claude: feat(deploy): slack manifest, server bootstrap, systemd unit"
```

- [ ] **Step 6: End-to-end smoke test (manual, after server setup)**

1. Pick a sandbox repo, add it to `config.json` on the server, restart: `sudo systemctl restart workforce`.
2. On the laptop, run an architect session (`/architect`) and create one trivial spec'd issue (e.g. "add a CONTRIBUTING.md") with `p1`, `model:haiku`, `ready`.
3. Watch: `journalctl -u workforce -f` and `tail -f /home/workforce/work/manager.log`.
4. Expected within ~2 minutes: issue labeled `in-progress` + assigned + commented; later a PR appears with a Proof of execution section; reviewer comment lands; Slack thread shows "ready for your final review".
5. Reply test: create a second issue whose spec deliberately omits a decision ("ask Omri whether X or Y"); confirm the question arrives in Slack, reply in-thread, confirm the worker resumes.
6. Merge the PR on GitHub; confirm the Slack ":tada:" message and that the state file and worktree are gone.

---

### Task 16: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:

```markdown
# AI Workforce

Personal AI workforce: a deterministic manager daemon dispatches headless Claude Code
sessions to implement GitHub issues spec'd by an architect agent, with Slack as the
human-in-the-loop channel. Design: `docs/superpowers/specs/2026-06-10-ai-workforce-design.md`.

## Flow

1. **Groom** (laptop): run `/architect`, create fully-specified issues — labels `p0..p2`,
   `model:opus|sonnet|haiku`, `ready`; dependencies via `blocked-by: #N` body lines.
2. **Dispatch** (server): the manager polls GitHub, picks up `ready` unblocked issues,
   spawns a worker (`claude -p`, model from the label) in a per-issue worktree.
3. **Work**: worker implements the spec, must include a `## Proof of execution` section in
   the PR. Blocked workers ask via Slack (reply in-thread; escalate with
   `claude --resume <session-id>` on the server).
4. **Review**: manager gates on the proof section, spawns reviewers (`/code-review`),
   loops worker fixes up to 3 rounds, then Slack-pings for final human review.
5. **Merge**: you merge; the manager cleans up and unblocks dependents.

Quota limits pause work (`paused` label) and auto-resume by priority.

## Layout

- `src/` — the manager daemon (TypeScript, run with `npm start -- config.json`)
- `skills/architect/` — the architect skill (symlink into `~/.claude/skills/`)
- `deploy/` — Slack manifest, server bootstrap, systemd unit

## Development

npm test / npm run typecheck. All side effects go through the `Deps` interface in
`src/manager.ts`; tests inject fakes.

## Server

See `deploy/setup-server.sh`. Skills/config sync: the server's `~/.claude` is a clone of
the private `claude-config` repo and is pulled before every session spawn — push a skill
from the laptop and the next dispatched agent uses it.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Spec coverage checklist (self-review)

- Entities & models: architect skill (Task 14, opus), manager deterministic (Tasks 11–13), workers per-label model (Tasks 2, 11), reviewers sonnet via `/code-review` (Tasks 8, 11). ✓
- GitHub-native state: labels/assign/comments (Tasks 7, 11), `blocked-by` parsing (Task 2), disk only for runtime bookkeeping (Task 3). ✓
- Lifecycle incl. unblock-on-merge: dispatch via open-set check + merge watch (Tasks 11, 12). ✓
- Proof of execution: prompt requirement (Task 8), structural gate (Tasks 4, 11), reviewer instruction (Task 8). ✓
- Slack thread-per-issue, reply routing, CLI escalation handle (Tasks 10, 11). ✓
- Quota pause/resume with priority stagger + labels (Task 11). ✓
- Skills sync: `~/.claude` repo (Task 15 step 2), pull-before-spawn (Task 13 `syncSkills`). ✓
- Failure handling: session timeout → failed → abort-to-ready (Tasks 6, 11), 3-round review cap → escalate (Tasks 11, 12), single log file (Task 13), restart recovery (Tasks 11, 12). ✓
```
