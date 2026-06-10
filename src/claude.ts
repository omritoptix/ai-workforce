import { execa } from "execa";

export interface SessionResult {
  sessionId: string;
  text: string;
  quotaHit: boolean;
  failed: boolean;
}

export interface RunSessionOpts {
  prompt: string;
  cwd: string;
  model: string;
  resume?: string;
  timeoutMs: number;
}

export function isQuotaError(text: string): boolean {
  return /usage limit|rate.?limit/i.test(text);
}

export function parseSessionOutput(stdout: string): SessionResult {
  const json = JSON.parse(stdout);
  const text: string = json.result ?? "";
  return {
    sessionId: json.session_id ?? "",
    text,
    quotaHit: json.is_error === true && isQuotaError(text),
    failed: json.is_error === true,
  };
}

export async function runSession(opts: RunSessionOpts): Promise<SessionResult> {
  const args = ["-p", "--output-format", "json", "--dangerously-skip-permissions", "--model", opts.model];
  if (opts.resume) args.push("--resume", opts.resume);
  args.push(opts.prompt);
  try {
    const { stdout } = await execa("claude", args, { cwd: opts.cwd, timeout: opts.timeoutMs });
    return parseSessionOutput(stdout);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    return { sessionId: opts.resume ?? "", text: out, quotaHit: isQuotaError(out), failed: true };
  }
}
