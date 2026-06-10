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
  await execa("git", ["-C", clone, "branch", "-D", branchName(issue)]).catch(() => {});
  await execa("git", ["-C", clone, "worktree", "add", "-b", branchName(issue), wt, head.trim()]);
  return wt;
}

export async function removeWorktree(workDir: string, repo: string, issue: number): Promise<void> {
  const clone = join(workDir, "repos", repoDirName(repo));
  const wt = join(workDir, "worktrees", `${repoDirName(repo)}__${issue}`);
  await execa("git", ["-C", clone, "worktree", "remove", "--force", wt]).catch(() => {});
}
