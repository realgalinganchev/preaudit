import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SEVERITY_ORDER, type Finding, type RunContext, type StageResult } from "./types.js";

const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function writeReport(ctx: RunContext, stages: StageResult[]): { mdPath: string; jsonPath: string } {
  const logDir = path.join(ctx.outDir, "logs");
  mkdirSync(logDir, { recursive: true });
  for (const s of stages) if (s.log) writeFileSync(path.join(logDir, `${s.name}.log`), s.log);

  const findings = stages.flatMap((s) => s.findings);
  const jsonPath = path.join(ctx.outDir, "findings.json");
  writeFileSync(jsonPath, JSON.stringify({ target: ctx.targetDir, generatedAt: new Date().toISOString(), stages: stages.map(({ log, ...s }) => s) }, null, 2));

  const counts = SEVERITY_ORDER.map((sev) => `${sev}: ${findings.filter((f) => f.severity === sev).length}`).join(" · ");
  const lines: string[] = [
    `# Pre-audit report: ${path.basename(ctx.targetDir)}`,
    "",
    `Generated ${new Date().toISOString()}.`,
    "",
    "> **Every finding below is raw tool output and has not been verified yet.** A finding only goes to the client after a human has confirmed it, removed false positives and written the impact in plain language.",
    "",
    "## Pipeline",
    "",
    "| Stage | Status | Time | Result |",
    "|---|---|---|---|",
    ...stages.map((s) => `| ${s.name} | ${s.status} | ${fmtSecs(s.durationMs)} | ${s.summary} |`),
    "",
    `## Findings (${findings.length})`,
    "",
    counts,
    "",
  ];

  for (const sev of SEVERITY_ORDER) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${sev[0].toUpperCase()}${sev.slice(1)} (${group.length})`, "");
    for (const f of group) lines.push(...renderFinding(f));
  }

  const mdPath = path.join(ctx.outDir, "report.md");
  writeFileSync(mdPath, lines.join("\n"));
  return { mdPath, jsonPath };
}

function renderFinding(f: Finding): string[] {
  return [
    `#### [${f.tool}] ${f.title}`,
    "",
    `- **Tool confidence:** ${f.confidence}`,
    `- **Where:** ${f.locations.join(", ") || "n/a"}`,
    "",
    f.description
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n"),
    "",
  ];
}
