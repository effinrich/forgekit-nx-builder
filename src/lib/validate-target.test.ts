import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNewTargetDir, validateExistingWorkspace, resolveAppName } from './validate-target.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forgekit-reactor-validate-target-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('validateNewTargetDir()', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a relative path', () => {
    expect(() => validateNewTargetDir('some/relative/path')).toThrow(/must be an absolute path/);
  });

  it('rejects a non-existent directory', () => {
    const missing = join(makeTempDir(), 'does-not-exist');
    expect(() => validateNewTargetDir(missing)).toThrow(/not an existing directory/);
  });

  it('accepts an existing absolute directory and returns the resolved path', () => {
    const dir = makeTempDir();
    expect(validateNewTargetDir(dir)).toBe(dir);
  });
});

describe('validateExistingWorkspace()', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a directory missing nx.json', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(() => validateExistingWorkspace(dir)).toThrow(/missing nx\.json/);
  });

  it('rejects a directory missing package.json', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'nx.json'), '{}');
    expect(() => validateExistingWorkspace(dir)).toThrow(/missing package\.json/);
  });

  it('accepts a directory with both marker files', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'nx.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(validateExistingWorkspace(dir)).toBe(dir);
  });
});

describe('resolveAppName()', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an explicit appName containing path traversal', () => {
    expect(() => resolveAppName('/tmp', '../../../../etc/passwd')).toThrow(/must be lowercase alphanumeric/);
  });

  it('rejects an explicit appName that is an absolute path', () => {
    expect(() => resolveAppName('/tmp', '/etc')).toThrow(/must be lowercase alphanumeric/);
  });

  it('passes through a valid explicit appName unchanged', () => {
    expect(resolveAppName('/tmp', 'my-valid-app')).toBe('my-valid-app');
  });

  it('throws when apps/ does not exist', () => {
    const dir = makeTempDir();
    expect(() => resolveAppName(dir)).toThrow(/No apps\/ directory found/);
  });

  it('throws when apps/ is empty', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'apps'));
    expect(() => resolveAppName(dir)).toThrow(/No app found under/);
  });

  it('throws when multiple apps exist, naming them in the error', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'apps', 'app-one'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'app-two'), { recursive: true });
    expect(() => resolveAppName(dir)).toThrow(/Multiple apps found.*app-one.*app-two/s);
  });

  it('auto-discovers the single app under apps/, ignoring -e2e directories', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'apps', 'my-app'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'my-app-e2e'), { recursive: true });
    expect(resolveAppName(dir)).toBe('my-app');
  });
});
