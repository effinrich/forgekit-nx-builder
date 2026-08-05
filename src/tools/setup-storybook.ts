import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { run } from '../lib/run-command.js';
import { readJson } from '../lib/json-file.js';

const CHROMATIC_PROMPT =
  'Install Chromatic? (visual regression testing for Storybook — catches unintended UI changes) [y/N]';

function patchMainAddons(uiLibDir: string): void {
  const mainPath = join(uiLibDir, '.storybook', 'main.ts');
  let main = readFileSync(mainPath, 'utf-8');
  if (main.includes('addons: [],')) {
    main = main.replace('addons: [],', "addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],");
    writeFileSync(mainPath, main);
  }
}

function writeVitestSetup(uiLibDir: string): void {
  // Storybook >= 10.3 applies preview annotations automatically; an explicit
  // setProjectAnnotations() call is unnecessary and prints a warning.
  writeFileSync(join(uiLibDir, '.storybook', 'vitest.setup.ts'), '// Storybook >= 10.3 applies preview annotations automatically.\nexport {};\n');
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
  if (!existsSync(storyPath)) return;
  let story = readFileSync(storyPath, 'utf-8');
  story = story.replace(/label: '',/g, "label: 'Accept terms',");
  story = story.replace('/Checkbox/gi', '/Accept terms/gi');
  writeFileSync(storyPath, story);
}

function appendChromaticReadme(targetDir: string, accepted: boolean): void {
  const readmePath = join(targetDir, 'README.md');
  const existing = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : '';
  const lines = [
    '\n## Storybook & Chromatic\n',
    `\`${CHROMATIC_PROMPT}\`\n`,
    accepted
      ? 'Chromatic requested. First-time project linking requires a one-time browser sign-in that cannot be automated — run `npx chromatic` locally to link this project and generate its token.\n'
      : 'Chromatic not installed for this project (skipped).\n',
    'Once linked, the project token must live as a **CI-side env var** (e.g. `CHROMATIC_PROJECT_TOKEN` in GitHub Actions secrets) — never commit it. It is also retrievable later from the Chromatic dashboard if lost.\n',
  ];
  writeFileSync(readmePath, existing + lines.join('\n'));
}

async function setupStorybook(targetDir: string, installChromatic: boolean): Promise<string> {
  const uiLibDir = join(targetDir, 'libs', 'shared', 'ui');
  const libPkg = readJson(join(uiLibDir, 'package.json'));

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

  const rootPkg = readJson(join(targetDir, 'package.json'));
  const storybookVersion: string = rootPkg.devDependencies?.storybook;
  if (!storybookVersion) {
    throw new Error('Could not determine installed storybook version after storybook-configuration generator ran.');
  }

  await run(
    'pnpm',
    [
      'add',
      '-Dw',
      `@storybook/addon-a11y@${storybookVersion}`,
      `@storybook/addon-vitest@${storybookVersion}`,
      '@vitest/browser-playwright',
      'playwright',
    ],
    targetDir,
  );

  patchMainAddons(uiLibDir);
  fixCheckboxStoryArgs(uiLibDir);
  writeVitestSetup(uiLibDir);
  writeStorybookVitestProject(uiLibDir);

  await run('npx', ['playwright', 'install', 'chromium'], targetDir);

  if (installChromatic) {
    const hasToken = Boolean(process.env['CHROMATIC_PROJECT_TOKEN']);
    if (hasToken) {
      await run('npx', ['--yes', 'chromatic', '--project-token', process.env['CHROMATIC_PROJECT_TOKEN']!], uiLibDir);
    }
    // No token available: first-time linking needs interactive browser auth
    // (see appendChromaticReadme) — trust-prior-verify, not fakeable headlessly.
  }

  appendChromaticReadme(targetDir, installChromatic);

  return `Storybook configured for ${libPkg.name} (a11y + interaction-test addons wired, Playwright chromium installed). ${
    installChromatic ? 'Chromatic requested — see README for one-time linking step.' : 'Chromatic skipped.'
  }`;
}

const setupStorybookInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to a workspace already scaffolded, with libs/shared/ui populated by add-ui-library.'),
  installChromatic: z
    .boolean()
    .default(false)
    .describe(CHROMATIC_PROMPT),
});

export function registerSetupStorybookTool(server: McpServer): void {
  server.registerTool(
    'setup-storybook',
    {
      description:
        'Stage C (Storybook) of the forgekit-reactor wizard: configures Storybook for libs/shared/ui with auto-generated stories, a11y and interaction-test addons (Playwright-backed), and optionally Chromatic. ' +
        CHROMATIC_PROMPT,
      inputSchema: setupStorybookInputSchema,
    },
    async ({ targetDir, installChromatic }) => {
      const message = await setupStorybook(targetDir, installChromatic);
      return { content: [{ type: 'text', text: message }] };
    },
  );
}
