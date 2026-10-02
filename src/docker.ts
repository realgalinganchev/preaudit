import path from "node:path";
import { exec, type ExecResult } from "./exec.js";
import { REPO_ROOT } from "./paths.js";
import type { RunContext } from "./types.js";

export const IMAGE = "preaudit-tools:0.2";

export async function ensureImage(): Promise<{ ok: boolean; log: string }> {
  const inspect = await exec("docker", ["image", "inspect", IMAGE], { cwd: REPO_ROOT });
  if (inspect.code === 0) return { ok: true, log: "" };
  const built = await exec("docker", ["build", "-t", IMAGE, "docker"], { cwd: REPO_ROOT, timeoutMs: 30 * 60_000 });
  return { ok: built.code === 0, log: built.stdout + built.stderr };
}

/**
 * Runs a bash script in the tools container. The run's output folder is mounted at /out;
 * scripts copy /out/workspace to /tmp first, because builds on a Windows bind mount are slow.
 * Named volumes cache downloaded compilers between runs.
 */
export function inContainer(ctx: RunContext, script: string, timeoutMs: number): Promise<ExecResult> {
  return exec(
    "docker",
    [
      "run", "--rm",
      "-v", `${ctx.outDir}:/out`,
      "-v", "preaudit-svm:/root/.svm",
      "-v", "preaudit-solc:/root/.solc-select",
      // Scripts are mounted rather than baked in, so editing them doesn't need an image rebuild.
      "-v", `${path.join(REPO_ROOT, "docker")}:/preaudit:ro`,
      IMAGE,
      "bash", "-c", `set -e; rm -rf /tmp/ws; cp -r /out/workspace /tmp/ws; cd /tmp/ws; rm -rf out cache; ${script}`,
    ],
    { cwd: REPO_ROOT, timeoutMs },
  );
}
