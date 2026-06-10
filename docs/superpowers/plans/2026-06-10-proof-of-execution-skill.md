# Proof-of-Execution Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `proof-of-execution` skill (umbrella SKILL.md + four domain reference files + artifact upload script) and the public `proof-artifacts` repo, verified end-to-end with a really-uploaded artifact rendering in a GitHub comment.

**Architecture:** One skill at `~/.claude/skills/proof-of-execution/` defining the universal proof contract and routing to domain recipes loaded on demand. Binary evidence is pushed to the public `omritoptix/proof-artifacts` repo by a shared bash script that prints ready-to-embed raw URLs. `~/.claude` is an existing git repo (`omritoptix/claude-setup`); skill files are committed there, not in this worktree.

**Tech Stack:** Markdown skills (Claude Code skill format), bash, `gh` CLI, Playwright (referenced by the frontend recipe via the existing `webapp-testing` skill).

**Spec:** `docs/superpowers/specs/2026-06-10-proof-of-execution-skill-design.md`

**Note on TDD:** Skills are instruction documents — there is no unit-test harness for markdown. Each task substitutes the closest real verification: scripts are exercised against the live artifacts repo, SKILL.md is checked with skill-creator's `quick_validate.py`, and Task 6 is a true end-to-end test (upload → embed → confirm GitHub's image proxy serves it). Run every verification step; do not skip on the grounds that "it's just markdown."

---

### Task 1: Create the public proof-artifacts repo

**Files:** none (GitHub-side only)

- [ ] **Step 1: Verify the repo doesn't already exist**

Run: `gh repo view omritoptix/proof-artifacts 2>&1 | head -3`
Expected: `Could not resolve to a Repository` error. If it already exists, stop and ask Omri — do not reuse blindly.

- [ ] **Step 2: Create the repo**

```bash
gh repo create omritoptix/proof-artifacts --public --add-readme \
  --description "Proof-of-execution artifacts (videos, screenshots) embedded in PRs by AI workers"
```

- [ ] **Step 3: Verify it exists, is public, and has a main branch**

Run: `gh repo view omritoptix/proof-artifacts --json visibility,defaultBranchRef -q '{vis: .visibility, branch: .defaultBranchRef.name}'`
Expected: `{"branch":"main","vis":"PUBLIC"}`

---

### Task 2: Upload script

**Files:**
- Create: `~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh`

- [ ] **Step 1: Create the skill directory skeleton**

```bash
mkdir -p ~/.claude/skills/proof-of-execution/scripts ~/.claude/skills/proof-of-execution/references
```

- [ ] **Step 2: Write the script**

Create `~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh`:

```bash
#!/usr/bin/env bash
# Pushes proof artifacts to the public artifacts repo and prints their raw URLs,
# ready to embed in a PR body. Workers must use this instead of improvising git.
# Usage: upload_artifacts.sh <target-repo-name> <issue-number> <file>...
set -euo pipefail

ARTIFACTS_REPO="omritoptix/proof-artifacts"
BRANCH="main"

[ "$#" -ge 3 ] || { echo "usage: $(basename "$0") <target-repo-name> <issue-number> <file>..." >&2; exit 1; }

repo_name="$1"
issue="$2"
shift 2

for f in "$@"; do
  [ -f "$f" ] || { echo "no such file: $f" >&2; exit 1; }
  base="$(basename "$f")"
  case "$base" in
    *[!A-Za-z0-9._-]*) echo "filename must contain only [A-Za-z0-9._-]: $base" >&2; exit 1 ;;
  esac
done

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

gh repo clone "$ARTIFACTS_REPO" "$workdir/repo" -- --depth 1 --quiet >&2

dest="$workdir/repo/${repo_name}/issue-${issue}"
mkdir -p "$dest"
cp "$@" "$dest/"

git -C "$workdir/repo" add -A
git -C "$workdir/repo" commit --quiet -m "proof: ${repo_name}#${issue}"

# Parallel workers push concurrently; rebase-retry on non-fast-forward.
for attempt in 1 2 3; do
  if git -C "$workdir/repo" push --quiet origin "$BRANCH"; then
    break
  fi
  [ "$attempt" -lt 3 ] || { echo "push failed after 3 attempts" >&2; exit 1; }
  git -C "$workdir/repo" pull --rebase --quiet origin "$BRANCH"
done

for f in "$@"; do
  echo "https://raw.githubusercontent.com/${ARTIFACTS_REPO}/${BRANCH}/${repo_name}/issue-${issue}/$(basename "$f")"
done
```

