import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { run } from '../lib/run-command.js';
import { readJson, writeJson } from '../lib/json-file.js';
import type { PackageJsonLike } from '../lib/json-file.js';
import { validateExistingWorkspace } from '../lib/validate-target.js';
import { ensureEslintDeps } from '../lib/ensure-eslint-deps.js';

interface NxTargetsPackageJson extends PackageJsonLike {
  nx?: { targets?: Record<string, unknown> };
}

/**
 * add-ui-library's shadcn/Tailwind path emits a classname-lint rule to disk
 * (.eslint-rules/no-raw-classname.cjs + eslint.config.local.mjs) but nothing
 * previously ran it — the "raw utility classnames are linted as errors"
 * guarantee didn't actually hold. Wires it as a real NX target and makes the
 * project's main `lint` target depend on it, so `nx run <lib>:lint` (and
 * `nx run-many -t lint`) enforce it automatically regardless of which linter
 * (Oxlint or ESLint) is the primary choice — Oxlint can't load this custom
 * JS rule itself (see the comment in setupOxlintOxfmt), so this runs
 * alongside it as a dependency of the same target name, not merged into it.
 */
async function wireClassnameLintTarget(targetDir: string): Promise<void> {
  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  if (!existsSync(join(uiLibDir, '.eslint-rules', 'no-raw-classname.cjs'))) {
    return; // panda-ark path — no classname rule was emitted, nothing to wire.
  }

  // The classname rule's config imports the typescript-eslint parser to parse
  // .tsx syntax — needed even when Oxlint is the primary linter, which never
  // installs ESLint at all. add-ui-library also ensures this (it can run
  // standalone without this tool), but re-checking here is cheap and correct
  // if this tool ever runs first against a rule file written some other way.
  await ensureEslintDeps(targetDir);

  const pkgPath = join(uiLibDir, 'package.json');
  const pkg = readJson<NxTargetsPackageJson>(pkgPath);
  // Merge onto any pre-existing `lint` target rather than overwriting it —
  // safe today only because @nx-oxc/nx's inferred `lint` target has no
  // explicit package.json counterpart to clobber, but that's a third-party
  // default this shouldn't depend on staying true.
  const existingLint = (pkg.nx?.targets?.['lint'] ?? {}) as { dependsOn?: unknown } & Record<string, unknown>;
  const existingDependsOn = Array.isArray(existingLint.dependsOn) ? (existingLint.dependsOn as string[]) : [];
  pkg.nx = {
    ...pkg.nx,
    targets: {
      ...pkg.nx?.targets,
      'lint-classnames': {
        executor: 'nx:run-commands',
        options: {
          command: 'npx eslint --no-config-lookup --config eslint.config.local.mjs src',
          cwd: 'libs/shared/ui',
        },
      },
      lint: {
        ...existingLint,
        dependsOn: [...new Set([...existingDependsOn, 'lint-classnames'])],
      },
    },
  };
  writeJson(pkgPath, pkg);
}

async function setupOxlintOxfmt(targetDir: string): Promise<string> {
  // nx add handles the workspace-root pnpm install itself — a plain
  // `pnpm add -D` at a pnpm-workspace root needs an explicit -w flag or
  // errors with ERR_PNPM_ADDING_TO_ROOT.
  await run('npx', ['nx', 'add', '@nx-oxc/nx'], targetDir);

  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  const libPkg = readJson<PackageJsonLike>(join(uiLibDir, 'package.json'));
  await run(
    'npx',
    ['nx', 'g', '@nx-oxc/nx:configuration', `--project=${libPkg.name}`, '--interactive=false'],
    targetDir,
  );

  // Oxlint (as currently installed) has no confirmed way to load custom
  // JS-plugin rules — .oxlintrc.json only accepts its own named built-in
  // plugins. The classname-lint rule from add-ui-library (when the
  // shadcn/Tailwind path was chosen) runs as a separate NX target that the
  // main `lint` target depends on (see wireClassnameLintTarget) — the two
  // tools structurally can't clobber each other since they're entirely
  // separate configs/invocations, just chained via NX's task graph.
  await wireClassnameLintTarget(targetDir);

  return `Configured Oxlint + Oxfmt (via @nx-oxc/nx) for ${libPkg.name}. Run "npx nx run ${libPkg.name}:lint", ":format", or ":format-check".`;
}

async function setupEslintPrettier(targetDir: string): Promise<string> {
  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  const libPkg = readJson<PackageJsonLike>(join(uiLibDir, 'package.json'));

  // @nx/eslint has no per-project "add lint to this project" generator in
  // current NX — it registers @nx/eslint/plugin as an inferred plugin, which
  // only creates a `lint` target for projects it finds a real ESLint config
  // covering. `nx add` handles the workspace-root install; the config itself
  // still has to be written.
  await run('npx', ['nx', 'add', '@nx/eslint'], targetDir);
  await run('pnpm', ['add', '-Dw', 'typescript-eslint', 'prettier'], targetDir);

  const eslintConfigPath = join(targetDir, 'eslint.config.mjs');
  writeFileSync(
    eslintConfigPath,
    `import tseslint from 'typescript-eslint';\n\n` +
      `export default tseslint.config(\n` +
      `  { ignores: ['**/dist/**', '**/node_modules/**'] },\n` +
      `  ...tseslint.configs.recommended,\n` +
      `);\n`,
  );

  await wireClassnameLintTarget(targetDir);

  return `Configured ESLint + Prettier for ${libPkg.name}. Run "npx nx run ${libPkg.name}:lint" and "npx prettier --write .".`;
}

const setupLintFormatInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to a workspace already scaffolded, with libs/shared/ui present.'),
  linter: z
    .enum(['oxlint', 'eslint'])
    .default('oxlint')
    .describe(
      'Lint/format tooling choice. Default is Oxlint + Oxfmt (via @nx-oxc/nx); ESLint + Prettier is the alternative.',
    ),
});

export async function setupLintFormat(targetDirInput: string, linter: 'oxlint' | 'eslint'): Promise<string> {
  const targetDir = validateExistingWorkspace(targetDirInput);
  return linter === 'oxlint' ? setupOxlintOxfmt(targetDir) : setupEslintPrettier(targetDir);
}

export function registerSetupLintFormatTool(server: McpServer): void {
  server.registerTool(
    'setup-lint-format',
    {
      description:
        'Stage C (lint/format) of the forgekit-reactor wizard: wires the strict ruleset baseline into the generated project. Default is Oxlint + Oxfmt via @nx-oxc/nx; ESLint + Prettier is available as an explicit alternative.',
      inputSchema: setupLintFormatInputSchema,
    },
    async ({ targetDir, linter }) => {
      const message = await setupLintFormat(targetDir, linter);
      return { content: [{ type: 'text', text: message }] };
    },
  );
}
