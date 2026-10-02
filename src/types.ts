export type Severity = "high" | "medium" | "low" | "info" | "gas";

export const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info", "gas"];

/** One issue reported by any tool, normalized so every stage can be merged into one report. */
export interface Finding {
  tool: string;
  id: string;
  title: string;
  severity: Severity;
  /** How sure the tool is, not how sure we are: every finding still needs human verification. */
  confidence: "high" | "medium" | "low";
  locations: string[];
  description: string;
}

export type StageStatus = "ok" | "failed" | "skipped";

export interface StageResult {
  name: string;
  status: StageStatus;
  durationMs: number;
  summary: string;
  findings: Finding[];
  /** Raw tool output, kept for the appendix and for debugging the pipeline itself. */
  log?: string;
}

export interface RunContext {
  /** The client's project. Never modified. */
  targetDir: string;
  /** Run folder: report, raw tool output, and the workspace copy. */
  outDir: string;
  /** Disposable copy of the target (plus harness) that every stage runs in. */
  workDir: string;
  /** Files to mutate, relative to the workspace. Defaults to the non-interface files in src/. */
  mutate?: string[];
  /** Mutants per file; Gambit downsamples above this. */
  maxMutants: number;
  /** Overrides the solc version read from the first mutated file's pragma. */
  solcVersion?: string;
  /** Deep fuzz stage: runs per fuzz test, and runs × depth (calls) per invariant. */
  fuzzRuns: number;
  invariantRuns: number;
  invariantDepth: number;
  /** Medusa campaign length. */
  medusaSeconds: number;
}

/**
 * Where the harness lands inside the workspace. Harness tests are written to break the
 * contract, so they are kept out of the project's own test suite (tests, coverage, mutation
 * score) and only run in the property stages (fuzz, halmos).
 */
export const HARNESS_GLOB = "test/preaudit/**";
