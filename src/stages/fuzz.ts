import { exec } from "../exec.js";
import type { Finding, RunContext, StageResult } from "../types.js";

interface Call {
  sender?: string | null;
  contract_name?: string | null;
  func_name?: string | null;
  signature?: string | null;
  raw_args?: string | null;
}
interface Counterexample {
  Single?: Call;
  /** forge emits `[shrunk call count, calls]` */
  Sequence?: [number, Call[]] | Call[];
}
interface TestResult {
  status: string;
  reason?: string | null;
  counterexample?: Counterexample | null;
  /** DSTest-style asserts (older forge-std) report their message here, not in `reason`. */
  decoded_logs?: string[];
  kind: Record<string, unknown>;
}

/**
 * Deep property run: every fuzz and invariant test, from the project and the harness, with far
 * more runs than a normal `forge test`. A failure here comes with a concrete reproduction, so it
 * is reported as high severity.
 */
export async function fuzz(ctx: RunContext): Promise<StageResult> {
  const { r, parsed } = await forgeTest(ctx, []);
  if (!parsed) {
    return { name: "fuzz", status: "failed", durationMs: r.durationMs, summary: "Could not read forge test output", findings: [], log: r.stdout + r.stderr };
  }

  // On the run that discovers an invariant failure, forge reports the counterexample as null and
  // only saves the call sequence to its cache; a replay of just those tests prints it.
  const missing = Object.values(parsed).flatMap(({ test_results }) =>
    Object.entries(test_results)
      .filter(([, res]) => "Invariant" in (res.kind ?? {}) && res.status !== "Success" && !res.counterexample)
      .map(([test]) => test.split("(")[0]),
  );
  if (missing.length > 0) {
    const replay = await forgeTest(ctx, ["--match-test", `^(${missing.join("|")})\\(`]);
    for (const [suite, { test_results }] of Object.entries(replay.parsed ?? {})) {
      for (const [test, res] of Object.entries(test_results)) {
        const original = parsed[suite]?.test_results[test];
        if (original && !original.counterexample) original.counterexample = res.counterexample;
      }
    }
  }

  let fuzzCount = 0;
  let invariantCount = 0;
  const findings: Finding[] = [];
  for (const [suite, { test_results }] of Object.entries(parsed)) {
    for (const [test, res] of Object.entries(test_results)) {
      const kind = Object.keys(res.kind ?? {})[0];
      if (kind !== "Fuzz" && kind !== "Invariant") continue;
      kind === "Fuzz" ? fuzzCount++ : invariantCount++;
      if (res.status === "Success") continue;
      findings.push({
        tool: kind === "Fuzz" ? "forge-fuzz" : "forge-invariant",
        id: test.split("(")[0],
        title: `${kind === "Fuzz" ? "Fuzz property" : "Invariant"} broken: ${test.split("(")[0]}`,
        severity: "high",
        confidence: "high",
        locations: [suite.split(":")[0]],
        description: [failureMessage(res), renderCounterexample(test, res.counterexample)].filter(Boolean).join("\n"),
      });
    }
  }

  if (fuzzCount + invariantCount === 0) {
    return { name: "fuzz", status: "skipped", durationMs: r.durationMs, summary: "No fuzz or invariant tests; add some via --harness", findings: [], log: r.stderr };
  }
  return {
    name: "fuzz",
    status: "ok",
    durationMs: r.durationMs,
    summary: `${fuzzCount} fuzz + ${invariantCount} invariant properties (${ctx.fuzzRuns} fuzz runs, ${ctx.invariantRuns}×${ctx.invariantDepth} invariant calls): ${findings.length} broken`,
    findings,
    log: r.stderr,
  };
}

type ForgeJson = Record<string, { test_results: Record<string, TestResult> }>;

async function forgeTest(ctx: RunContext, extraArgs: string[]) {
  const r = await exec("forge", ["test", "--json", "-vv", ...extraArgs], {
    cwd: ctx.workDir,
    timeoutMs: 60 * 60_000,
    env: {
      FOUNDRY_FUZZ_RUNS: String(ctx.fuzzRuns),
      FOUNDRY_INVARIANT_RUNS: String(ctx.invariantRuns),
      FOUNDRY_INVARIANT_DEPTH: String(ctx.invariantDepth),
    },
  });
  const start = r.stdout.indexOf("{");
  let parsed: ForgeJson | undefined;
  try {
    parsed = start >= 0 ? JSON.parse(r.stdout.slice(start)) : undefined;
  } catch {
    parsed = undefined;
  }
  return { r, parsed };
}

function failureMessage(res: TestResult): string {
  const logged = (res.decoded_logs ?? []).filter((l) => /^(Error|\s*(Left|Right|Expected|Actual|Value a|Value b))/i.test(l)).map((l) => l.trim());
  const reason = res.reason && res.reason !== "<empty revert data>" ? res.reason : undefined;
  return [reason, ...logged].filter(Boolean).join("\n");
}

function renderCounterexample(test: string, c?: Counterexample | null): string {
  if (!c) return "";
  if (c.Single) return `Breaking input: ${test.split("(")[0]}(${c.Single.raw_args ?? ""})`;
  const calls = Array.isArray(c.Sequence?.[1]) ? (c.Sequence[1] as Call[]) : ((c.Sequence ?? []) as Call[]);
  if (calls.length === 0) return "";
  const fmt = (x: Call) => {
    const target = x.contract_name?.split(":").pop();
    return `${target ? `${target}.` : ""}${x.func_name ?? x.signature ?? "?"}(${x.raw_args ?? ""})${x.sender ? ` from ${x.sender}` : ""}`;
  };
  return `Call sequence that breaks it (shrunk):\n${calls.map((x, i) => `${i + 1}. ${fmt(x)}`).join("\n")}`;
}
