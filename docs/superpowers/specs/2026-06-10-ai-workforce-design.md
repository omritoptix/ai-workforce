# AI Workforce — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

A personal AI workforce for Omri's repos. Omri's role shrinks to: groom the backlog with an architect agent, answer occasional questions in Slack, and do final PR review + merge. Everything between issue creation and "PR ready for final review" is handled by agents.

Hard constraints:

- Runs entirely on Omri's Claude Max subscription (Claude Code sessions). No pay-per-use API credits.
- Cheap to operate: one small always-on server (Hetzner), no managed services.
- Max parallelism: every dispatchable issue is picked up immediately; subscription usage limits are handled by pausing and resuming, not by conservative scheduling.

## Entities

| Entity | What it is | Where it runs | Model |
|---|---|---|---|
| Architect | Interactive CLI session (a skill, e.g. `/architect`). Reads repo state + open issues, discusses goals/priorities with Omri, creates fully-specified GitHub issues. | Omri's laptop | Opus |
| Manager | Deterministic daemon — plain code, zero LLM. Watches GitHub, dispatches/resumes/pauses sessions, bridges Slack, updates issue state. | Hetzner | None |
| Workers | Headless Claude Code sessions, one per issue, in an isolated worktree of the target repo. Execute the spec, open a PR with proof of execution. | Hetzner | Per-issue `model:*` label, set by the architect |
| Reviewers | Headless sessions spawned on PR open. Run the `/code-review` skill, post PR comments. | Hetzner | Sonnet default; architect can bump via label |
| Omri | Runs architect sessions, answers Slack threads, final review + merge. | — | — |

### Model routing

Routing is decided once per issue, at creation time, by the architect — the smartest entity at the cheapest moment. Encoded as a GitHub label:

- `model:opus` — design-heavy or cross-cutting work
- `model:sonnet` — well-specified routine features and fixes (the common case; rich specs are what make one subscription stretch)
- `model:haiku` — chores: docs, renames, dependency bumps

The manager reads the label and passes `--model` when spawning. It has no routing intelligence of its own.

## State: GitHub-native

GitHub is the database. No SQLite, no second source of truth.

- Priority: labels (`p0`/`p1`/`p2`)
- Dispatchability: `ready` label (only architect sessions apply it; raw issues filed outside grooming wait for the next session)
- Dependencies: `blocked-by: #N` references in the issue body
- Status: `ready` → `in-progress` → (`paused` on quota) → closed by PR merge
- Assignment: issue assignee + a manager comment naming the agent/session, later the PR link

Runtime-only bookkeeping (session ids, usage accounting, pause checkpoints) lives in files on the server. Claude Code persists session state on disk, so pause/resume is free.

## Issue lifecycle

1. **Groom (laptop):** Omri runs an architect session. Together they create issues via `gh`: full spec in the body, `priority`, `model:*`, `ready` labels, `blocked-by` references. The architect front-loads all clarifying questions here so workers rarely need to ask.
2. **Dispatch (server):** the manager sees a `ready` issue with no unmerged blockers → assigns it, swaps `ready` → `in-progress`, comments with the agent/session id, spawns a worker with the labeled model in a fresh worktree.
3. **Work:** the worker implements per spec. If genuinely blocked, it asks — the manager posts the question to the issue's Slack thread; Omri's reply resumes the session.
4. **PR:** the worker opens a PR linking the issue, with a mandatory **Proof of execution** section.
5. **Review loop:** the manager does a structural check (proof section present and non-empty — no tokens spent reviewing unproven PRs), then spawns reviewers. Reviewer comments resume the worker session to fix; loop until approval, capped at 3 rounds before escalating to Omri.
6. **Final review:** the manager pings Slack — "PR #N ready for final review." Omri reviews and merges.
7. **Unblock:** merge closes the issue; the manager re-checks the dependency graph and dispatches newly-unblocked issues.

## Proof of execution

Every PR must prove the change works. Examples: recorded videos of frontend flows (Playwright records video on a headless box), measurable test output or benchmarks for backend. Enforced in three cheap layers:

1. The worker prompt template requires invoking Omri's proof/verification skills (synced to the server, see below) and filling the PR's "Proof of execution" section.
2. The manager's structural pre-check gates reviewer dispatch on the section existing.
3. Reviewers treat a missing or hollow proof section as an automatic request-changes.

## Slack mechanics

One channel; one thread per issue. The manager runs a Slack app in socket mode (no public endpoint on the server). It posts: agent questions (with @mention), "PR ready for final review", quota pauses/resumes, worker failures.

Replies in a thread route back: the manager resumes that issue's session with the reply as input. Every question message carries the escalation handle — `ssh hetzner && claude --resume <session-id>` — for conversations that deserve a real terminal. While Omri holds the session in the CLI, the manager backs off and reclaims it when he exits.

## Usage limits: pause/resume

The manager spawns greedily but tracks outcomes. When sessions fail with quota errors: stop spawning, label affected issues `paused`, note it in Slack, keep session ids on disk. On window reset: resume paused sessions in priority order, then dispatch new issues. Priorities exist primarily for this moment — scheduling is otherwise greedy.

## Skills and config sync

Omri's `~/.claude` (skills, agents, CLAUDE.md, rules) becomes a git repo. The server clones it as its own `~/.claude`; the manager pulls before each session spawn. A skill written on the laptop and pushed is used by the next dispatched worker — no other mechanism.

This repo (`ai-workforce`) holds: the manager daemon, the architect skill, worker/reviewer prompt templates, and a config file listing target repos.

## Failure handling

- Worker crashes or wedges (no progress, no question, past a timeout) → manager posts to the Slack thread with the session id and flips the issue back to `ready`, or holds for Omri's call.
- Review loop exceeds 3 rounds → escalate to Omri instead of burning quota.
- Quota exhaustion → pause/resume flow above; labels always reflect reality so the GitHub board never lies.
- All manager actions append to one log file on the server for overnight auditing.

## Decisions log

- Personal tool, not a product. YAGNI applies everywhere.
- Always-on Hetzner server over laptop or GitHub Actions (long-lived sessions, pause/resume, no ephemerality).
- Deterministic manager over an LLM manager: intelligence belongs in the spec, not the scheduler; orchestration tokens are wasted tokens.
- Daemon-spawned reviewers over GitHub Actions reviewers: one runtime, one auth, manager can coordinate and pause them.
- Architect is CLI-only and laptop-only; issues are born fully specified. The server never spawns an architect.
