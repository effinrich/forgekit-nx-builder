import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { validateProjectName } from '../wizard/types.js';
import { scaffoldNxWorkspace } from './scaffold-workspace.js';
import { addUiLibrary } from './add-ui-library.js';
import type { AddUiLibraryTheming } from './add-ui-library.js';
import { setupStorybook } from './setup-storybook.js';
import { setupLintFormat } from './setup-lint-format.js';
import { setupAuth, identityProvidersSchema } from './setup-auth.js';
import type { IdentityProviders } from './setup-auth.js';
import { themingInputSchema } from '../ui-lib/theming.js';

const scaffoldProjectInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to an empty directory to scaffold the full project into.'),
  projectName: z.string().describe('Project name — also used as the app slug under apps/.'),
  theming: themingInputSchema.describe(
    'Single theming step: interactive hex entry or paste (CSS vars / Panda token JSON, auto-detected).',
  ),
  library: z.enum(['panda-ark', 'shadcn-tailwind']).default('panda-ark'),
  linter: z.enum(['oxlint', 'eslint']).default('oxlint'),
  installChromatic: z.boolean().default(false),
  authEngine: z.enum(['clerk', 'self-hosted']).default('clerk'),
  identityProviders: identityProvidersSchema.default({ email: 'password', google: false, github: false }),
});

export function registerScaffoldProjectTool(server: McpServer): void {
  server.registerTool(
    'scaffold-project',
    {
      description:
        'Runs the full forgekit-reactor MVP wizard end-to-end in one call: scaffolds the NX workspace (Stage A, React 19 + Vite), installs the UI library with theming (Stage B), configures Storybook (Stage C), wires lint/format (Stage C), and generates Clerk-backed auth (Stage D). Backend (Stage E) and the Figma design-source path are deferred to v2 and not run here.',
      inputSchema: scaffoldProjectInputSchema,
    },
    async ({ targetDir, projectName, theming, library, linter, installChromatic, authEngine, identityProviders }) => {
      const nameCheck = validateProjectName(projectName);
      if (!nameCheck.valid) {
        return { content: [{ type: 'text', text: `Invalid project name: ${nameCheck.reason}` }], isError: true };
      }

      const steps: string[] = [];

      try {
        const scaffoldResult = await scaffoldNxWorkspace(targetDir, projectName);
        steps.push(`Stage A — workspace scaffolded (nx ${scaffoldResult.nxVersion}), app: apps/${projectName}`);

        const uiMessage = await addUiLibrary(targetDir, projectName, library, theming as AddUiLibraryTheming);
        steps.push(`Stage B — ${uiMessage}`);

        const storybookMessage = await setupStorybook(targetDir, installChromatic);
        steps.push(`Stage C (Storybook) — ${storybookMessage}`);

        const lintMessage = await setupLintFormat(targetDir, linter);
        steps.push(`Stage C (lint/format) — ${lintMessage}`);

        const authMessage = await setupAuth(targetDir, projectName, authEngine, identityProviders as IdentityProviders);
        steps.push(`Stage D (auth) — ${authMessage}`);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text:
                `forgekit-reactor scaffold failed at ${targetDir} after ${steps.length} completed step(s):\n\n` +
                `${steps.map((s) => `- ${s}`).join('\n')}\n\n` +
                `Failure: ${(error as Error).message}\n\n` +
                'The workspace is left in this partial state — re-run the individual failed stage tool once the underlying issue is fixed, rather than re-running scaffold-project from scratch.',
            },
          ],
          isError: true,
        };
      }

      steps.push(
        'Stage E (backend/BFF) — deferred to v2, skipped by design (not silently dropped: the plan commits to frontend-only for this MVP).',
        'Design source (Figma-in / code-to-Figma) — deferred to v2, skipped by design.',
      );

      return {
        content: [
          {
            type: 'text',
            text: `forgekit-reactor scaffold complete at ${targetDir}.\n\n${steps.map((s) => `- ${s}`).join('\n')}`,
          },
        ],
      };
    },
  );
}
