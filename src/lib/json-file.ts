import { readFileSync, writeFileSync } from 'node:fs';

export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
