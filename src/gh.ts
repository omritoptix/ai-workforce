import { execa } from "execa";
import { GhIssue } from "./issues.js";

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execa("gh", args);
  return stdout;
}

interface RawLabel {
  name: string;
}
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  labels: RawLabel[];
}

export async function listOpenIssues(repo: string): Promise<GhIssue[]> {
  const out = await gh([
    "issue", "list", "--repo", repo, "--state", "open", "--limit", "200",
    "--json", "number,title,body,labels",
  ]);
  return (JSON.parse(out) as RawIssue[]).map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: i.labels.map((l) => l.name),
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

export async function markReadyForReview(repo: string, number: number): Promise<void> {
  // `gh pr ready` errors if the PR is already ready; that's benign on re-entry, so swallow it.
  await gh(["pr", "ready", String(number), "--repo", repo]).catch(() => {});
}

export async function getPR(
  repo: string,
  number: number,
): Promise<{ body: string; mergedAt: string | null }> {
  const out = await gh(["pr", "view", String(number), "--repo", repo, "--json", "body,mergedAt"]);
  const pr = JSON.parse(out) as { body: string | null; mergedAt: string | null };
  return { body: pr.body ?? "", mergedAt: pr.mergedAt ?? null };
}
