import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * NX_DAEMON=false prevents `nx` commands from spawning a background daemon
 * that outlives the command — without this, temp-dir cleanup after tests
 * (or after a real wizard run against a throwaway dir) intermittently fails
 * with ENOTEMPTY because the daemon still holds files open under `.nx/`.
 *
 * Async (not execFileSync): these commands can run for tens of seconds to a
 * few minutes (npm installs, NX generators). A synchronous call blocks the
 * entire Node event loop for that whole duration — inside the MCP server
 * that means the process can't respond to anything else while a wizard step
 * runs, and inside tests it starves the Vitest worker's RPC heartbeat.
 */
export async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
    env: { ...process.env, NX_DAEMON: 'false' },
  });
  return stdout;
}
