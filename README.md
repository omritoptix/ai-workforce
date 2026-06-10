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

Quota limits pause work (`paused` label) and auto-resume by priority. Issues that exceed
the review cap or hit unrecoverable errors are escalated (Slack ping, left for the owner).
After resolving an escalated issue manually, delete its state file under `<workDir>/state/`
(and its worktree under `<workDir>/worktrees/` if you're done with it).

The Slack channel must be **public** (the app manifest only subscribes to public-channel
messages). `slackUserId` in the config is your Slack member ID, used to @mention you on
questions, escalations, and final-review pings.

## Layout

- `src/` — the manager daemon (TypeScript, run with `npm start -- config.json`)
- `deploy/` — Slack manifest, server bootstrap, systemd unit

## Onboarding a repo

Before the workforce can work a repo, create the required labels once:

```bash
for l in ready in-progress paused p0 p1 p2 model:opus model:sonnet model:haiku; do
  gh label create "$l" --repo <owner/repo> 2>/dev/null || true
done
```

Without this, the first dispatch fails on `--add-label`.

## Development

`npm test` / `npm run typecheck`. All side effects go through the `Deps` interface in
`src/manager.ts`; tests inject fakes.

## Server

See `deploy/setup-server.sh`. Skills/config sync: the server's `~/.claude` is a clone of
the private `claude-setup` repo and is pulled before every session spawn — push a skill
from the laptop and the next dispatched agent uses it.
