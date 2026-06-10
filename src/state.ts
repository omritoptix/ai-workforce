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
