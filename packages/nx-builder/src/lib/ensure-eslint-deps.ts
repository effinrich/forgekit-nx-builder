import { join } from 'node:path';
import { run } from './run-command.js';
import { readJson, type PackageJsonLike } from './json-file.js';

/**
 * The classname-lint rule's config imports the typescript-eslint parser to
 * parse .tsx syntax. That config is emitted by add-ui-library (Stage B) but
 * only actually run by setup-lint-format (Stage C) — either can run without
 * the other (they're independently callable tools), so both must ensure this
 * dependency exists rather than assuming the other stage already installed it.
 */
export async function ensureEslintDeps(targetDir: string): Promise<void> {
  const rootPkg = readJson<PackageJsonLike>(join(targetDir, 'package.json'));
  const hasEslintDeps = Boolean(rootPkg.devDependencies?.eslint && rootPkg.devDependencies?.['typescript-eslint']);
  if (!hasEslintDeps) {
    await run('pnpm', ['add', '-Dw', 'eslint', 'typescript-eslint'], targetDir);
  }
}
