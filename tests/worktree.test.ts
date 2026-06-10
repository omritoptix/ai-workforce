import { it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";
import { ensureClone } from "../src/worktree.js";

it("shares one in-flight clone across concurrent ensureClone calls", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "wf-wt-"));
  let resolveClone!: () => void;
  vi.mocked(execa).mockReturnValue(
    new Promise<void>((resolve) => (resolveClone = resolve)) as never,
  );
  const a = ensureClone(workDir, "o/r");
  const b = ensureClone(workDir, "o/r");
  resolveClone();
  const dir = join(workDir, "repos", "o__r");
  expect(await a).toBe(dir);
  expect(await b).toBe(dir);
  expect(execa).toHaveBeenCalledTimes(1);
  expect(execa).toHaveBeenCalledWith("gh", ["repo", "clone", "o/r", dir]);
});
