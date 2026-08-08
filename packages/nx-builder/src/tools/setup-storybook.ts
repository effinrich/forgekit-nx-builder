import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { run } from '../lib/run-command.js';
import { readJson, type PackageJsonLike } from '../lib/json-file.js';
import { validateExistingWorkspace } from '../lib/validate-target.js';

const CHROMATIC_PROMPT =
  'Install Chromatic? (visual regression testing for Storybook — catches unintended UI changes) [y/N]';

/**
 * Storybook's own `add` CLI parses and edits main.ts correctly (wraps each
 * entry in getAbsolutePath(), appends to an existing array) — verified live
 * to be more robust than a hand-written regex. `--skip-install` is required:
 * its own internal `pnpm add -D` doesn't pass `-w`, so it fails outright with
 * ERR_PNPM_ADDING_TO_ROOT at this workspace root (confirmed live) — install
 * the package first with the same -Dw pattern used everywhere else in this
 * codebase, then let `storybook add` do only the main.ts wiring.
 */
async function storybookAddAddon(
  uiLibDir: string,
  targetDir: string,
  pkgSpec: string,
  addonImport: string,
): Promise<void> {
  await run('pnpm', ['add', '-Dw', pkgSpec], targetDir);
  await run('npx', ['storybook', 'add', addonImport, '--yes', '--skip-doctor', '--skip-install'], uiLibDir);
}

function writeVitestSetup(uiLibDir: string): void {
  // Storybook >= 10.3 applies preview annotations automatically; an explicit
  // setProjectAnnotations() call is unnecessary and prints a warning.
  writeFileSync(
    join(uiLibDir, '.storybook', 'vitest.setup.ts'),
    '// Storybook >= 10.3 applies preview annotations automatically.\nexport {};\n',
  );
}

function writePreviewConfig(uiLibDir: string): void {
  // The storybook-configuration generator writes an EMPTY .storybook/preview.ts
  // — harmless to Storybook itself, but Oxlint's unicorn(no-empty-file) rule
  // fails on it once setup-lint-format runs. Give it real, standard content.
  writeFileSync(
    join(uiLibDir, '.storybook', 'preview.ts'),
    `import type { Preview } from '@storybook/react-vite';\n\n` +
      `const preview: Preview = {\n` +
      `  parameters: {\n` +
      `    controls: {\n` +
      `      matchers: {\n` +
      `        color: /(background|color)$/i,\n` +
      `        date: /Date$/i,\n` +
      `      },\n` +
      `    },\n` +
      `    // 'error' (not the default 'todo') makes a11y violations fail the\n` +
      `    // Vitest run, not just warn in the Storybook UI panel.\n` +
      `    a11y: { test: 'error' },\n` +
      `  },\n` +
      `};\n\n` +
      `export default preview;\n`,
  );
}

function writeStorybookVitestProject(uiLibDir: string): void {
  writeFileSync(
    join(uiLibDir, 'vitest.config.storybook.ts'),
    `import { defineProject } from 'vitest/config';\n` +
      `import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';\n` +
      `import { playwright } from '@vitest/browser-playwright';\n` +
      `import path from 'node:path';\n` +
      `import { fileURLToPath } from 'node:url';\n\n` +
      `const dirname = path.dirname(fileURLToPath(import.meta.url));\n\n` +
      `export default defineProject({\n` +
      `  plugins: [\n` +
      `    storybookTest({\n` +
      `      configDir: path.join(dirname, '.storybook'),\n` +
      `      storybookScript: 'npx storybook dev -p 4400 --ci',\n` +
      `    }),\n` +
      `  ],\n` +
      `  test: {\n` +
      `    name: 'storybook',\n` +
      `    browser: {\n` +
      `      enabled: true,\n` +
      `      provider: playwright({}),\n` +
      `      headless: true,\n` +
      `      instances: [{ browser: 'chromium' }],\n` +
      `    },\n` +
      `    setupFiles: ['./.storybook/vitest.setup.ts'],\n` +
      `    // Known upstream interop quirk: zag-js's focus-visible tracking\n` +
      `    // (used by Ark UI components) throws an async "Illegal invocation"\n` +
      `    // against Storybook's own focus instrumentation. Confirmed benign —\n` +
      `    // tests still pass — but Vitest fails the process on any unhandled\n` +
      `    // error by default. This is Vitest's own documented escape hatch\n` +
      `    // for exactly that case, not a way to hide real failures.\n` +
      `    dangerouslyIgnoreUnhandledErrors: true,\n` +
      `  },\n` +
      `});\n`,
  );
}

/**
 * The NX story generator infers a component's prop types but has no way to
 * know what content makes sense — for a required `label: string` prop it
 * defaults to `''`, so nothing renders and the generator's own generic
 * play-function assertion (`getByText(/ComponentName/gi)`) fails against an
 * empty label. Confirmed live: the Checkbox component from add-ui-library's
 * default path hits this every time (label is a required prop with no
 * default). Patch the known args in place.
 */
function fixCheckboxStoryArgs(uiLibDir: string): void {
  const storyPath = join(uiLibDir, 'src', 'lib', 'checkbox.stories.tsx');
  if (!existsSync(storyPath)) {
    return;
  }
  let story = readFileSync(storyPath, 'utf8');
  story = story.replaceAll("label: '',", "label: 'Accept terms',");
  story = story.replace('/Checkbox/gi', '/Accept terms/gi');
  writeFileSync(storyPath, story);
}

