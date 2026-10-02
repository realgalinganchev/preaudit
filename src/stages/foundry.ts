import { exec } from "../exec.js";
import { HARNESS_GLOB, type RunContext, type StageResult } from "../types.js";

export async function build(ctx: RunContext): Promise<StageResult> {
  const r = await exec("forge", ["build"], { cwd: ctx.workDir, timeoutMs: 10 * 60_000 });
  return {
    name: "build",
    status: r.code === 0 ? "ok" : "failed",
    durationMs: r.durationMs,
    summary: r.code === 0 ? "Compiled" : "Compilation failed: later stages will be unreliable",
    findings: [],
    log: r.stdout + r.stderr,
  };
}

interface ForgeTestJson {
  [suite: string]: { test_results: { [test: string]: { status: string; reason?: string | null } } };
}

export async function tests(ctx: RunContext): Promise<StageResult> {
  const r = await exec("forge", ["test", "--json", "--no-match-path", HARNESS_GLOB], { cwd: ctx.workDir, timeoutMs: 20 * 60_000 });
  const start = r.stdout.indexOf("{");
  let parsed: ForgeTestJson | undefined;
  try {
    parsed = start >= 0 ? JSON.parse(r.stdout.slice(start)) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!parsed) {
    return { name: "tests", status: "failed", durationMs: r.durationMs, summary: "Could not read forge test output", findings: [], log: r.stdout + r.stderr };
  }

  const failed: string[] = [];
  let passed = 0;
  for (const [suite, { test_results }] of Object.entries(parsed)) {
    for (const [test, res] of Object.entries(test_results)) {
      if (res.status === "Success") passed++;
      else failed.push(`${suite} :: ${test}${res.reason ? ` (${res.reason})` : ""}`);
    }
  }
  return {
    name: "tests",
    status: failed.length === 0 ? "ok" : "failed",
    durationMs: r.durationMs,
    summary: `${passed} passed, ${failed.length} failed`,
    findings: failed.map((f, i) => ({
      tool: "forge-test",
      id: `failing-test-${i + 1}`,
      title: "Failing test",
      severity: "low",
      confidence: "high",
      locations: [f.split(" :: ")[0]],
      description: f,
    })),
    log: r.stderr,
  };
}

export async function coverage(ctx: RunContext): Promise<StageResult> {
  // Only production code counts: harness and script files would dilute the percentages.
  const r = await exec("forge", ["coverage", "--report", "summary", "--no-match-coverage", "(^|/)(test|script)/", "--no-match-path", HARNESS_GLOB], {
    cwd: ctx.workDir,
    timeoutMs: 20 * 60_000,
  });
  const totalRow = r.stdout.split(/\r?\n/).find((l) => /^\|\s*Total\s*\|/.test(l));
  if (r.code !== 0 || !totalRow) {
    return { name: "coverage", status: "failed", durationMs: r.durationMs, summary: "forge coverage failed", findings: [], log: r.stdout + r.stderr };
  }
  // | Total | lines | statements | branches | funcs |
  const [lines, statements, branches, funcs] = totalRow.split("|").map((c) => c.trim()).filter(Boolean).slice(1);
  return {
    name: "coverage",
    status: "ok",
    durationMs: r.durationMs,
    summary: `lines ${lines} · statements ${statements} · branches ${branches} · functions ${funcs}`,
    findings: [],
    log: r.stdout,
  };
}
