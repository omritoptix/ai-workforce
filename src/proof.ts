export function hasProofOfExecution(prBody: string): boolean {
  const m = prBody.match(/^##\s*Proof of execution\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);
  return !!m && m[1].trim().length > 0;
}
