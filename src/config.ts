import { readFileSync } from "node:fs";

export interface Config {
  repos: string[];
  workDir: string;
  slackChannel: string;
  slackUserId: string;
  pollIntervalMs: number;
  maxReviewRounds: number;
  sessionTimeoutMs: number;
  quotaRetryMs: number;
  forceModel?: string;
}

const KEYS: (keyof Config)[] = [
  "repos",
  "workDir",
  "slackChannel",
  "slackUserId",
  "pollIntervalMs",
  "maxReviewRounds",
  "sessionTimeoutMs",
  "quotaRetryMs",
];

export function loadConfig(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  for (const key of KEYS) {
    if (raw[key] === undefined) throw new Error(`config missing key: ${key}`);
  }
  return raw as Config;
}
