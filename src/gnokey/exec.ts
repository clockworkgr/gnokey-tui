// Thin wrapper around spawning the `gnokey` binary.
//
// Everything the UI does ultimately routes through here. gnokey is a child
// process: its stdout/stderr are captured (never inherited), and any password
// or mnemonic input is written to its stdin. Because Ink owns the real TTY in
// raw mode, gnokey cannot prompt interactively, so callers that need a
// password pass `-insecure-password-stdin` and supply it via `stdinLines`.
import { spawn, spawnSync } from 'node:child_process';
import type { RunResult } from './types.ts';

export interface RunOptions {
  /** Lines written to the child's stdin, each terminated by a newline. */
  stdinLines?: string[];
  /** Kill the process after this many ms (default 60s). */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run gnokey with the given arguments. Never rejects on a non-zero exit code;
 * the caller inspects `code`/`stderr`. Rejects only when the binary cannot be
 * spawned at all (e.g. not found on PATH).
 */
export function runGnokey(
  bin: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const { stdinLines, timeoutMs = 60_000, env } = opts;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ?? process.env,
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        stderr += `\n(timed out after ${timeoutMs}ms)`;
      }
      resolve({ code: code ?? -1, stdout, stderr, args });
    });

    // Feed stdin, if any, then close it so gnokey stops waiting for input.
    if (child.stdin) {
      if (stdinLines && stdinLines.length > 0) {
        child.stdin.write(stdinLines.join('\n') + '\n');
      }
      child.stdin.end();
    }
  });
}

/**
 * Run gnokey with the terminal inherited, so gnokey owns stdin/stdout/stderr
 * and can prompt for a password with its own no-echo reader. Blocking; the
 * caller must have released the terminal first (Ink unmounted). Returns the
 * exit code. This is the path that keeps the password out of this process.
 */
export function runGnokeyInherited(bin: string, args: string[]): number {
  const res = spawnSync(bin, args, { stdio: 'inherit' });
  if (res.error) {
    const e = res.error as NodeJS.ErrnoException;
    process.stdout.write(
      `\nfailed to run ${bin}: ${e.code === 'ENOENT' ? 'binary not found' : e.message}\n`,
    );
    return 1;
  }
  return res.status ?? 1;
}

/**
 * Fetch the gnokey version string, or throw a friendly error if the binary is
 * missing. Used at startup to confirm gnokey is installed and reachable.
 */
export async function gnokeyVersion(bin: string): Promise<string> {
  let res: RunResult;
  try {
    res = await runGnokey(bin, ['version'], { timeoutMs: 10_000 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      throw new Error(
        `Could not find the "${bin}" binary on your PATH.\n` +
          `Install it from the gno monorepo with \`make install.gnokey\`, ` +
          `or set a custom path in Settings.`,
      );
    }
    throw err;
  }
  // e.g. "gnokey version: HEAD.3195+4c7eb156"
  const out = (res.stdout + res.stderr).trim();
  const m = out.match(/gnokey version:\s*(.+)$/m);
  return m ? m[1].trim() : out || 'unknown';
}
