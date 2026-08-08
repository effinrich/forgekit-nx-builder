import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../server.js';

const tempDirs: string[] = [];
const SLOW_TOOL_TIMEOUT_MS = 300_000;

function makeEmptyTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-lint-test-'));
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

function callSlowTool(client: Client, params: { name: string; arguments: Record<string, unknown> }) {
  return client.callTool(params, { timeout: SLOW_TOOL_TIMEOUT_MS });
}

describe('setup-lint-format tool', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }, 60_000);

  it('default path (Oxlint+Oxfmt via @nx-oxc/nx) configures the lib and the lint/format/format-check executors succeed', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    await callSlowTool(client, {
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'app', framework: 'none' },
    });
    const result = await callSlowTool(client, { name: 'setup-lint-format', arguments: { targetDir } });
    expect(result.isError).toBeFalsy();

    expect(existsSync(join(targetDir, '.oxlintrc.json'))).toBe(true);
    expect(existsSync(join(targetDir, '.oxfmtrc.json'))).toBe(true);
    expect(existsSync(join(targetDir, 'libs', 'shared', 'ui', '.oxlintrc.json'))).toBe(true);

    const nxJson = JSON.parse(readFileSync(join(targetDir, 'nx.json'), 'utf8')) as {
      plugins?: (string | { plugin: string })[];
    };
    const pluginNames = (nxJson.plugins ?? []).map((p) => (typeof p === 'string' ? p : p.plugin));
    expect(pluginNames.some((n) => n?.includes('@nx-oxc/nx'))).toBe(true);

    const lintOutput = execFileSync('npx', ['nx', 'run', '@org/ui:lint'], { cwd: targetDir, encoding: 'utf8' });
    expect(lintOutput).toMatch(/Successfully ran target lint/);

    execFileSync('npx', ['nx', 'run', '@org/ui:format'], { cwd: targetDir, encoding: 'utf8' });
    const formatCheckOutput = execFileSync('npx', ['nx', 'run', '@org/ui:format-check'], {
      cwd: targetDir,
      encoding: 'utf8',
    });
    expect(formatCheckOutput).toMatch(/Successfully ran target format-check/);
  }, 600_000);

  it('alt path (ESLint+Prettier) installs successfully when explicitly requested and the lint target works', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    await callSlowTool(client, {
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'app', framework: 'none' },
    });
    const result = await callSlowTool(client, {
      name: 'setup-lint-format',
      arguments: { targetDir, linter: 'eslint' },
    });
    expect(result.isError).toBeFalsy();

    expect(existsSync(join(targetDir, 'eslint.config.mjs'))).toBe(true);

    const lintOutput = execFileSync('npx', ['nx', 'run', '@org/ui:lint'], { cwd: targetDir, encoding: 'utf8' });
    expect(lintOutput).toMatch(/Successfully ran target lint/);
  }, 600_000);

  it('regression: classname-lint rule from add-ui-library still fires after setup-lint-format layers Oxlint config on top', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    await callSlowTool(client, {
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'app', framework: 'none' },
    });
    await callSlowTool(client, {
      name: 'add-ui-library',
      arguments: {
        targetDir,
        appName: 'app',
        library: 'shadcn-tailwind',
        theming: { mode: 'interactive', primary: '#3b82f6', secondary: '#f97316' },
      },
    });
    await callSlowTool(client, { name: 'setup-lint-format', arguments: { targetDir } });

    const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
    const ruleFile = join(uiLibDir, '.eslint-rules', 'no-raw-classname.cjs');
    expect(existsSync(ruleFile)).toBe(true);

    const violationFile = join(uiLibDir, 'src', 'violation.tsx');
    writeFileSync(violationFile, `export const Bad = () => <div className="bg-red-500 p-4" />;\n`);

    const eslintConfigPath = join(uiLibDir, 'eslint.config.local.mjs');
    let violationOutput = '';
    try {
      execFileSync('npx', ['eslint', '--no-config-lookup', '-c', eslintConfigPath, 'src/violation.tsx'], {
        cwd: uiLibDir,
        encoding: 'utf8',
      });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      violationOutput = stdout || stderr || String(error);
    }
    expect(violationOutput).toContain('no-raw-classname');

    // The direct eslint invocation above tests the emitted rule itself, not
    // the NX wiring that's supposed to make it run automatically. Exercise
    // the actual shipped mechanism: `nx run <lib>:lint` must fail while the
    // violation exists (dependsOn: ['lint-classnames'] actually firing), and
    // pass once it's removed.
    let nxLintFailed = false;
    let nxLintOutput = '';
    try {
      execFileSync('npx', ['nx', 'run', '@org/ui:lint'], { cwd: targetDir, encoding: 'utf8' });
    } catch (error) {
      nxLintFailed = true;
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      nxLintOutput = stdout || stderr || String(error);
    }
    expect(nxLintFailed).toBe(true);
    expect(nxLintOutput).toContain('no-raw-classname');

    rmSync(violationFile);
    const cleanNxLintOutput = execFileSync('npx', ['nx', 'run', '@org/ui:lint'], { cwd: targetDir, encoding: 'utf8' });
    expect(cleanNxLintOutput).toMatch(/Successfully ran target lint/);
  }, 600_000);
});
