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
- Push the branch and open the PR as a DRAFT: gh pr create --draft --repo ${repo} --title "..." --body "..."
  Open it as a draft on purpose — the workforce reviewers will mark it "ready for review" once they approve. Do not mark it ready yourself.
  The PR body MUST contain the line "Closes #${issue.number}" and a "## Proof of execution" section with concrete evidence.

Protocol — the LAST line of your final message must be exactly one of:
- PR: <full URL of the PR you opened>
- QUESTION: <question for Omri — only if you are truly blocked on a decision only he can make>`;
}

export function reviewerPrompt(repo: string, prNumber: number, round: number): string {
  const deltaSection =
    round > 0
      ? `\nThis is re-review round ${round + 1}. Earlier rounds already posted full reviews. Read the previous review comments and the new commits with gh, then comment ONLY on the delta: which previous findings are resolved, which remain, and any NEW issues introduced by the fixes. Do not re-state unchanged findings in full.\n`
      : "";
  return `You are a workforce code reviewer for PR #${prNumber} on ${repo}. The PR branch is checked out in this directory.

- Review the changes using the /code-review skill.
- Verify the PR body's "## Proof of execution" section: the evidence must be concrete and actually demonstrate the change works. Hollow or missing proof is an automatic request-changes.
- Post your findings as EXACTLY ONE review comment: gh pr review ${prNumber} --repo ${repo} --comment --body "..." — never post more than one.
${deltaSection}
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
