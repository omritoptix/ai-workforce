# Architect Skill — Design

**Date:** 2026-06-10
**Status:** Approved
**Supersedes:** Task 14 of `docs/superpowers/plans/2026-06-10-ai-workforce.md`

## Goal

A `/architect` skill that turns a conversation with Omri into GitHub issues so complete that an autonomous worker can implement them without ever asking a question. It is the intelligence-front-loading point of the AI workforce: every question the architect fails to ask becomes a Slack interrupt or a wasted worker session later.

## Why a skill, not an agent

The architect's core job is interviewing Omri. Subagents run headless and cannot talk to the user mid-run; only the main interactive session can hold a back-and-forth conversation. The architect is therefore a skill running in Omri's laptop session (per the system design spec), and it *dispatches* subagents for the parts that don't need Omri: code research and the cold-reader gate.

## Packaging

Single `skills/architect/SKILL.md` in this repo, symlinked into `~/.claude/skills/architect`. The issue body template and the cold-reader prompt are embedded in the skill — no `references/` files.

## Entry

`/architect [topic]`

- With a topic: straight into feature intake on that topic.
- Without: ask what's on the agenda — new work, or backlog triage.

## Setup (every session)

1. Read the `repos` list from the ai-workforce `config.json` to determine scope.
2. Ensure the label set exists per repo (idempotent): `ready`, `in-progress`, `paused`, `p0`–`p2`, `model:opus|sonnet|haiku`.
3. Pull open issue titles + labels for repos in scope — needed for dedup and `blocked-by` wiring.

## Mode A — feature intake (core flow)

1. **Intake.** Omri describes the feature/bug/idea in free text.
2. **Research first.** Dispatch Explore subagent(s) into the target repo to map relevant code areas, existing patterns, prior art, and constraints. Scan open issues for duplicates and related work. The architect asks Omri nothing until this homework is done.
3. **Structured interview.** One decision area per question, multiple-choice with a recommendation, informed by the research. Areas to cover — skipping any the brief plus research already settle:
   - scope boundaries
   - edge cases
   - UX decisions
   - naming
   - acceptance bar
   - proof of execution
   - priority (`p0`/`p1`/`p2`)
   - model routing (`model:*`)
4. **Decompose.** If the work exceeds one PR, propose a split into multiple issues with a `blocked-by` chain; confirm with Omri.
5. **Draft.** Issue body per the fixed template:

   ```
   ## Goal
   ## Context              (concrete code pointers from research, prior art, constraints)
   ## Requirements         (exact, testable)
   ## Acceptance criteria
   ## Proof of execution expected
   blocked-by: #N          (plain lines, same repo only)
   ```

6. **Cold-reader gate.** Dispatch a subagent that sees ONLY the issue body — zero conversation context. Prompt: "Plan the implementation. List every material question you cannot answer from the body alone." For each question that comes back, the architect patches the body from conversation knowledge or asks Omri, then re-runs the gate. Capped at 2 rounds; remaining questions go to Omri for a ship/hold call. Style nits from the cold reader are ignored — only implementation-blocking questions count.
7. **Publish.** Create the issue via `gh` with exactly one `p*` and one `model:*` label plus any `blocked-by` lines. Apply `ready` LAST — the manager dispatches the moment it appears. Report the issue URLs.

## Mode B — triage (on request only)

Read the full backlog for repos in scope. Surface raw/unlabeled/stale issues and priority conflicts. Propose priority changes, dedups, and unblocking; apply via `gh` only after Omri confirms. A raw issue (filed outside grooming) can be promoted through the same interview → gate pipeline from Mode A.

## Quality bar

- A worker with zero conversation context must be able to implement from the body alone — the cold-reader gate enforces this.
- Scope each issue to a single PR; split anything larger.
- `ready` only after the gate passes.
- Never `ready` an issue whose blockers are unsettled or whose decisions remain open — keep discussing or leave it unlabeled.

## Model routing heuristics

Unchanged from the system design spec: `model:opus` for design-heavy or cross-cutting work, `model:sonnet` for well-specified routine work (the common case), `model:haiku` for chores.

## Out of scope

- No manager interaction, no server awareness. The skill's only outputs are GitHub issues and labels.
- No new agent definitions — research and cold-reading use the generic subagent dispatch.

## Coordination

This design supersedes the plan's Task 14 draft. When this branch merges, mark Task 14 as done-by-this-branch so the main session doesn't build the older version over it.
