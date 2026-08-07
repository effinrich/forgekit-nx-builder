import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { normalizePastedTheme, tokensFromHex, tokenScaleToPandaConfigSnippet, themingInputSchema } from '../ui-lib/theming.js';
import type { TokenScale } from '../ui-lib/theming.js';
import { getFigmaKitInfo } from '../ui-lib/figma-links.js';
import type { UiLibraryChoice } from '../ui-lib/figma-links.js';
import { emitNoRawClassnameRuleFile } from '../ui-lib/emit-lint-rule.js';
import { PROJECT_NAME_PATTERN } from '../wizard/types.js';
import { run } from '../lib/run-command.js';
import { readJson, writeJson } from '../lib/json-file.js';
import type { PackageJsonLike, TsconfigLike } from '../lib/json-file.js';
import { validateExistingWorkspace, resolveAppName } from '../lib/validate-target.js';
import { ensureEslintDeps } from '../lib/ensure-eslint-deps.js';

function appendFigmaSection(targetDir: string, library: UiLibraryChoice): void {
  const info = getFigmaKitInfo(library);
  const readmePath = join(targetDir, 'README.md');
  const existing = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const section = info
    ? `\n## Design (Figma)\n\n${info.url}\n\n${info.note}\n`
    : `\n## Design (Figma)\n\nNo official Figma kit found for the chosen UI library.\n`;
  writeFileSync(readmePath, existing + section);
}

async function installPandaArk(targetDir: string, appName: string, tokens: TokenScale): Promise<void> {
  await run('pnpm', ['add', '-Dw', '@pandacss/dev', 'postcss', 'autoprefixer', '@ark-ui/react'], targetDir);
  await run('npx', ['panda', 'init', '--postcss', '--jsx-framework=react', '--force'], targetDir);

  // Default include only covers ./src/**; a monorepo needs both apps/ and libs/.
  const pandaConfigPath = join(targetDir, 'panda.config.ts');
  let pandaConfig = readFileSync(pandaConfigPath, 'utf8');
  pandaConfig = pandaConfig.replace(
    /include: \[[^\]]*\]/,
    `include: ["./apps/**/src/**/*.{js,jsx,ts,tsx}", "./libs/**/src/**/*.{js,jsx,ts,tsx}"]`,
  );
  pandaConfig = pandaConfig.replace(/theme: \{\s*extend: \{\},\s*\},/, tokenScaleToPandaConfigSnippet(tokens));
  writeFileSync(pandaConfigPath, pandaConfig);

  // Wire the postcss plugin explicitly into the app's vite config — relying on
  // postcss.config.cjs autodiscovery is unreliable across NX's varying cwd/root.
  const viteConfigPath = join(targetDir, 'apps', appName, 'vite.config.mts');
  let viteConfig = readFileSync(viteConfigPath, 'utf8');
  if (!viteConfig.includes('@pandacss/dev/postcss')) {
    viteConfig = `import pandacss from '@pandacss/dev/postcss';\n${viteConfig}`;
    viteConfig = viteConfig.replace(
      'plugins: [react()],',
      'plugins: [react()],\n  css: { postcss: { plugins: [pandacss] } },',
    );
    writeFileSync(viteConfigPath, viteConfig);
  }

  // Panda only extracts styles from files actually processed as CSS by the
  // bundler — skip this and the build succeeds with silently ZERO CSS output.
  const srcDir = join(targetDir, 'apps', appName, 'src');
  writeFileSync(join(srcDir, 'styles.css'), '@layer reset, base, tokens, recipes, utilities;\n');
  const mainPath = join(srcDir, 'main.tsx');
  const mainContents = readFileSync(mainPath, 'utf8');
  if (!mainContents.includes('styles.css')) {
    writeFileSync(mainPath, `import './styles.css';\n${mainContents}`);
  }

  // Ark UI Checkbox + Panda sva slot recipe, in libs/shared/ui.
  const uiLibSrc = join(targetDir, 'libs', 'shared', 'ui', 'src', 'lib');
  mkdirSync(uiLibSrc, { recursive: true });
  writeFileSync(
    join(uiLibSrc, 'checkbox.recipe.ts'),
    `import { sva } from '../../../../../styled-system/css';\n\n` +
      `export const checkboxStyles = sva({\n` +
      `  slots: ['root', 'control', 'label'],\n` +
      `  base: {\n` +
      `    root: { display: 'flex', alignItems: 'center', gap: '2' },\n` +
      `    control: { w: '5', h: '5', borderWidth: '2px', borderRadius: 'sm', borderColor: 'gray.400' },\n` +
      `    label: { fontSize: 'md' },\n` +
      `  },\n` +
      `});\n`,
  );
  writeFileSync(
    join(uiLibSrc, 'checkbox.tsx'),
    `import { Checkbox as ArkCheckbox } from '@ark-ui/react/checkbox';\n` +
      `import { checkboxStyles } from './checkbox.recipe.js';\n\n` +
      `export interface CheckboxProps {\n  label: string;\n  defaultChecked?: boolean;\n}\n\n` +
      `export function Checkbox({ label, defaultChecked }: CheckboxProps) {\n` +
      `  const classes = checkboxStyles();\n` +
      `  return (\n` +
      `    <ArkCheckbox.Root className={classes.root} defaultChecked={defaultChecked}>\n` +
      `      <ArkCheckbox.Control className={classes.control} />\n` +
      `      <ArkCheckbox.Label className={classes.label}>{label}</ArkCheckbox.Label>\n` +
      `      <ArkCheckbox.HiddenInput />\n` +
      `    </ArkCheckbox.Root>\n` +
      `  );\n` +
      `}\n`,
  );

  const indexPath = join(targetDir, 'libs', 'shared', 'ui', 'src', 'index.ts');
  const indexContents = readFileSync(indexPath, 'utf8');
  if (!indexContents.includes('./lib/checkbox')) {
    writeFileSync(indexPath, `${indexContents}export * from './lib/checkbox';\n`);
  }

  // Wire the app -> lib dependency and sync NX's TS project references.
  const libPkg = readJson<PackageJsonLike>(join(targetDir, 'libs', 'shared', 'ui', 'package.json'));
  const appPkgPath = join(targetDir, 'apps', appName, 'package.json');
  const appPkg = readJson<PackageJsonLike>(appPkgPath);
  appPkg.dependencies = { ...appPkg.dependencies, [libPkg.name]: 'workspace:*' };
  writeJson(appPkgPath, appPkg);
  await run('pnpm', ['install'], targetDir);
  await run('npx', ['nx', 'sync'], targetDir);
}

