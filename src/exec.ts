import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Runs a command to completion. Never rejects on a non-zero exit: analysis tools use exit codes to mean "found something". */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          stderr += `\n[preaudit] timed out after ${opts.timeoutMs} ms`;
          child.kill();
        }, opts.timeoutMs)
      : undefined;

    const done = (code: number) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    };
    child.on("error", (err) => {
      stderr += `\n[preaudit] could not start ${cmd}: ${err.message}`;
      done(-1);
    });
    child.on("close", (code) => done(code ?? -1));
  });
}
