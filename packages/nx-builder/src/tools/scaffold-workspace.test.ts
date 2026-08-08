import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../server.js';

const tempDirs: string[] = [];

function makeEmptyTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-test-'));
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

describe('scaffold-workspace tool', () => {
  let client: Awaited<ReturnType<typeof connectedClient>> | undefined;

  afterEach(async () => {
    await client?.close();
  });

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('framework "nextjs" returns a coming-in-v2 response without touching the filesystem', async () => {
    client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    const result = await client.callTool({
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'my-app', framework: 'nextjs' },
    });

    expect(result.content).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('coming in v2') }),
      ]),
    );
    expect(readdirSync(targetDir)).toHaveLength(0);
  }, 15_000);

  it('framework "none" scaffolds a real NX react workspace into an empty temp dir', async () => {
    client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    const result = await client.callTool(
      { name: 'scaffold-workspace', arguments: { targetDir, projectName: 'app', framework: 'none' } },
      { timeout: 300_000 },
    );

    expect(result.isError).toBeFalsy();

    // Real filesystem assertions — plan §4 shape.
    expect(existsSync(join(targetDir, 'nx.json'))).toBe(true);
    expect(existsSync(join(targetDir, 'tsconfig.base.json'))).toBe(true);
    expect(existsSync(join(targetDir, 'apps', 'app'))).toBe(true);
    expect(existsSync(join(targetDir, 'libs', 'shared', 'ui'))).toBe(true);
    expect(existsSync(join(targetDir, 'libs', 'features'))).toBe(true);

    // Zustand present in the generated app's package.json dependencies.
    const appPkg = JSON.parse(
      execFileSync('cat', [join(targetDir, 'apps', 'app', 'package.json')], { encoding: 'utf8' }),
    );
    expect(appPkg.dependencies).toHaveProperty('zustand');

    // NX itself recognizes the structure.
    const projects = JSON.parse(execFileSync('npx', ['nx', 'show', 'projects'], { cwd: targetDir, encoding: 'utf8' }));
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThanOrEqual(2);
  }, 300_000);
});
