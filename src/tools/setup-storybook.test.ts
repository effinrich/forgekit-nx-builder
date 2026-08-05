import { describe, expect, test, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../server.js';

const tempDirs: string[] = [];
const SLOW_TOOL_TIMEOUT_MS = 300_000;

function makeEmptyTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-storybook-test-'));
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

describe('setup-storybook tool', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }, 60_000);

  test(
    'configures Storybook on libs/shared/ui with a11y+interaction-test addons, and the generated project builds Storybook and passes its interaction test via real headless Chromium',
    async () => {
      const client = await connectedClient();
      const targetDir = makeEmptyTempDir();

      await callSlowTool(client, { name: 'scaffold-workspace', arguments: { targetDir, projectName: 'app', framework: 'none' } });
      await callSlowTool(client, {
        name: 'add-ui-library',
        arguments: { targetDir, appName: 'app', theming: { mode: 'interactive', primary: '#3b82f6', secondary: '#f97316' } },
      });
      const result = await callSlowTool(client, {
        name: 'setup-storybook',
        arguments: { targetDir, installChromatic: false },
      });
      expect(result.isError).toBeFalsy();

      const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');

      // Storybook config points at libs/shared/ui (it was generated there).
      expect(existsSync(join(uiLibDir, '.storybook', 'main.ts'))).toBe(true);
      const mainConfig = readFileSync(join(uiLibDir, '.storybook', 'main.ts'), 'utf-8');
      expect(mainConfig).toContain('@storybook/addon-a11y');
      expect(mainConfig).toContain('@storybook/addon-vitest');

      // Auto-generated story exists for the existing primitive.
      expect(existsSync(join(uiLibDir, 'src', 'lib', 'ui.stories.tsx'))).toBe(true);

      // Playwright-backed interaction test actually runs and passes, in real headless Chromium.
      const testOutput = execFileSync('npx', ['vitest', 'run', '-c', 'vitest.config.storybook.ts'], {
        cwd: uiLibDir,
        encoding: 'utf-8',
      });
      expect(testOutput).toMatch(/Tests\s+\d+\s+passed/);
      expect(testOutput).not.toMatch(/\d+\s+failed/);

      // Storybook itself builds.
      const buildOutput = execFileSync('npx', ['nx', 'run-many', '-t', 'build-storybook'], {
        cwd: targetDir,
        encoding: 'utf-8',
      });
      expect(buildOutput).toMatch(/Successfully ran target build-storybook/);

      // Chromatic explainer copy present in README even when skipped.
      const readme = readFileSync(join(targetDir, 'README.md'), 'utf-8');
      expect(readme).toContain('Install Chromatic?');
      expect(readme).toContain('CHROMATIC_PROJECT_TOKEN');
    },
    900_000,
  );
});
