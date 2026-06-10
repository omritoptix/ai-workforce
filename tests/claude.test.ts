import { it, expect } from "vitest";
import { isQuotaError, parseSessionOutput } from "../src/claude.js";

it("parses a successful session", () => {
  const out = JSON.stringify({ session_id: "abc", result: "PR: https://x/pull/1", is_error: false });
  expect(parseSessionOutput(out)).toEqual({
    sessionId: "abc",
    text: "PR: https://x/pull/1",
    quotaHit: false,
    failed: false,
  });
});

it("flags quota errors", () => {
  const out = JSON.stringify({ session_id: "abc", result: "5-hour usage limit reached", is_error: true });
  const r = parseSessionOutput(out);
  expect(r.quotaHit).toBe(true);
  expect(r.failed).toBe(true);
});

it("detects quota phrasing variants", () => {
  expect(isQuotaError("Claude usage limit reached|resets 6pm")).toBe(true);
  expect(isQuotaError("rate limit exceeded")).toBe(true);
  expect(isQuotaError("type error in foo.ts")).toBe(false);
});
