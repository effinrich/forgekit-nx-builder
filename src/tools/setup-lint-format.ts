import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { run } from '../lib/run-command.js';
import { readJson } from '../lib/json-file.js';

async function setupOxlintOxfmt(targetDir: string): Promise<string> {
  // nx add handles the workspace-root pnpm install itself — a plain
  // `pnpm add -D` at a pnpm-workspace root needs an explicit -w flag or
  // errors with ERR_PNPM_ADDING_TO_ROOT.
  await run('npx', ['nx', 'add', '@nx-oxc/nx'], targetDir);

  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  const libPkg = readJson(join(uiLibDir, 'package.json'));
  await run(
    'npx',
    ['nx', 'g', '@nx-oxc/nx:configuration', `--project=${libPkg.name}`, '--interactive=false'],
    targetDir,
  );

  // Oxlint (as currently installed) has no confirmed way to load custom
  // JS-plugin rules — .oxlintrc.json only accepts its own named built-in
  // plugins. The classname-lint rule from add-ui-library (when the
  // shadcn/Tailwind path was chosen) stays on its own separate ESLint
  // config file, run alongside Oxlint rather than merged into it — the two
  // tools structurally can't clobber each other since they're entirely
  // separate configs/invocations.

  return `Configured Oxlint + Oxfmt (via @nx-oxc/nx) for ${libPkg.name}. Run "npx nx run ${libPkg.name}:lint", ":format", or ":format-check".`;
}

async function setupEslintPrettier(targetDir: string): Promise<string> {
  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  const libPkg = readJson(join(uiLibDir, 'package.json'));

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

  return `Configured ESLint + Prettier for ${libPkg.name}. Run "npx nx run ${libPkg.name}:lint" and "npx prettier --write .".`;
}

const setupLintFormatInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to a workspace already scaffolded, with libs/shared/ui present.'),
  linter: z
    .enum(['oxlint', 'eslint'])
    .default('oxlint')
    .describe('Lint/format tooling choice. Default is Oxlint + Oxfmt (via @nx-oxc/nx); ESLint + Prettier is the alternative.'),
});

export async function setupLintFormat(targetDir: string, linter: 'oxlint' | 'eslint'): Promise<string> {
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
