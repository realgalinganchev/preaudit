import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { exec } from "../exec.js";
import { REPO_ROOT } from "../paths.js";
import type { Finding, RunContext, Severity, StageResult } from "../types.js";

/** Prefer the repo's own venv so the pipeline doesn't depend on whatever Slither is on PATH. */
function slitherBin(): string {
  if (process.env.SLITHER_BIN) return process.env.SLITHER_BIN;
  const venv = process.platform === "win32" ? ".venv/Scripts/slither.exe" : ".venv/bin/slither";
  const local = path.join(REPO_ROOT, venv);
  return existsSync(local) ? local : "slither";
}

const IMPACT: Record<string, Severity> = {
  High: "high",
  Medium: "medium",
  Low: "low",
  Informational: "info",
  Optimization: "gas",
};

interface SlitherDetector {
  check: string;
  impact: string;
  confidence: string;
  description: string;
  elements: { source_mapping?: { filename_relative?: string; lines?: number[] } }[];
}

export async function slither(ctx: RunContext): Promise<StageResult> {
  const jsonPath = path.join(ctx.outDir, "slither.json");
  rmSync(jsonPath, { force: true }); // Slither refuses to overwrite an existing file
  const r = await exec(
    slitherBin(),
    [".", "--json", jsonPath, "--filter-paths", "(lib/|test/|script/|node_modules/)"],
    { cwd: ctx.workDir, timeoutMs: 20 * 60_000 },
  );
  if (!existsSync(jsonPath)) {
    return { name: "slither", status: "failed", durationMs: r.durationMs, summary: "Slither produced no output", findings: [], log: r.stdout + r.stderr };
  }

  const report = JSON.parse(readFileSync(jsonPath, "utf8"));
  const detectors: SlitherDetector[] = report?.results?.detectors ?? [];
  const findings: Finding[] = detectors.map((d, i) => ({
    tool: "slither",
    id: `${d.check}-${i + 1}`,
    title: d.check,
    severity: IMPACT[d.impact] ?? "info",
    confidence: (d.confidence?.toLowerCase() as Finding["confidence"]) ?? "low",
    locations: [
      ...new Set(
        d.elements
          .map((e) => e.source_mapping)
          .filter((s) => s?.filename_relative && s.lines?.length)
          .map((s) => `${s!.filename_relative}#L${s!.lines![0]}`),
      ),
    ],
    description: d.description.trim(),
  }));

  return {
    name: "slither",
    status: report?.success === false ? "failed" : "ok",
    durationMs: r.durationMs,
    summary: `${findings.length} findings`,
    findings,
    log: r.stderr,
  };
}
