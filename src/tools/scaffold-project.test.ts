import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../server.js';

const tempDirs: string[] = [];
const SLOW_TOOL_TIMEOUT_MS = 600_000;

function makeEmptyTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-e2e-test-'));
  tempDirs.push(dir);
  return dir;
}

async function connectedClient() {
  const server = createServer();
  const client = new Client({ name: 'test-harness', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('scaffold-project — end-to-end wizard orchestration', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }, 60_000);

  it('one call, against a fresh empty target dir, produces a complete working monorepo — generated build/lint/test/storybook build all succeed', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    const result = await client.callTool(
      {
        name: 'scaffold-project',
        arguments: {
          targetDir,
          projectName: 'app',
          theming: { mode: 'interactive', primary: '#3b82f6', secondary: '#f97316' },
        },
      },
      { timeout: SLOW_TOOL_TIMEOUT_MS },
    );
    expect(result.isError).toBeFalsy();

    const summary = (result.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
    expect(summary).toContain('Stage A');
    expect(summary).toContain('Stage B');
    expect(summary).toContain('Stage C');
    expect(summary).toContain('Stage D');
    expect(summary).toContain('deferred to v2');

    // The composed monorepo actually exists with every piece in place.
    expect(existsSync(join(targetDir, 'apps', 'app'))).toBe(true);
    expect(existsSync(join(targetDir, 'libs', 'shared', 'ui', 'src', 'lib', 'checkbox.tsx'))).toBe(true);
    expect(existsSync(join(targetDir, 'libs', 'shared', 'ui', '.storybook', 'main.ts'))).toBe(true);
    expect(existsSync(join(targetDir, '.oxlintrc.json'))).toBe(true);
    expect(existsSync(join(targetDir, 'libs', 'features', 'auth', 'sign-in.tsx'))).toBe(true);

    // All four generated-project commands the phase requires, run for real.
    const buildOutput = execFileSync('npx', ['nx', 'run-many', '-t', 'build'], { cwd: targetDir, encoding: 'utf8' });
    expect(buildOutput).toMatch(/Successfully ran target build/);

    const lintOutput = execFileSync('npx', ['nx', 'run', '@org/ui:lint'], { cwd: targetDir, encoding: 'utf8' });
    expect(lintOutput).toMatch(/Successfully ran target lint/);

    const testOutput = execFileSync('npx', ['nx', 'run-many', '-t', 'test'], { cwd: targetDir, encoding: 'utf8' });
    expect(testOutput).toMatch(/Successfully ran target test/);

    const storybookBuildOutput = execFileSync('npx', ['nx', 'run', '@org/ui:build-storybook'], {
      cwd: targetDir,
      encoding: 'utf8',
    });
    expect(storybookBuildOutput).toMatch(/Successfully ran target build-storybook/);
  }, 600_000);
});
