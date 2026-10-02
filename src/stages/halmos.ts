import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureImage, inContainer } from "../docker.js";
import type { Finding, RunContext, StageResult } from "../types.js";

/**
 * Symbolic execution with Halmos. It proves or refutes every `check_*` function in the test
 * contracts, so it only has something to do once properties exist (in the project or the harness).
 */
export async function halmos(ctx: RunContext): Promise<StageResult> {
  // Halmos would also pick up `invariant_*` tests and explore them symbolically, which blows up
  // on any real handler. Point it only at the contracts that define check_* properties.
  const contracts = contractsWithChecks(path.join(ctx.workDir, "test"));
  if (contracts.length === 0) {
    return { name: "halmos", status: "skipped", durationMs: 0, summary: "No check_* properties to prove; add some via --harness", findings: [] };
  }
  const image = await ensureImage();
  if (!image.ok) {
    return { name: "halmos", status: "failed", durationMs: 0, summary: "Could not build the Docker tools image", findings: [], log: image.log };
  }

  // Foundry 1.x rewrites `new Contract(...)` in tests into vm.deployCode(...) ("dynamic test
  // linking"), a cheatcode Halmos doesn't support; build the plain way for Halmos.
  const r = await inContainer(
    ctx,
    `FOUNDRY_DYNAMIC_TEST_LINKING=false NO_COLOR=1 halmos --loop 5 --match-contract '^(${contracts.join("|")})$' 2>&1`,
    30 * 60_000,
  );
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  const results = [...out.matchAll(/^\[(PASS|FAIL|TIMEOUT|ERROR)\]\s+(\S+\(.*?\))/gm)];

  if (results.length === 0) {
    const none = /No tests with/i.test(out) || /no .*check_/i.test(out);
    return {
      name: "halmos",
      status: none ? "skipped" : "failed",
      durationMs: r.durationMs,
      summary: none ? "No check_* properties to prove; add some via --harness" : "Halmos produced no results",
      findings: [],
      log: out,
    };
  }

  const findings: Finding[] = [];
  for (const m of results) {
    const [line, verdict, fn] = m;
    if (verdict === "PASS") continue;
    findings.push({
      tool: "halmos",
      id: `${fn.split("(")[0]}`,
      title: verdict === "FAIL" ? `Property violated: ${fn}` : `Property not decided (${verdict.toLowerCase()}): ${fn}`,
      severity: verdict === "FAIL" ? "high" : "info",
      confidence: verdict === "FAIL" ? "high" : "low",
      locations: [],
      description: verdict === "FAIL" ? counterexampleBefore(out, m.index!) : line,
    });
  }

  if (/InvalidOpcode\(254\)/.test(out)) {
    findings.push({
      tool: "halmos",
      id: "invalid-opcode",
      title: "A path hit the INVALID opcode: a PASS may be hiding a violated property",
      severity: "medium",
      confidence: "medium",
      locations: [],
      description:
        "Before Solidity 0.8, a failing `assert` compiles to INVALID (0xfe), which Halmos does not report as a failure. " +
        "Check the trace with `halmos -vvvvv`, and in pre-0.8 harnesses revert with Panic(1) instead of using `assert`.",
    });
  }

  const tally = (v: string) => results.filter((m) => m[1] === v).length;
  return {
    name: "halmos",
    status: "ok",
    durationMs: r.durationMs,
    summary: `${tally("PASS")} proven, ${tally("FAIL")} violated, ${tally("TIMEOUT") + tally("ERROR")} undecided`,
    findings,
    log: out,
  };
}

function contractsWithChecks(testDir: string): string[] {
  if (!existsSync(testDir)) return [];
  const names: string[] = [];
  for (const f of readdirSync(testDir, { recursive: true }) as string[]) {
    if (!f.endsWith(".sol")) continue;
    const parts = readFileSync(path.join(testDir, f), "utf8").split(/\bcontract\s+(\w+)/);
    // split with a capture group alternates: [before, name1, body1, name2, body2, ...]
    for (let i = 1; i < parts.length; i += 2) if (/function\s+check_/.test(parts[i + 1])) names.push(parts[i]);
  }
  return names;
}

/** Halmos prints the inputs that break a property in a "Counterexample:" block just before the [FAIL] line. */
function counterexampleBefore(out: string, failIndex: number): string {
  const before = out.slice(0, failIndex);
  const start = before.lastIndexOf("Counterexample:");
  if (start < 0) return "Halmos found a counterexample.";
  const values = before
    .slice(start + "Counterexample:".length)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return `Counterexample found by Halmos (inputs that break the property):\n${values.join("\n")}`;
}
