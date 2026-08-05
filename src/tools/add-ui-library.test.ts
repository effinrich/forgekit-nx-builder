import { describe, expect, test, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../server.js';

const tempDirs: string[] = [];

// These tools run real, multi-minute npm/NX operations — well past the MCP
// client's default request timeout. Real-world hosts calling forgekit-reactor
// tools will hit the same ceiling unless they configure a generous timeout
// too (a case for progress notifications from the server side eventually —
// tracked as Phase 8 polish, not fixed here).
const SLOW_TOOL_TIMEOUT_MS = 300_000;

function makeEmptyTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-ui-test-'));
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

describe('add-ui-library tool', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }, 60_000);

  test(
    'default path installs Panda CSS + Ark UI into libs/shared/ui and the generated app builds with real CSS output',
    async () => {
      const client = await connectedClient();
      const targetDir = makeEmptyTempDir();

      const scaffoldResult = await callSlowTool(client, {
        name: 'scaffold-workspace',
        arguments: { targetDir, projectName: 'app', framework: 'none' },
      });
      expect(scaffoldResult.isError).toBeFalsy();

      const uiResult = await callSlowTool(client, {
        name: 'add-ui-library',
        arguments: {
          targetDir,
          appName: 'app',
          theming: { mode: 'interactive', primary: '#3b82f6', secondary: '#f97316' },
        },
      });
      expect(uiResult.isError).toBeFalsy();

      // libs/shared/ui contains the installed component.
      expect(existsSync(join(targetDir, 'libs', 'shared', 'ui', 'src', 'lib', 'checkbox.tsx'))).toBe(true);
      expect(existsSync(join(targetDir, 'libs', 'shared', 'ui', 'src', 'lib', 'checkbox.recipe.ts'))).toBe(true);

      // Interactive theming produced a valid Panda token scale in the config.
      const pandaConfig = readFileSync(join(targetDir, 'panda.config.ts'), 'utf-8');
      expect(pandaConfig).toContain('#3b82f6');
      expect(pandaConfig).toContain('#f97316');

      // README has the real, sourced Figma kit link for this stack.
      const readme = readFileSync(join(targetDir, 'README.md'), 'utf-8');
      expect(readme).toContain('https://park-ui.com/docs/overview/figma');

      // The generated app actually builds, with real CSS output (not the
      // silent zero-CSS trap documented in memory).
      const buildOutput = execFileSync('npx', ['nx', 'build', 'app'], { cwd: targetDir, encoding: 'utf-8' });
      expect(buildOutput).toMatch(/Successfully ran target build/);
      const cssFiles = execFileSync('find', [join(targetDir, 'apps', 'app', 'dist'), '-name', '*.css'], {
        encoding: 'utf-8',
      }).trim();
      expect(cssFiles.length).toBeGreaterThan(0);
    },
    600_000,
  );

  test(
    'paste theming: CSS-vars and Panda-JSON inputs normalize to the same token output',
    async () => {
      const cssVarsDir = makeEmptyTempDir();
      const jsonDir = makeEmptyTempDir();

      const clientA = await connectedClient();
      await callSlowTool(clientA, { name: 'scaffold-workspace', arguments: { targetDir: cssVarsDir, projectName: 'app', framework: 'none' } });
      await callSlowTool(clientA, {
        name: 'add-ui-library',
        arguments: {
          targetDir: cssVarsDir,
          appName: 'app',
          theming: { mode: 'paste', pasted: ':root{--primary: #3b82f6; --secondary: #f97316;}' },
        },
      });

      const clientB = await connectedClient();
      await callSlowTool(clientB, { name: 'scaffold-workspace', arguments: { targetDir: jsonDir, projectName: 'app', framework: 'none' } });
      await callSlowTool(clientB, {
        name: 'add-ui-library',
        arguments: {
          targetDir: jsonDir,
          appName: 'app',
          theming: {
            mode: 'paste',
            pasted: JSON.stringify({ colors: { primary: { value: '#3b82f6' }, secondary: { value: '#f97316' } } }),
          },
        },
      });

      const cssVarsConfig = readFileSync(join(cssVarsDir, 'panda.config.ts'), 'utf-8');
      const jsonConfig = readFileSync(join(jsonDir, 'panda.config.ts'), 'utf-8');
      expect(cssVarsConfig).toContain('#3b82f6');
      expect(jsonConfig).toContain('#3b82f6');
    },
    900_000,
  );

  test(
    'shadcn/Tailwind opt-in path installs successfully and the classname-lint rule catches a raw classname violation',
    async () => {
      const client = await connectedClient();
      const targetDir = makeEmptyTempDir();

      await callSlowTool(client, { name: 'scaffold-workspace', arguments: { targetDir, projectName: 'app', framework: 'none' } });
      const uiResult = await callSlowTool(client, {
        name: 'add-ui-library',
        arguments: {
          targetDir,
          appName: 'app',
          library: 'shadcn-tailwind',
          theming: { mode: 'interactive', primary: '#3b82f6', secondary: '#f97316' },
        },
      });
      expect(uiResult.isError).toBeFalsy();

      const readme = readFileSync(join(targetDir, 'README.md'), 'utf-8');
      expect(readme).toContain('https://ui.shadcn.com/docs/figma');

      const ruleFile = join(targetDir, 'libs', 'shared', 'ui', '.eslint-rules', 'no-raw-classname.cjs');
      expect(existsSync(ruleFile)).toBe(true);

      // Deliberately-added violation must be caught; the fixed version must pass.
      const violationFile = join(targetDir, 'libs', 'shared', 'ui', 'src', 'violation.tsx');
      writeFileSync(violationFile, `export const Bad = () => <div className="bg-red-500 p-4" />;\n`);

      const eslintConfigPath = join(targetDir, 'libs', 'shared', 'ui', 'eslint.config.local.mjs');
      let violationOutput = '';
      try {
        execFileSync('npx', ['eslint', '--no-config-lookup', '-c', eslintConfigPath, 'src/violation.tsx'], {
          cwd: join(targetDir, 'libs', 'shared', 'ui'),
          encoding: 'utf-8',
        });
      } catch (err) {
        violationOutput = String((err as { stdout?: string }).stdout ?? err);
      }
      // Must fail specifically on our rule's message, not a parse error or anything else.
      expect(violationOutput).toContain('no-raw-classname');
      expect(violationOutput).not.toContain('Parsing error');

      writeFileSync(violationFile, `export const Good = () => <div className={computedClass} />;\n`);
      const cleanOutput = execFileSync('npx', ['eslint', '--no-config-lookup', '-c', eslintConfigPath, 'src/violation.tsx'], {
        cwd: join(targetDir, 'libs', 'shared', 'ui'),
        encoding: 'utf-8',
      });
      expect(cleanOutput.trim()).toBe('');
    },
    600_000,
  );
});
