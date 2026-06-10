export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

export function modelLabel(labels: string[]): string | undefined {
  return labels.find((l) => l.startsWith("model:"))?.slice("model:".length);
}

export function priorityLabel(labels: string[]): number {
  const l = labels.find((l) => /^p[0-9]$/.test(l));
  return l ? Number(l.slice(1)) : 2;
}

export function blockedBy(body: string): number[] {
  return [...body.matchAll(/^blocked-by:\s*#(\d+)/gim)].map((m) => Number(m[1]));
}

export function isDispatchable(issue: GhIssue, openNumbers: Set<number>): boolean {
  if (!issue.labels.includes("ready")) return false;
  if (modelLabel(issue.labels) === undefined) return false;
  return blockedBy(issue.body).every((n) => !openNumbers.has(n));
}
