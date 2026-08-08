import type { Tree } from '@nx/devkit';
import { addUiLibrary, type AddUiLibraryTheming } from '../../tools/add-ui-library.js';
import type { AddUiLibraryGeneratorSchema } from './schema.js';

/**
 * Wraps the same addUiLibrary() function the MCP wizard's Stage B tool uses
 * — real fs writes and real subprocess installs (panda/shadcn CLIs, pnpm),
 * not Tree-staged changes. That means this generator can't participate in
 * NX's Tree-based --dry-run preview; explicitly refusing dry-run (same
 * pattern @nx/react:storybook-configuration and @nx/devkit's own internals
 * use, confirmed by reading their source) is honest, silently no-op-ing
 * under --dry-run would not be.
 */
export default async function addUiLibraryGenerator(tree: Tree, options: AddUiLibraryGeneratorSchema): Promise<void> {
  if (process.env['NX_DRY_RUN'] && process.env['NX_DRY_RUN'] !== 'false') {
    throw new Error(
      'forgekit-reactor:add-ui-library does not support --dry-run — it installs real packages and writes real ' +
        "files directly, not through NX's Tree. Run it for real, or run it in a throwaway branch/worktree first.",
    );
  }

  const theming = buildTheming(options);
  const message = await addUiLibrary(tree.root, options.appName, options.library ?? 'panda-ark', theming);
  console.log(message);
}

function buildTheming(options: AddUiLibraryGeneratorSchema): AddUiLibraryTheming {
  if (options.themingMode === 'paste') {
    if (!options.pasted) {
      throw new Error("themingMode is 'paste' but no `pasted` content was given.");
    }
    return { mode: 'paste', pasted: options.pasted };
  }

  if (!options.primary || !options.secondary) {
    throw new Error("themingMode is 'interactive' but `primary` and/or `secondary` hex colors are missing.");
  }
  return {
    mode: 'interactive',
    primary: options.primary,
    secondary: options.secondary,
    ...(options.accent !== undefined ? { accent: options.accent } : {}),
    ...(options.background !== undefined ? { background: options.background } : {}),
  };
}
