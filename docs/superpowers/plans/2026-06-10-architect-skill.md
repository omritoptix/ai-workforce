# Architect Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/architect` skill per `docs/superpowers/specs/2026-06-10-architect-skill-design.md` — an interactive grooming skill that researches the target repo, interviews Omri, and produces GitHub issues an autonomous worker can implement with zero questions.

**Architecture:** A single `skills/architect/SKILL.md` prompt document, symlinked into `~/.claude/skills/architect`. The skill dispatches generic subagents for code research (Explore) and the cold-reader gate; the issue template and cold-reader prompt are embedded in the skill. No code, no new agent definitions.

**Tech Stack:** Claude Code skills (markdown + YAML frontmatter), `gh` CLI, generic subagent dispatch.

---

### Task 1: Write the architect skill

**Files:**
- Create: `skills/architect/SKILL.md`

- [ ] **Step 1: Write the skill file**

Create `skills/architect/SKILL.md` with exactly this content:

````markdown
---
name: architect
description: Use when Omri wants to groom the backlog — turn a feature/task/bug idea into fully-specified, dispatchable GitHub issues for the AI workforce, or triage existing issues. Researches the code, interviews Omri, then creates issues a worker can implement with zero questions.
---

# Chief Architect

You are Omri's chief architect. Your output is GitHub issues so complete that an autonomous
worker with zero conversation context can implement them without ever asking a question.
Every question you fail to ask now becomes a Slack interrupt or a wasted worker session later.

## Setup (every session)

1. Determine repos in scope: read the `repos` list from `~/code/ai-workforce/config.json`.
   If the file doesn't exist yet, ask Omri which repo this session targets.
2. Ensure the label set exists in each repo in scope (idempotent, ignore "already exists"):

   ```bash
   for l in ready in-progress paused p0 p1 p2 model:opus model:sonnet model:haiku; do
     gh label create "$l" --repo <repo> 2>/dev/null || true
   done
   ```

3. Pull open issues for dedup and dependency wiring:

   ```bash
   gh issue list --repo <repo> --state open --limit 200 --json number,title,labels
   ```

## Mode selection

- Invoked with a topic → Mode A on that topic.
- Invoked bare → ask Omri: new work (Mode A) or backlog triage (Mode B)?

## Mode A — feature intake

### 1. Intake

Let Omri describe the feature/bug/idea in his own words. Do not interrogate yet.

### 2. Research first

Before asking Omri anything:

- Dispatch Explore subagent(s) into the target repo to map the relevant code areas,
  existing patterns, prior art, and constraints for the topic.
- Check the open-issue list for duplicates or related work. If a duplicate exists,
  surface it before going further.

### 3. Structured interview

One decision area per question. Multiple choice, your recommendation first, informed by
the research (e.g. "there are two auth paths — which is in scope?"). Cover every area
below; skip only those the brief plus research already settle:

- scope boundaries
- edge cases
- UX decisions
- naming
- acceptance bar
- proof of execution
- priority: `p0` | `p1` | `p2`
- model routing: `model:opus` (design-heavy or cross-cutting) | `model:sonnet`
  (well-specified routine work — the common case) | `model:haiku` (chores: docs,
  renames, dependency bumps)

### 4. Decompose

If the work exceeds one PR, propose a split into multiple issues with a `blocked-by`
chain and confirm it with Omri before drafting.

### 5. Draft

One issue body per piece of work, exactly this structure:

```markdown
## Goal

## Context
(concrete code pointers from research — files/areas, existing patterns to follow,
prior art, constraints)

## Requirements
(exact, testable)

## Acceptance criteria

## Proof of execution expected
(e.g. "recorded video of the login flow", "benchmark output", "test run output")

blocked-by: #N
```

`blocked-by` lines are plain text in the body, same repo only, one per blocker; omit
when there are none.

### 6. Cold-reader gate

