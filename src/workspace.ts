import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const SKIP = new Set([".git", "out", "cache", "gambit_out", "node_modules", "broadcast"]);

/**
 * Copies the target project into the run's output folder, so mutation testing can rewrite
 * source files without ever touching the client's checkout. A harness folder (extra tests,
 * e.g. symbolic properties written for this engagement) is layered on top of the copy.
 */
export function prepareWorkspace(targetDir: string, outDir: string, harnessDir?: string): string {
  const workDir = path.join(outDir, "workspace");
  cpSync(targetDir, workDir, {
    recursive: true,
    filter: (src) => !SKIP.has(path.basename(src)),
  });
  if (harnessDir) {
    if (!existsSync(harnessDir)) throw new Error(`Harness folder not found: ${harnessDir}`);
    cpSync(harnessDir, workDir, { recursive: true });
  }
  return workDir;
}
