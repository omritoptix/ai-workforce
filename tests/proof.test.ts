import { it, expect } from "vitest";
import { hasProofOfExecution } from "../src/proof.js";

it("accepts a PR body with a non-empty proof section", () => {
  expect(hasProofOfExecution("Closes #1\n\n## Proof of execution\n- test output: 12 passed")).toBe(true);
});

it("accepts when proof is followed by another section", () => {
  expect(hasProofOfExecution("## Proof of execution\nvideo.mp4 attached\n## Notes\nfoo")).toBe(true);
});

it("rejects a missing section", () => {
  expect(hasProofOfExecution("Closes #1\njust a description")).toBe(false);
});

it("rejects an empty section", () => {
  expect(hasProofOfExecution("## Proof of execution\n\n## Notes\nfoo")).toBe(false);
});
