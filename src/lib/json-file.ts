import { readFileSync, writeFileSync } from 'node:fs';

export interface PackageJsonLike {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface TsconfigLike {
  compilerOptions?: Record<string, unknown>;
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