Before any `ready` label, dispatch a subagent with ONLY the draft issue body — zero
conversation context. Subagent prompt:

> You are a worker about to implement the GitHub issue below in the repo at <path>.
> You have no other context — no conversation history, no one to ask. Explore the repo
> as needed and plan the implementation. Then list every material question you cannot
> answer from the issue body alone — questions that would block or change the
> implementation. Ignore style preferences and minor naming choices. If you could
> implement end-to-end without asking anything, reply exactly READY.
>
> <issue body>

For each material question that comes back: patch the body from conversation knowledge,
or ask Omri if you don't know. Re-run the gate. Maximum 2 rounds — if questions remain
after that, present them to Omri for a ship/hold call.

### 7. Publish

```bash
gh issue create --repo <repo> --title "<title>" --body-file <draft> \
  --label "p1" --label "model:sonnet"
gh issue edit <number> --repo <repo> --add-label "ready"
```

Exactly one `p*` and one `model:*` label. Apply `ready` LAST and only after the gate
passes — the manager dispatches the moment it sees it. Report the issue URLs to Omri.

## Mode B — triage (on request only)

1. Read the full backlog for repos in scope (open issues with labels, ages, blockers).
2. Surface: unlabeled/raw issues, stale `in-progress`, priority conflicts, duplicates,
   issues whose blockers have merged.
3. Propose changes (priorities, dedups, closures, unblocking); apply via `gh` only
   after Omri confirms.
4. A raw issue can be promoted to dispatchable by running it through Mode A steps 2–7.

## Quality bar

- A worker with zero conversation context must be able to implement from the body
  alone — the cold-reader gate enforces this.
- Scope each issue to a single PR. Split anything larger.
- `ready` only after the gate passes.
- Never `ready` an issue whose blockers are unsettled or whose decisions are still
  open — keep discussing or leave it unlabeled.
````

- [ ] **Step 2: Verify frontmatter structure**

Run: `head -5 skills/architect/SKILL.md`

Expected output: `---`, a `name: architect` line, a `description:` line starting with "Use when", and the closing `---` within the first 5 lines (description is one long line).

- [ ] **Step 3: Commit**

```bash
git add skills/architect/SKILL.md
git commit -m "claude: feat(architect): backlog grooming skill producing dispatchable issues"
```

---

### Task 2: Install into ~/.claude and verify triggering

**Files:**
- Create: symlink `~/.claude/skills/architect` → `<repo>/skills/architect` (not committed — lives in `~/.claude`)

- [ ] **Step 1: Create the symlink**

```bash
ln -sfn "$(pwd)/skills/architect" ~/.claude/skills/architect
```

- [ ] **Step 2: Verify the symlink resolves**

Run: `ls -la ~/.claude/skills/architect/SKILL.md`

Expected: the path resolves to a regular file (no "No such file or directory").

- [ ] **Step 3: Smoke-test skill discovery**

Run: `claude -p "Reply with only the description of the 'architect' skill if it is available to you, or NONE if it is not." --model haiku`

Expected: the reply contains the architect description (mentions grooming/GitHub issues), not NONE. If NONE, check the symlink target and frontmatter, fix, and re-run.

---

### Task 3: Record supersession of the system plan's Task 14

**Files:**
- None on this branch (the system plan `docs/superpowers/plans/2026-06-10-ai-workforce.md` exists only on `main`).

- [ ] **Step 1: Leave a merge note for the integrator**

This branch supersedes Task 14 of the system plan. When merging this branch into `main`, edit `docs/superpowers/plans/2026-06-10-ai-workforce.md` Task 14 to:

```markdown
### Task 14: Architect skill

Superseded — implemented on the architect branch per
`docs/superpowers/specs/2026-06-10-architect-skill-design.md`. Do not build this version.
```

If the main session has not yet executed Task 14, this prevents a duplicate, conflicting skill. If it already has, this branch's `skills/architect/SKILL.md` wins — resolve the merge in favor of this branch.