- [ ] **Step 3: Make executable and syntax-check**

Run: `chmod +x ~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh && bash -n ~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh && echo OK`
Expected: `OK`

- [ ] **Step 4: Verify argument validation fails correctly**

Run: `~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh _smoke-test 0 2>&1; echo "exit=$?"`
Expected: usage line and `exit=1`.

Run: `~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh _smoke-test 0 /tmp/does-not-exist.png 2>&1; echo "exit=$?"`
Expected: `no such file: /tmp/does-not-exist.png` and `exit=1`.

- [ ] **Step 5: Verify a real upload round-trips**

```bash
# 1x1 red PNG, deterministic test artifact
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > /tmp/smoke.png
url=$(~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh _smoke-test 0 /tmp/smoke.png)
echo "url: $url"
curl -sI "$url" | head -3
```

Expected: the printed URL is `https://raw.githubusercontent.com/omritoptix/proof-artifacts/main/_smoke-test/issue-0/smoke.png` and curl shows `HTTP/2 200`. (Raw CDN can lag a few seconds after push; retry the curl once before concluding failure. The `_smoke-test/` directory stays in the artifacts repo permanently — it is itself proof the pipeline works.)

- [ ] **Step 6: Commit (in the ~/.claude repo)**

`~/.claude` has unrelated dirty files (`CLAUDE.md`, `settings.json`) — stage only the skill path.

```bash
git -C ~/.claude add skills/proof-of-execution/scripts/upload_artifacts.sh
git -C ~/.claude commit -m "claude: feat(skills): add proof artifact upload script"
```

---

### Task 3: SKILL.md — contract and routing

**Files:**
- Create: `~/.claude/skills/proof-of-execution/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `~/.claude/skills/proof-of-execution/SKILL.md`:

````markdown
---
name: proof-of-execution
description: Produce the mandatory "Proof of execution" PR section before opening any PR or claiming implementation work complete. Gathers fresh evidence — Playwright videos and screenshots for frontend, test and smoke-transcript output for backend, command transcripts for CLI tools — and uploads binary artifacts to the public proof-artifacts repo for inline embedding. Use whenever a PR is about to be opened, a task requires proof of execution, or work needs verifiable evidence that it runs.
---

# Proof of Execution

Every PR must prove the change works. This skill defines the proof contract and the
recipes for gathering evidence per domain. Reviewers reject PRs whose proof section
is missing or hollow — paraphrased claims without raw evidence count as hollow.

## The contract

The PR body MUST contain a `## Proof of execution` section with one or more
claim → evidence pairs, followed by a mandatory `Not verified` line:

```markdown
## Proof of execution

### <claim — the user-visible behavior being proven>
**How:** <the exact command run, or the flow driven>
**Evidence:**
<fenced raw output, ![screenshot](raw-url), or [video](raw-url)>

### <next claim>
...

**Not verified:** <anything you could not prove, and why — or "nothing; all behaviors above are proven">
```

Rules:

- **Fresh evidence only.** Generate everything in this worktree at the current HEAD,
  after your final code change. Stale evidence is worse than none.
- **Raw output, never paraphrase.** Trim only irrelevant noise; keep counts, exit
  codes, timings intact.
- **One claim per changed behavior.** If the diff changes three behaviors, prove three claims.
- **The `Not verified` line is mandatory.** It is the honesty valve: stating limits
  truthfully is acceptable; omitting them is not.

## Gathering evidence: route by repo type

Inspect the repo and read every matching reference file (multiple can apply — a
full-stack repo needs frontend AND backend evidence):

| Signal | Read |
|---|---|
| UI framework in package.json (react, next, vue, svelte, angular) | [references/frontend.md](references/frontend.md) |
| react-native or expo in package.json | [references/mobile.md](references/mobile.md) |
| HTTP service / API / worker process (Go, Rust, Python, Node server code) | [references/backend.md](references/backend.md) |
| CLI tool or daemon with no UI and no HTTP API | [references/cli.md](references/cli.md) |

