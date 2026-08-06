import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../server.js';

const tempDirs: string[] = [];
const SLOW_TOOL_TIMEOUT_MS = 300_000;

function makeEmptyTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-auth-test-'));
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

describe('setup-auth tool', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }, 60_000);

  it('default Clerk engine (email+Google) generates screens + schema, and the generated project builds and typechecks', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    await callSlowTool(client, {
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'app', framework: 'none' },
    });
    const result = await callSlowTool(client, {
      name: 'setup-auth',
      arguments: { targetDir, appName: 'app', identityProviders: { email: 'password', google: true, github: false } },
    });
    expect(result.isError).toBeFalsy();

    const authDir = join(targetDir, 'libs', 'features', 'auth');
    expect(existsSync(join(authDir, 'sign-in.tsx'))).toBe(true);
    expect(existsSync(join(authDir, 'sign-up.tsx'))).toBe(true);
    expect(existsSync(join(authDir, 'user.schema.ts'))).toBe(true);

    const signIn = readFileSync(join(authDir, 'sign-in.tsx'), 'utf8');
    expect(signIn).toContain('oauth_google');
    expect(signIn).not.toContain('oauth_github');

    const envExample = readFileSync(join(targetDir, '.env.example'), 'utf8');
    expect(envExample).toContain('VITE_CLERK_PUBLISHABLE_KEY');
    expect(envExample).toContain('Google');
    expect(envExample).not.toContain('GitHub');

    // Placeholder only — no real (live) key ever appears in generated output.
    expect(envExample).toContain('pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    let liveKeyFound = false;
    try {
      execFileSync('grep', ['-rn', '--exclude-dir=node_modules', 'pk_live_', targetDir], { encoding: 'utf8' });
      liveKeyFound = true;
    } catch {
      // grep exits non-zero when no match — the expected, good outcome.
    }
    expect(liveKeyFound).toBe(false);

    // Generated project actually builds and typechecks with real @clerk/react types.
    const buildOutput = execFileSync('npx', ['nx', 'run-many', '-t', 'build,typecheck'], {
      cwd: targetDir,
      encoding: 'utf8',
    });
    expect(buildOutput).toMatch(/Successfully ran targets/);
  }, 600_000);

  it('a second, different provider combination (GitHub + magic-link) produces different, correctly-reflected .env.example and sign-in content', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    await callSlowTool(client, {
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'app', framework: 'none' },
    });
    await callSlowTool(client, {
      name: 'setup-auth',
      arguments: { targetDir, appName: 'app', identityProviders: { email: 'magic-link', google: false, github: true } },
    });

    const authDir = join(targetDir, 'libs', 'features', 'auth');
    const signIn = readFileSync(join(authDir, 'sign-in.tsx'), 'utf8');
    expect(signIn).toContain('oauth_github');
    expect(signIn).not.toContain('oauth_google');
    expect(signIn).toContain('emailLink');

    const envExample = readFileSync(join(targetDir, '.env.example'), 'utf8');
    expect(envExample).toContain('GitHub');
    expect(envExample).not.toContain('Google');
    expect(envExample).toContain('Email link');
  }, 300_000);

  it('self-hosted engine returns a clear v2 message and still generates the user schema, no partial auth code', async () => {
    const client = await connectedClient();
    const targetDir = makeEmptyTempDir();

    await callSlowTool(client, {
      name: 'scaffold-workspace',
      arguments: { targetDir, projectName: 'app', framework: 'none' },
    });
    const result = await callSlowTool(client, {
      name: 'setup-auth',
      arguments: { targetDir, appName: 'app', authEngine: 'self-hosted' },
    });

    expect(result.content).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('v2') })]),
    );

    const authDir = join(targetDir, 'libs', 'features', 'auth');
    expect(existsSync(join(authDir, 'user.schema.ts'))).toBe(true);
    expect(existsSync(join(authDir, 'sign-in.tsx'))).toBe(false);
    expect(existsSync(join(authDir, 'sign-up.tsx'))).toBe(false);
  }, 300_000);
});