async function installShadcnTailwind(targetDir: string, appName: string): Promise<void> {
  const appDir = join(targetDir, 'apps', appName);

  // shadcn's `init` no longer bootstraps Tailwind or path aliases itself —
  // it validates they already exist and fails otherwise. Wire both first.
  await run('pnpm', ['add', 'tailwindcss', '@tailwindcss/vite'], appDir);

  const viteConfigPath = join(appDir, 'vite.config.mts');
  let viteConfig = readFileSync(viteConfigPath, 'utf8');
  if (!viteConfig.includes('@tailwindcss/vite')) {
    viteConfig = `import tailwindcss from '@tailwindcss/vite';\nimport { fileURLToPath } from 'node:url';\n${viteConfig}`;
    viteConfig = viteConfig.replace('plugins: [react()],', 'plugins: [react(), tailwindcss()],');
    viteConfig = viteConfig.replace(
      'plugins: [react(), tailwindcss()],',
      "plugins: [react(), tailwindcss()],\n  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },",
    );
    writeFileSync(viteConfigPath, viteConfig);
  }

  const srcDir = join(appDir, 'src');
  writeFileSync(join(srcDir, 'styles.css'), '@import "tailwindcss";\n');
  const mainPath = join(srcDir, 'main.tsx');
  const mainContents = readFileSync(mainPath, 'utf8');
  if (!mainContents.includes('styles.css')) {
    writeFileSync(mainPath, `import './styles.css';\n${mainContents}`);
  }

  // shadcn's alias check reads the app's own tsconfig.json directly, not
  // the tsconfig.app.json it references — the paths must live here.
  const tsconfigPath = join(appDir, 'tsconfig.json');
  const tsconfig = readJson<TsconfigLike>(tsconfigPath);
  tsconfig.compilerOptions = { ...tsconfig.compilerOptions, baseUrl: '.', paths: { '@/*': ['./src/*'] } };
  writeJson(tsconfigPath, tsconfig);

  await run(
    'npx',
    ['--yes', 'shadcn@latest', 'init', '--template=vite', '--preset=nova', '--no-monorepo', '--yes', '--cwd', appDir],
    targetDir,
  );

  const libComponentsDir = join(targetDir, 'libs', 'shared', 'ui', 'src', 'components');
  mkdirSync(libComponentsDir, { recursive: true });
  await run(
    'npx',
    [
      '--yes',
      'shadcn@latest',
      'add',
      'button',
      '--yes',
      '--path',
      '../../libs/shared/ui/src/components',
      '--cwd',
      appDir,
    ],
    targetDir,
  );

  emitNoRawClassnameRuleFile(join(targetDir, 'libs', 'shared', 'ui'));
  // The emitted rule's config imports the typescript-eslint parser — this
  // tool is independently callable without setup-lint-format ever running,
  // so the dependency can't be left for that later stage to install.
  await ensureEslintDeps(targetDir);
}

const addUiLibraryInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to a workspace already scaffolded by scaffold-workspace.'),
  appName: z
    .string()
    .regex(PROJECT_NAME_PATTERN, 'must be lowercase alphanumeric with optional hyphens')
    .optional()
    .describe('The app slug generated by scaffold-workspace. Omit to auto-discover the single app under apps/.'),
  library: z
    .enum(['panda-ark', 'shadcn-tailwind'])
    .default('panda-ark')
    .describe('UI library choice. Default is Panda CSS + Ark UI; shadcn/Tailwind is an opt-in escape hatch.'),
  theming: themingInputSchema.describe(
    'Single theming step: interactive hex entry or paste (CSS vars / Panda token JSON, auto-detected).',
  ),
});

export type AddUiLibraryTheming =
  | {
      mode: 'interactive';
      primary: string;
      secondary: string;
      accent?: string | undefined;
      background?: string | undefined;
    }
  | { mode: 'paste'; pasted: string };

export async function addUiLibrary(
  targetDirInput: string,
  appNameInput: string | undefined,
  library: 'panda-ark' | 'shadcn-tailwind',
  theming: AddUiLibraryTheming,
): Promise<string> {
  const targetDir = validateExistingWorkspace(targetDirInput);
  const appName = resolveAppName(targetDir, appNameInput);

  const tokens: TokenScale =
    theming.mode === 'interactive'
      ? tokensFromHex({
          primary: theming.primary,
          secondary: theming.secondary,
          ...(theming.accent === undefined ? {} : { accent: theming.accent }),
          ...(theming.background === undefined ? {} : { background: theming.background }),
        })
      : normalizePastedTheme(theming.pasted);

  await (library === 'panda-ark'
    ? installPandaArk(targetDir, appName, tokens)
    : installShadcnTailwind(targetDir, appName));

  appendFigmaSection(targetDir, library as UiLibraryChoice);

  return `Installed ${library === 'panda-ark' ? 'Panda CSS + Ark UI' : 'Tailwind + shadcn/ui'} into libs/shared/ui, wired into apps/${appName}. Theme tokens applied. Figma kit link written to README.`;
}

export function registerAddUiLibraryTool(server: McpServer): void {
  server.registerTool(
    'add-ui-library',
    {
      description:
        'Stage B of the forgekit-reactor wizard: installs the chosen UI kit into libs/shared/ui, wires it into the generated app, applies theming, and surfaces the official Figma kit link when one exists. Default is Panda CSS + Ark UI; shadcn/Tailwind is available opt-in with a classname-lint rule enforcing component composition over raw utility classes.',
      inputSchema: addUiLibraryInputSchema,
    },
    async ({ targetDir, appName, library, theming }) => {
      let message: string;
      try {
        message = await addUiLibrary(targetDir, appName, library, theming);
      } catch (error) {
        return { content: [{ type: 'text', text: `Theming error: ${(error as Error).message}` }], isError: true };
      }
      return { content: [{ type: 'text', text: message }] };
    },
  );
}