## Uploading binary artifacts

PR bodies cannot receive file uploads via `gh`. Push videos/screenshots through the
helper, which prints raw URLs ready to embed:

```bash
~/.claude/skills/proof-of-execution/scripts/upload_artifacts.sh <target-repo-name> <issue-number> <file>...
```

- Filenames must use only `[A-Za-z0-9._-]` (they become URL path segments).
- Embed images inline: `![end state](<raw-url>)`
- Link videos (GitHub does not inline raw video URLs): `[video: create-issue flow](<raw-url>)`
````

- [ ] **Step 2: Validate skill structure**

Run: `python3 /Users/omridagan/.claude/skills/skill-creator/scripts/quick_validate.py ~/.claude/skills/proof-of-execution`
Expected: validation passes. (If `yaml` is missing: `python3 -m venv /tmp/sv && /tmp/sv/bin/pip -q install pyyaml && /tmp/sv/bin/python /Users/omridagan/.claude/skills/skill-creator/scripts/quick_validate.py ~/.claude/skills/proof-of-execution`.)

- [ ] **Step 3: Commit**

```bash
git -C ~/.claude add skills/proof-of-execution/SKILL.md
git -C ~/.claude commit -m "claude: feat(skills): add proof-of-execution contract"
```

---

### Task 4: Frontend and mobile recipes

**Files:**
- Create: `~/.claude/skills/proof-of-execution/references/frontend.md`
- Create: `~/.claude/skills/proof-of-execution/references/mobile.md`

- [ ] **Step 1: Write frontend.md**

Create `~/.claude/skills/proof-of-execution/references/frontend.md`:

````markdown
# Frontend evidence

Required evidence for any user-facing change:

1. **Video of each changed flow** — drive the real app with Playwright, recording.
2. **Screenshot of the end state** of each flow.
3. **Zero console errors** — assert it; a passing flow with console errors is not proof.

## Recipe

Use the `webapp-testing` skill's server helper to manage the dev server
(`python3 ~/.claude/skills/webapp-testing/scripts/with_server.py --help` for usage),
then run a recording script like this:

```python
# proof_flow.py — adapt selectors/flow to the change under test
from playwright.sync_api import sync_playwright

console_errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(
        record_video_dir="proof/",
        viewport={"width": 1280, "height": 720},
    )
    page = context.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto("http://localhost:3000")
    # ... drive the flow under test: clicks, fills, waits ...
    page.wait_for_load_state("networkidle")
    page.screenshot(path="proof/end-state.png")

    context.close()  # flushes the .webm into proof/
    browser.close()

assert not console_errors, f"console errors: {console_errors}"
print("flow recorded, no console errors")
```

Playwright writes the video as `proof/<hash>.webm` — rename it to something
descriptive (`create-issue-flow.webm`) before uploading.

## Producing the proof section

- Upload `proof/*.webm` and `proof/*.png` with `upload_artifacts.sh`.
- One claim per flow. Evidence: the video link, the embedded end-state screenshot,
  and the script's "no console errors" output in a fenced block.
- Headless boxes have no display; Playwright's default headless mode is exactly
  what this recipe expects — do not try to use headed mode.
````

- [ ] **Step 2: Write mobile.md**

Create `~/.claude/skills/proof-of-execution/references/mobile.md`:

````markdown
# Mobile evidence (degraded environment)

Workers run on headless Linux: iOS simulators are impossible (macOS-only) and
Android emulators are not installed. Mobile proof is therefore weaker by design —
the contract's `Not verified` line is what keeps it honest.

Required evidence:

1. **Full unit/snapshot test output** — run the suite (e.g. `npx jest 2>&1 | tail -30`),
   include the summary counts in a fenced block.
2. **Playwright evidence for web-compatible components** — if the project supports
   react-native-web (an `npm run web` / expo web target exists), drive the changed
   screens in a browser using the frontend recipe
   ([frontend.md](frontend.md)) and include video/screenshots.
3. **Explicit `Not verified` entries** for everything that needs a device or
   emulator: native modules, gestures, platform-specific rendering, navigation
   transitions. Name them concretely — "tap-and-hold reordering on device" — not
   generically ("device testing").

