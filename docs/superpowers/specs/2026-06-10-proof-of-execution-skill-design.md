# Proof-of-Execution Skill — Design

**Date:** 2026-06-10
**Status:** Approved
**Parent spec:** [2026-06-10-ai-workforce-design.md](2026-06-10-ai-workforce-design.md)

## Goal

The ai-workforce spec requires every worker PR to carry a "Proof of execution" section, produced by invoking Omri's verification skills. Those skills don't exist yet. This project delivers them: one umbrella skill, `proof-of-execution`, that any agent (workforce worker or interactive session) invokes before opening a PR, plus the public artifacts repo that hosts binary evidence.

Three consumers depend on it:

1. The worker prompt template invokes the skill by name.
2. The manager's structural pre-check gates reviewer dispatch on the section existing.
3. Reviewers treat a missing or hollow proof section as automatic request-changes.

## Decisions

- **Generic, not repo-derived.** Proof techniques are domain-generic ("record a Playwright video" works for any web frontend). Skills are instruction documents; the marginal cost of covering a domain is low and target repos will change.
- **One umbrella skill with domain reference files** over per-domain skills. The proof contract is the load-bearing part and must exist in exactly one place; domains are evidence-gathering recipes under it. Consumers reference one skill name forever; adding a domain later is a pure addition.
- **Dedicated private `proof-artifacts` repo** for binary evidence. GitHub PR bodies cannot receive video/image uploads via `gh`/API (drag-and-drop is browser-only). Omri keeps the repo private, which rules out inline `![]()` embeds entirely — GitHub's image proxy (camo) fetches anonymously and cannot reach private content. Proof sections therefore use plain markdown links to GitHub file-viewer URLs (`github.com/.../blob/...`), which render images and play videos for logged-in reviewers; agents fetch artifact bytes via the authenticated contents API when needed.
- **Mobile included but degraded.** Workers run on a headless Linux box: iOS simulators require macOS (impossible), Android emulators need KVM and are heavy for a small Hetzner server. Mobile proof = unit/snapshot test output, plus Playwright evidence for RN-web-compatible components; emulator-dependent claims go under "Not verified".

## Skill shape

Location: `~/.claude/skills/proof-of-execution/` (synced to the server via the `~/.claude` git repo, per the parent spec).

```
proof-of-execution/
├── SKILL.md              # contract + domain routing
├── references/
│   ├── frontend.md       # Playwright video/screenshot recipe
│   ├── backend.md        # test/bench/smoke-transcript recipe
│   ├── cli.md            # command-transcript recipe
│   └── mobile.md         # degraded recipe
└── scripts/
    └── upload_artifacts.sh
```

SKILL.md defines the universal contract and routes by repo inspection: package.json with a UI framework → frontend; React Native → mobile; service/server code → backend; bin/main-only → cli. A repo can match several domains (full-stack → frontend + backend evidence). Reference files load only when their domain matches (progressive disclosure).

## Proof contract

Every PR body gets a `## Proof of execution` section containing one or more **claim → evidence** pairs:

- **Claim:** the behavior being proven ("user can create an issue via the form").
- **Evidence:** fresh output produced in this worktree at this commit — fenced command output, an embedded screenshot, or a video link. Raw output only; no paraphrasing.
- **Not verified:** a mandatory final line listing anything that couldn't be proven and why. This honesty valve is what makes the degraded mobile recipe legitimate rather than a loophole.

The manager's structural check stays dumb: heading exists and section is non-empty. Reviewers judge whether evidence actually supports claims.

## Artifacts repo and upload script

- Repo: `omritoptix/proof-artifacts`, private.
- Layout: `<target-repo>/<issue-N>/<file>`.
- `scripts/upload_artifacts.sh <repo> <issue> <files...>`: shallow-clones the artifacts repo, copies files in, commits, pushes (rebase-retry for concurrent workers; idempotent on re-run), prints GitHub file-viewer URLs ready to link. Workers never improvise git mechanics.
- Auth: whatever `gh`/git credentials the environment already has. On this machine that is the fine-grained PAT stored in the ai-workforce repo's gitignored `.env` — it speaks REST only (GraphQL returns 401, so `gh` porcelain like `gh issue close` fails; use `gh api`).

## Domain recipes

- **frontend:** drive the real app with Playwright (reusing the `webapp-testing` skill's helpers), record video of each user-facing flow, screenshot end states, assert zero console errors.
- **backend:** full test-suite output with counts, plus a live smoke transcript (start the service, curl the changed endpoints, show responses); benchmark output when performance is claimed.
- **cli:** literal command transcripts with exit codes; for daemons, startup log plus health-check output.
- **mobile (degraded):** unit/snapshot test output; Playwright evidence for RN-web-compatible components; everything emulator-dependent listed under "Not verified".

## Out of scope

Wiring into the worker/reviewer prompt templates and the manager's structural check belongs to the ai-workforce repo work. This project delivers the skill those templates will invoke, plus the artifacts repo.

## Testing

Built with the `skill-creator` skill (installed at `~/.claude/skills/skill-creator/`), then verified end-to-end: invoke the skill against a small real repo, confirm it produces a contract-conformant proof section, and confirm a really-uploaded artifact is stored and linkable (file-viewer URL in a GitHub issue, bytes retrievable via the contents API).
