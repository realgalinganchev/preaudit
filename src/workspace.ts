import { cpSync, existsSync, readFileSync } from "node:fs";
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
  // node_modules is skipped (it can be huge), but Hardhat-style projects resolve their
  // Solidity dependencies from it: copy just the packages the remappings point at.
  for (const pkg of remappedPackages(targetDir)) {
    const from = path.join(targetDir, "node_modules", pkg);
    if (existsSync(from)) cpSync(from, path.join(workDir, "node_modules", pkg), { recursive: true });
  }
  if (harnessDir) {
    if (!existsSync(harnessDir)) throw new Error(`Harness folder not found: ${harnessDir}`);
    cpSync(harnessDir, workDir, { recursive: true });
  }
  return workDir;
}

/** Top-level node_modules entries (a package or an @scope) named in foundry.toml or remappings.txt. */
function remappedPackages(targetDir: string): Set<string> {
  const pkgs = new Set<string>();
  for (const file of ["foundry.toml", "remappings.txt"]) {
    const p = path.join(targetDir, file);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/node_modules\/(@?[^/\s"',\]]+)/g)) pkgs.add(m[1]);
  }
  return pkgs;
}
