import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { writeReport } from "./report.js";
import { build, coverage, tests } from "./stages/foundry.js";
import { fuzz } from "./stages/fuzz.js";
import { gambit } from "./stages/gambit.js";
import { halmos } from "./stages/halmos.js";
import { medusa } from "./stages/medusa.js";
import { slither } from "./stages/slither.js";
import type { RunContext, StageResult } from "./types.js";
import { prepareWorkspace } from "./workspace.js";

const STAGES = { build, tests, coverage, slither, fuzz, medusa, halmos, mutation: gambit };
type StageName = keyof typeof STAGES;

function usage(): never {
  console.error(
    [
      "Usage: preaudit run <foundry-project-dir> [options]",
      "",
      "  --out <dir>          run folder (default: reports/<project>-<timestamp>)",
      "  --harness <dir>      extra tests layered onto a copy of the project; put them under test/preaudit/",
      `  --only <stages>      comma-separated subset of: ${Object.keys(STAGES).join(",")}`,
      "  --mutate <files>     comma-separated files to mutate (default: non-interface files in src/)",
      "  --mutants <n>        max mutants per file (default 40)",
      "  --solc <version>     solc version for mutation testing (default: read from the pragma)",
      "  --fuzz-runs <n>      runs per fuzz test in the fuzz stage (default 5000)",
      "  --invariant-runs <n> runs per invariant test (default 256)",
      "  --invariant-depth <n> calls per invariant run (default 100)",
      "  --medusa-seconds <n> Medusa campaign length (default 300)",
    ].join("\n"),
  );
  process.exit(2);
}

async function main() {
  const [command, target, ...rest] = process.argv.slice(2);
  if (command !== "run" || !target) usage();

  const targetDir = path.resolve(target);
  if (!existsSync(path.join(targetDir, "foundry.toml"))) {
    console.error(`No foundry.toml in ${targetDir}: only Foundry projects are supported for now.`);
    process.exit(2);
  }

  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(flag("--out") ?? path.join("reports", `${path.basename(targetDir)}-${stamp}`));
  mkdirSync(outDir, { recursive: true });

  const harness = flag("--harness");
  const workDir = prepareWorkspace(targetDir, outDir, harness && path.resolve(harness));

  const only = flag("--only")?.split(",") as StageName[] | undefined;
  const selected = (Object.keys(STAGES) as StageName[]).filter((s) => !only || only.includes(s));

  const ctx: RunContext = {
    targetDir,
    outDir,
    workDir,
    mutate: flag("--mutate")?.split(","),
    maxMutants: Number(flag("--mutants") ?? 40),
    solcVersion: flag("--solc"),
    fuzzRuns: Number(flag("--fuzz-runs") ?? 5000),
    invariantRuns: Number(flag("--invariant-runs") ?? 256),
    invariantDepth: Number(flag("--invariant-depth") ?? 100),
    medusaSeconds: Number(flag("--medusa-seconds") ?? 300),
  };

  const results: StageResult[] = [];
  for (const name of selected) {
    process.stdout.write(`▸ ${name} ... `);
    const result = await STAGES[name](ctx);
    results.push(result);
    console.log(`${result.status} (${(result.durationMs / 1000).toFixed(1)}s) ${result.summary}`);
    if (name === "build" && result.status === "failed") {
      console.error(result.log);
      console.error("Build failed, stopping.");
      break;
    }
  }

  const { mdPath, jsonPath } = writeReport(ctx, results);
  console.log(`\nReport:   ${mdPath}\nFindings: ${jsonPath}`);
}

main();
