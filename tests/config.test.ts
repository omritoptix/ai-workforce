import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

const valid = {
  repos: ["o/r"],
  workDir: "/tmp/wf",
  slackChannel: "C123",
  slackUserId: "U123",
  pollIntervalMs: 60000,
  maxReviewRounds: 3,
  sessionTimeoutMs: 3600000,
  quotaRetryMs: 900000,
};

function writeTmp(obj: object): string {
  const p = join(mkdtempSync(join(tmpdir(), "wf-")), "c.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

it("loads a valid config", () => {
  expect(loadConfig(writeTmp(valid)).repos).toEqual(["o/r"]);
});

it("throws on a missing key", () => {
  const { quotaRetryMs: _, ...incomplete } = valid;
  expect(() => loadConfig(writeTmp(incomplete))).toThrow("quotaRetryMs");
});

it("loads without forceModel, leaving it undefined", () => {
  expect(loadConfig(writeTmp(valid)).forceModel).toBeUndefined();
});

it("exposes forceModel when set", () => {
  expect(loadConfig(writeTmp({ ...valid, forceModel: "opus" })).forceModel).toBe("opus");
});
