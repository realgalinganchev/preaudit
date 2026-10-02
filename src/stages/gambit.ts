import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureImage, inContainer } from "../docker.js";
import { HARNESS_GLOB, type Finding, type RunContext, type StageResult } from "../types.js";

interface MutantMeta {
  id: string;
  description: string;
  diff: string;
  original: string;
}

/** Mutation testing with Gambit: every mutant the test suite does not catch is a test gap. */
export async function gambit(ctx: RunContext): Promise<StageResult> {
  const image = await ensureImage();
  if (!image.ok) {
    return { name: "mutation", status: "failed", durationMs: 0, summary: "Could not build the Docker tools image", findings: [], log: image.log };
  }

  const files = ctx.mutate ?? sourceFiles(ctx.workDir);
  if (files.length === 0) {
    return { name: "mutation", status: "skipped", durationMs: 0, summary: "No source files to mutate", findings: [], log: "" };
  }
  const solc = ctx.solcVersion ?? pragmaVersion(path.join(ctx.workDir, files[0]));
  if (!solc) {
    return { name: "mutation", status: "failed", durationMs: 0, summary: `Could not read the solc version from ${files[0]}; pass --solc`, findings: [], log: "" };
  }

  const r = await inContainer(
    ctx,
    `NUM_MUTANTS=${ctx.maxMutants} TEST_ARGS='--no-match-path ${HARNESS_GLOB}' bash /preaudit/mutation-test.sh ${solc} /out/mutation.jsonl ${files.join(" ")}`,
    120 * 60_000,
  );

  const jsonl = path.join(ctx.outDir, "mutation.jsonl");
  const rows = existsSync(jsonl)
    ? readFileSync(jsonl, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const errors = rows.filter((x) => x.error).map((x) => x.error as string);
  const statuses = rows.filter((x) => x.status) as { file: string; id: string; status: string }[];
  if (statuses.length === 0) {
    return { name: "mutation", status: "failed", durationMs: r.durationMs, summary: errors[0] ?? "No mutants were tested", findings: [], log: r.stdout + r.stderr };
  }

  const meta = new Map<string, MutantMeta>();
  for (const f of readdirSync(ctx.outDir).filter((f) => f.startsWith("gambit_results_"))) {
    for (const m of JSON.parse(readFileSync(path.join(ctx.outDir, f), "utf8")) as MutantMeta[]) {
      meta.set(`${m.original}#${m.id}`, m);
    }
  }

  const survived = statuses.filter((s) => s.status === "survived");
  const killed = statuses.length - survived.length;
  const findings: Finding[] = survived.map((s) => {
    const m = meta.get(`${s.file}#${s.id}`);
    const line = m?.diff.match(/@@ -(\d+)/)?.[1];
    return {
      tool: "gambit",
      id: `mutant-${s.id}`,
      title: `Test gap: ${m?.description ?? "mutation"} survives`,
      severity: "low",
      confidence: "medium",
      locations: [line ? `${s.file}#L${line}` : s.file],
      description: `The code was changed like this and every test still passed:\n${m?.diff.trim() ?? "(diff unavailable)"}`,
    };
  });

  const score = Math.round((killed / statuses.length) * 100);
  return {
    name: "mutation",
    status: "ok",
    durationMs: r.durationMs,
    summary: `mutation score ${score}% (${killed} of ${statuses.length} mutants killed)${errors.length ? `; ${errors.length} errors` : ""}`,
    findings,
    log: r.stdout + r.stderr,
  };
}

function sourceFiles(workDir: string): string[] {
  const src = path.join(workDir, "src");
  if (!existsSync(src)) return [];
  return (readdirSync(src, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".sol") && !/(^|[\\/])I[A-Z]/.test(f) && !/interfaces?[\\/]/i.test(f))
    .map((f) => path.posix.join("src", f.split(path.sep).join("/")));
}

function pragmaVersion(file: string): string | undefined {
  return readFileSync(file, "utf8").match(/pragma solidity\s*[\^~>=<]*\s*(\d+\.\d+\.\d+)/)?.[1];
}