Never simulate or describe device behavior as if observed. If it ran nowhere, it
goes under `Not verified`.
````

- [ ] **Step 3: Commit**

```bash
git -C ~/.claude add skills/proof-of-execution/references/frontend.md skills/proof-of-execution/references/mobile.md
git -C ~/.claude commit -m "claude: feat(skills): add frontend and mobile proof recipes"
```

---

### Task 5: Backend and CLI recipes

**Files:**
- Create: `~/.claude/skills/proof-of-execution/references/backend.md`
- Create: `~/.claude/skills/proof-of-execution/references/cli.md`

- [ ] **Step 1: Write backend.md**

Create `~/.claude/skills/proof-of-execution/references/backend.md`:

````markdown
# Backend evidence

Required evidence:

1. **Full test-suite output with counts** — the whole suite, not just new tests:

   ```bash
   go test ./... 2>&1 | tail -20        # Go
   cargo test 2>&1 | tail -20           # Rust
   npx vitest run 2>&1 | tail -20       # TS/JS
   python -m pytest 2>&1 | tail -20     # Python
   ```

   Include the tail with pass/fail counts in a fenced block. A truncated tail that
   hides the summary line is hollow evidence.

2. **Live smoke transcript for changed endpoints/handlers** — start the real
   service, hit the changed surface, show raw responses:

   ```bash
   ./service &            # or: go run ./cmd/server &, docker compose up -d, etc.
   sleep 2
   curl -s -i http://localhost:8080/api/the-changed-endpoint -d '{"example": 1}'
   kill %1
   ```

   Evidence is the full curl output: status line, relevant headers, body. One curl
   per changed endpoint, including at least one error-path call (bad input → the
   expected 4xx) when the change touches validation.

3. **Benchmarks — only when the PR claims performance.** A perf claim without
   numbers is hollow; include before/after output (`go test -bench`, `hyperfine`,
   etc.) in a fenced block.

If the service cannot run locally (needs cloud-only deps), say exactly what was
substituted (e.g. dockerized postgres) and put the rest under `Not verified`.
````

- [ ] **Step 2: Write cli.md**

Create `~/.claude/skills/proof-of-execution/references/cli.md`:

````markdown
# CLI / daemon evidence

Required evidence:

1. **Command transcripts** — for each changed command/flag, the literal invocation,
   its full output, and its exit code:

   ```bash
   $ mytool sync --dry-run
   ... full output ...
   $ echo $?
   0
   ```

   Include at least one failure-path invocation (bad args → expected error message
   and non-zero exit) when the change touches argument handling.

2. **Daemons:** startup log through the "ready" line, then a health-check or one
   real request against it, then clean shutdown:

   ```bash
   $ ./mydaemon --config dev.toml &
   ... startup log ending in the listening/ready line ...
   $ curl -s http://localhost:9090/healthz
   {"status":"ok"}
   $ kill %1
   ```

3. **Full test-suite output with counts**, same as the backend recipe — run the
   whole suite and include the summary tail in a fenced block.

Transcripts must be real terminal output, copied verbatim. Reconstructing "what it
would print" is fabrication, not proof.
````

- [ ] **Step 3: Re-validate the whole skill**

Run: `python3 /Users/omridagan/.claude/skills/skill-creator/scripts/quick_validate.py ~/.claude/skills/proof-of-execution`
Expected: validation passes.

- [ ] **Step 4: Commit**

```bash
git -C ~/.claude add skills/proof-of-execution/references/backend.md skills/proof-of-execution/references/cli.md
git -C ~/.claude commit -m "claude: feat(skills): add backend and cli proof recipes"
```

---

### Task 6: End-to-end verification — artifact renders on GitHub

**Files:** none (GitHub-side only; reuses `/tmp/smoke.png` and the Task 2 upload)

- [ ] **Step 1: Open a smoke-test issue embedding the uploaded artifact**

```bash
gh issue create -R omritoptix/proof-artifacts \
  --title "smoke: proof pipeline render check" \
  --body "## Proof of execution

### Uploaded artifact renders inline
**How:** upload_artifacts.sh _smoke-test 0 /tmp/smoke.png
**Evidence:**
![smoke](https://raw.githubusercontent.com/omritoptix/proof-artifacts/main/_smoke-test/issue-0/smoke.png)

**Not verified:** nothing; this issue exists to prove the render pipeline."
```