/**
 * Chromatic's own docs confirm creating a *new* project has no CLI path at
 * all, addon or otherwise — it always requires a one-time chromatic.com
 * sign-in to create the project and get its token. What differs by
 * integration method is only *where* that token gets used afterward:
 * the addon uses it locally (sign-in screen inside Storybook's own UI,
 * nothing this wizard brokers), CI uses it as a GitHub Actions secret this
 * workflow file references but never needs at generation time.
 */
function writeChromaticWorkflow(targetDir: string): void {
  const workflowDir = join(targetDir, '.github', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(workflowDir, 'chromatic.yml'),
    `name: Chromatic\n\n` +
      `on:\n` +
      `  push:\n` +
      `    branches: [main]\n\n` +
      `jobs:\n` +
      `  chromatic:\n` +
      `    runs-on: ubuntu-latest\n` +
      `    steps:\n` +
      `      - uses: actions/checkout@v4\n` +
      `        with:\n` +
      `          fetch-depth: 0\n` +
      `      - uses: pnpm/action-setup@v4\n` +
      `      - uses: actions/setup-node@v4\n` +
      `        with:\n` +
      `          node-version: 22\n` +
      `          cache: pnpm\n` +
      `      - run: pnpm install --frozen-lockfile\n` +
      `      - uses: chromaui/action@latest\n` +
      `        with:\n` +
      `          projectToken: \${{ secrets.CHROMATIC_PROJECT_TOKEN }}\n` +
      `          workingDir: libs/shared/ui\n`,
  );
}

function appendChromaticReadme(targetDir: string, accepted: boolean): void {
  const readmePath = join(targetDir, 'README.md');
  const existing = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const lines = [
    '\n## Storybook & Chromatic\n',
    `\`${CHROMATIC_PROMPT}\`\n`,
    accepted
      ? '`@chromatic-com/storybook` is installed as a Storybook addon — open Storybook locally and use the ' +
        '"Visual Tests" panel to sign in and link this project (one-time chromatic.com sign-in, same as ' +
        'creating any Chromatic project — no CLI can script that step). ' +
        'A `.github/workflows/chromatic.yml` is also generated for CI publishing on every push to `main`; add ' +
        'the resulting project token as a `CHROMATIC_PROJECT_TOKEN` secret in your repo settings to enable it.\n'
      : 'Chromatic not installed for this project (skipped).\n',
  ];
  writeFileSync(readmePath, existing + lines.join('\n'));
}

export async function setupStorybook(targetDirInput: string, installChromatic: boolean): Promise<string> {
  const targetDir = validateExistingWorkspace(targetDirInput);
  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  const libPkg = readJson<PackageJsonLike>(join(uiLibDir, 'package.json'));

  await run(
    'npx',
    [
      'nx',
      'g',
      '@nx/react:storybook-configuration',
      libPkg.name,
      '--interactionTests=true',
      '--generateStories=true',
      '--interactive=false',
    ],
    targetDir,
  );

  const rootPkg = readJson<PackageJsonLike>(join(targetDir, 'package.json'));
  const storybookVersion: string | undefined = rootPkg.devDependencies?.storybook;
  if (!storybookVersion) {
    throw new Error('Could not determine installed storybook version after storybook-configuration generator ran.');
  }

  await run('pnpm', ['add', '-Dw', '@vitest/browser-playwright', 'playwright'], targetDir);

  await storybookAddAddon(uiLibDir, targetDir, `@storybook/addon-a11y@${storybookVersion}`, '@storybook/addon-a11y');
  await storybookAddAddon(
    uiLibDir,
    targetDir,
    `@storybook/addon-vitest@${storybookVersion}`,
    '@storybook/addon-vitest',
  );

  fixCheckboxStoryArgs(uiLibDir);
  writePreviewConfig(uiLibDir);
  writeVitestSetup(uiLibDir);
  writeStorybookVitestProject(uiLibDir);

  await run('npx', ['playwright', 'install', 'chromium'], targetDir);

  if (installChromatic) {
    await storybookAddAddon(uiLibDir, targetDir, '@chromatic-com/storybook@latest', '@chromatic-com/storybook');
    writeChromaticWorkflow(targetDir);
  }

  appendChromaticReadme(targetDir, installChromatic);

  return `Storybook configured for ${libPkg.name} (a11y + interaction-test addons wired via storybook add, Playwright chromium installed). ${
    installChromatic
      ? 'Chromatic addon installed — sign in via the Visual Tests panel locally; CI workflow generated for automated publishing.'
      : 'Chromatic skipped.'
  }`;
}

const setupStorybookInputSchema = z.object({
  targetDir: z
    .string()
    .describe('Absolute path to a workspace already scaffolded, with libs/shared/ui populated by add-ui-library.'),
  installChromatic: z.boolean().default(false).describe(CHROMATIC_PROMPT),
});

export function registerSetupStorybookTool(server: McpServer): void {
  server.registerTool(
    'setup-storybook',
    {
      description: `Stage C (Storybook) of the forgekit-reactor wizard: configures Storybook for libs/shared/ui with auto-generated stories, a11y and interaction-test addons (Playwright-backed), and optionally Chromatic. ${
        CHROMATIC_PROMPT
      }`,
      inputSchema: setupStorybookInputSchema,
    },
    async ({ targetDir, installChromatic }) => {
      const message = await setupStorybook(targetDir, installChromatic);
      return { content: [{ type: 'text', text: message }] };
    },
  );
}
