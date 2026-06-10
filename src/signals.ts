export type Signal =
  | { kind: "question"; text: string }
  | { kind: "pr"; number: number }
  | { kind: "verdict"; approve: boolean }
  | { kind: "none" };

export function parseSignal(text: string): Signal {
  const lines = text.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("QUESTION:")) {
      const rest = [line.slice("QUESTION:".length), ...lines.slice(i + 1)].join("\n").trim();
      return { kind: "question", text: rest };
    }
    const pr = line.match(/^PR:\s*\S*\/pull\/(\d+)/);
    if (pr) return { kind: "pr", number: Number(pr[1]) };
    const v = line.match(/^VERDICT:\s*(APPROVE|REQUEST_CHANGES)\b/);
    if (v) return { kind: "verdict", approve: v[1] === "APPROVE" };
  }
  return { kind: "none" };
}
