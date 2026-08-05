import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { FRAMEWORK_CHOICES, isFrameworkSupported, validateProjectName } from '../wizard/types.js';
import { comingSoonMessage } from '../wizard/comingSoon.js';
import { run } from '../lib/run-command.js';

const ZUSTAND_VERSION = '^5.0.0';

function assertEmptyDir(dir: string): void {
  const entries = readdirSync(dir);
  if (entries.length > 0) {
    throw new Error(
      `Target directory "${dir}" is not empty (contains: ${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', ...' : ''}). ` +
        'forgekit-reactor scaffolds into a fresh, empty directory only.',
    );
  }
}

interface ScaffoldResult {
  workspacePath: string;
  appName: string;
  nxVersion: string;
}

async function scaffoldNxWorkspace(targetDir: string, appName: string): Promise<ScaffoldResult> {
  assertEmptyDir(targetDir);

  // 1. Bare empty NX workspace, scaffolded directly into the target dir.
  await run(
    'npx',
    [
      '--yes',
      'create-nx-workspace@latest',
      '.',
      '--template=empty',
      '--packageManager=pnpm',
      '--interactive=false',
      '--nxCloud=skip',
      '--defaultBase=main',
    ],
    targetDir,
  );

  // 2. Discover the nx version the empty template actually installed, and align
  //    @nx/js + @nx/react to the exact same version — a version-skew bug between
  //    nx and @nx/react causes generators to crash with an unrelated-looking error.
  const rootPkgPath = join(targetDir, 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
  const nxVersion: string = rootPkg.devDependencies?.nx;
  if (!nxVersion) {
    throw new Error('Could not determine installed nx version from generated package.json.');
  }

  rootPkg.pnpm = { ...(rootPkg.pnpm ?? {}), onlyBuiltDependencies: ['nx'] };
  writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');

  await run('pnpm', ['add', '-D', `nx@${nxVersion}`, `@nx/js@${nxVersion}`, `@nx/react@${nxVersion}`], targetDir);

  // 3. Generate the app (React 19 + Vite + Vitest, no e2e/style scaffolding here —
  //    e2e is wired in a later phase, styling is owned by add-ui-library).
  await run(
    'npx',
    [
      'nx',
      'g',
      '@nx/react:app',
      `apps/${appName}`,
      '--bundler=vite',
      '--unitTestRunner=vitest',
      '--e2eTestRunner=none',
      '--style=none',
      '--interactive=false',
    ],
    targetDir,
  );

  // 4. Generate the design-system lib — mount point for add-ui-library (Phase 3).
  await run(
    'npx',
    [
      'nx',
      'g',
      '@nx/react:lib',
      'libs/shared/ui',
      '--bundler=vite',
      '--unitTestRunner=vitest',
      '--style=none',
      '--interactive=false',
    ],
    targetDir,
  );

  // 5. libs/features is a mount point for future per-feature libs, not a single
  //    generated project — just ensure the directory exists.
  mkdirSync(join(targetDir, 'libs', 'features'), { recursive: true });
  writeFileSync(join(targetDir, 'libs', 'features', '.gitkeep'), '');

  // 6. Zustand — base dependency of the generated app per plan §6 (client state:
  //    TanStack Query owns server state, Zustand owns local/global UI state).
  const appPkgPath = join(targetDir, 'apps', appName, 'package.json');
  const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf-8'));
  appPkg.dependencies = { ...(appPkg.dependencies ?? {}), zustand: ZUSTAND_VERSION };
  writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n');
  await run('pnpm', ['install'], targetDir);

  return { workspacePath: targetDir, appName, nxVersion };
}

const scaffoldWorkspaceInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to an empty directory to scaffold the workspace into.'),
  projectName: z.string().describe('Name for the project (also used as the app slug under apps/).'),
  framework: z.enum(FRAMEWORK_CHOICES).default('none').describe('Framework choice for Stage A of the wizard.'),
});

export function registerScaffoldWorkspaceTool(server: McpServer): void {
  server.registerTool(
    'scaffold-workspace',
    {
      description:
        'Stage A of the forgekit-reactor wizard: scaffolds a real NX react-monorepo (apps/<app> + libs/shared/ui + libs/features) into an empty target directory. MVP supports the "none" (React 19 + Vite) framework only; other choices return a "coming in v2" response.',
      inputSchema: scaffoldWorkspaceInputSchema,
    },
    async ({ targetDir, projectName, framework }) => {
      const nameCheck = validateProjectName(projectName);
      if (!nameCheck.valid) {
        return { content: [{ type: 'text', text: `Invalid project name: ${nameCheck.reason}` }], isError: true };
      }

      if (!isFrameworkSupported(framework)) {
        return { content: [{ type: 'text', text: comingSoonMessage(framework) }] };
      }

      const result = await scaffoldNxWorkspace(targetDir, projectName);
      return {
        content: [
          {
            type: 'text',
            text: `Scaffolded NX workspace at ${result.workspacePath} (nx ${result.nxVersion}). App: apps/${result.appName}, design system: libs/shared/ui, feature mount point: libs/features. Zustand installed as a base app dependency.`,
          },
        ],
      };
    },
  );
}