Expected: prints the new issue URL (issue #1).

- [ ] **Step 2: Verify GitHub's image proxy actually serves the embed**

GitHub rewrites embedded images through camo; if camo serves it, reviewers see it inline.

```bash
camo_url=$(gh api repos/omritoptix/proof-artifacts/issues/1 \
  -H "Accept: application/vnd.github.html+json" -q .body_html \
  | grep -o 'https://camo.githubusercontent.com/[^"]*' | head -1)
echo "camo: $camo_url"
curl -sI "$camo_url" | head -5
```

Expected: `HTTP/2 200` and `content-type: image/png`. This is the spec's "renders inline in a GitHub comment" criterion. If no camo URL appears in `body_html`, the embed is broken — investigate before proceeding (most likely cause: the artifacts repo is not public).

- [ ] **Step 3: Close the smoke issue (keep it as a record)**

```bash
gh issue close 1 -R omritoptix/proof-artifacts --comment "Render verified: camo served the embedded artifact with HTTP 200 image/png."
```

---

### Task 7: Live skill invocation against a small real repo

**Files:**
- Create: `/tmp/proof-skill-test/greet.sh` (throwaway fixture)

- [ ] **Step 1: Create a tiny CLI fixture repo**

```bash
rm -rf /tmp/proof-skill-test && mkdir /tmp/proof-skill-test && cd /tmp/proof-skill-test
git init -q
cat > greet.sh <<'EOF'
#!/usr/bin/env bash
[ "$#" -eq 1 ] || { echo "usage: greet.sh <name>" >&2; exit 1; }
echo "hello, $1"
EOF
chmod +x greet.sh
git add -A && git commit -qm "init"
```

- [ ] **Step 2: Invoke the skill headlessly and capture the proof section**

```bash
cd /tmp/proof-skill-test
claude -p 'Use the proof-of-execution skill to produce the "Proof of execution" PR section for this repo as it stands (the greet.sh CLI). Output only the section markdown. Do not upload any artifacts.' \
  > /tmp/proof-skill-test/proof-output.md 2>&1
```

- [ ] **Step 3: Check the output is contract-conformant**

```bash
grep -c '^## Proof of execution' /tmp/proof-skill-test/proof-output.md
grep -c '^\*\*Not verified:\*\*' /tmp/proof-skill-test/proof-output.md
grep -c 'exit' /tmp/proof-skill-test/proof-output.md
```

Expected: each grep returns ≥ 1 — the section heading exists, the mandatory `Not verified` line exists, and the evidence includes real transcripts with exit codes (the CLI recipe). Read `proof-output.md` yourself and judge: does the evidence contain literal `greet.sh` output (e.g. `hello, ...` and the usage-error path)? If the section is hollow or paraphrased, the skill's wording failed its first contact — fix SKILL.md / references/cli.md accordingly and re-run this task before proceeding.

- [ ] **Step 4: Clean up the fixture**

```bash
rm -rf /tmp/proof-skill-test
```

---

### Task 8: Sync ~/.claude to its remote

**Files:** none (git only)

- [ ] **Step 1: Commit the skill-creator install (added earlier this session, still untracked)**

```bash
git -C ~/.claude add skills/skill-creator
git -C ~/.claude commit -m "chore(skills): vendor anthropics skill-creator"
```

- [ ] **Step 2: Review what's about to be pushed**

Run: `git -C ~/.claude log origin/main..HEAD --oneline`
Expected: exactly the commits from Tasks 2–5 plus the skill-creator vendor commit (5 total). Unrelated dirty files (`CLAUDE.md`, `settings.json`) must NOT appear in any of them — verify with `git -C ~/.claude diff --stat origin/main..HEAD | grep -E 'CLAUDE\.md|settings\.json'` returning nothing.

- [ ] **Step 3: Push**

```bash
git -C ~/.claude push origin main
```

Expected: push succeeds. Per the parent spec, this is the sync mechanism — the next dispatched worker pulls these skills automatically.
