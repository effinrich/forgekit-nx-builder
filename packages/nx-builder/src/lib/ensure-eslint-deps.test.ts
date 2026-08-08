import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEslintDeps } from './ensure-eslint-deps.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-ensure-eslint-deps-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('ensureEslintDeps()', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op (does not attempt to install) when both deps are already present', async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { eslint: '^10.0.0', 'typescript-eslint': '^8.0.0' } }),
    );
    // If this incorrectly fell through to run('pnpm', ['add', ...], dir), it
    // would either hang or reject trying to run pnpm against a directory
    // with no real workspace — a fast, clean resolve proves the no-op path.
    await expect(ensureEslintDeps(dir)).resolves.toBeUndefined();
  });
});
