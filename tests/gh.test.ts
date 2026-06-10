import { it, expect, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";
import { listOpenIssues } from "../src/gh.js";

it("maps gh issue JSON to GhIssue", async () => {
  vi.mocked(execa).mockResolvedValueOnce({
    stdout: JSON.stringify([
      { number: 5, title: "t", body: null, labels: [{ name: "ready" }] },
    ]),
  } as never);
  const issues = await listOpenIssues("o/r");
  expect(issues).toEqual([
    { number: 5, title: "t", body: "", labels: ["ready"] },
  ]);
  expect(vi.mocked(execa).mock.calls[0][1]).toContain("--repo");
});
