# forgekit-reactor

An MCP server that scaffolds production-grade NX monorepos through a deterministic wizard — NX + React 19 + Vite, Panda CSS + Ark UI, Storybook with real accessibility/interaction tests, and Clerk-backed auth. Every wizard answer maps to a known, repeatable generation step, not freeform output: same inputs → same repo, every time.

## What it generates

| Piece | Default | Alternative |
|---|---|---|
| Workspace | NX monorepo — `apps/<app>` + `libs/shared/ui` + `libs/features`, React 19 + Vite, pnpm | — |
| UI library | Panda CSS + Ark UI, component composition enforced by lint | Tailwind + shadcn/ui (opt-in, same lint enforcement) |
| Theming | Interactive hex entry, or paste an existing theme (CSS vars / Panda token JSON, auto-detected) | — |
| Storybook | Stories + accessibility tests (`test: 'error'`, real failures on violations) + interaction tests (real headless Chromium via Playwright) | — |
| Lint/format | Oxlint + Oxfmt (via `@nx-oxc/nx`) | ESLint + Prettier |
| Auth | First-party sign-in/up screens on Clerk's headless API, user schema generated regardless of engine | Self-hosted (Better Auth) — v2, not yet built |

Chromatic is optional on top of Storybook. Backend/BFF and the Figma design-source path are deferred to v2 — the wizard says so explicitly rather than silently skipping them.

## Install

Once published:

```bash
npm install -g forgekit-reactor
# or invoke without installing:
npx forgekit-reactor
```

From source:

```bash
git clone https://github.com/effinrich/forgekit-nx-builder.git
cd forgekit-nx-builder
pnpm install
pnpm build
```

## Usage

forgekit-reactor speaks MCP over stdio — it's a server, not a CLI you type commands into directly. Add it to your MCP client's config:

```json
{
  "mcpServers": {
    "forgekit-reactor": {
      "command": "npx",
      "args": ["forgekit-reactor"]
    }
  }
}
```

Or, running from a local clone:

```json
{
  "mcpServers": {
    "forgekit-reactor": {
      "command": "node",
      "args": ["/absolute/path/to/forgekit-nx-builder/dist/index.js"]
    }
  }
}
```

From your MCP client (Claude Code, Claude Desktop, or anything else that speaks MCP), point it at an **empty** target directory and call `scaffold-project` to run the whole wizard in one shot, or call each stage's tool individually if you want to inspect the workspace between steps.

## Tool reference

All tools accept an absolute `targetDir`. Tools other than `scaffold-workspace` expect that directory to already have a workspace in it (i.e. run `scaffold-workspace` — or `scaffold-project`, which does it for you — first).

### `ping`

Health check. No arguments. Returns `"pong"`.

### `scaffold-project`

Runs the full wizard end-to-end in one call.

| Param | Type | Default | Notes |
|---|---|---|---|
| `targetDir` | `string` | — | Absolute path to an **empty** directory |
| `projectName` | `string` | — | Lowercase alphanumeric + hyphens; also becomes the app slug under `apps/` |
| `theming` | `{ mode: 'interactive', primary, secondary, accent?, background? }` \| `{ mode: 'paste', pasted }` | — | Hex colors, or a pasted CSS-vars block / Panda token JSON (auto-detected) |
| `library` | `'panda-ark'` \| `'shadcn-tailwind'` | `'panda-ark'` | |
| `linter` | `'oxlint'` \| `'eslint'` | `'oxlint'` | |
| `installChromatic` | `boolean` | `false` | |
| `authEngine` | `'clerk'` \| `'self-hosted'` | `'clerk'` | `'self-hosted'` returns a v2 message, no auth code generated |
| `identityProviders` | `{ email: 'password' \| 'magic-link', google: boolean, github: boolean }` | `{ email: 'password', google: false, github: false }` | |

Returns a step-by-step summary of what ran, including explicit deferred-to-v2 notes for backend and the Figma design source.

### `scaffold-workspace`

Stage A. Scaffolds the NX workspace itself.

| Param | Type | Default | Notes |
|---|---|---|---|
| `targetDir` | `string` | — | Must be empty |
| `projectName` | `string` | — | Validated the same way as `scaffold-project` |
| `framework` | `'none'` \| `'nextjs'` \| `'tanstack'` \| `'expo'` | `'none'` | Only `'none'` (React + Vite) is implemented; the others return a "coming in v2" message |

### `add-ui-library`

Stage B. Installs the chosen UI kit into `libs/shared/ui` and applies theming.

| Param | Type | Default |
|---|---|---|
| `targetDir` | `string` | — |
| `appName` | `string` (optional) | auto-discovered from the single app under `apps/` |
| `library` | `'panda-ark'` \| `'shadcn-tailwind'` | `'panda-ark'` |
| `theming` | same shape as `scaffold-project`'s `theming` | — |

Writes the real, sourced official Figma kit link for the chosen library into the generated README.

### `setup-storybook`

Stage C (Storybook). Configures Storybook against `libs/shared/ui`.

| Param | Type | Default |
|---|---|---|
| `targetDir` | `string` | — |
| `installChromatic` | `boolean` | `false` |

If Chromatic is requested, the tool wires the CLI invocation and CI env-var guidance; first-time project linking needs a one-time interactive browser sign-in that can't be scripted, so that specific step is left to you.

### `setup-lint-format`

Stage C (lint/format).

| Param | Type | Default |
|---|---|---|
| `targetDir` | `string` | — |
| `linter` | `'oxlint'` \| `'eslint'` | `'oxlint'` |

### `setup-auth`

Stage D. Generates Clerk-backed first-party sign-in/up screens and a user schema.

| Param | Type | Default |
|---|---|---|
| `targetDir` | `string` | — |
| `appName` | `string` (optional) | auto-discovered from the single app under `apps/` |
| `authEngine` | `'clerk'` \| `'self-hosted'` | `'clerk'` |
| `identityProviders` | `{ email, google, github }` | `{ email: 'password', google: false, github: false }` |

The user schema is generated even when `authEngine: 'self-hosted'` is chosen — the first-party UI needs a shape to bind to regardless of engine.

## Example: calling `scaffold-project`

```json
{
  "name": "scaffold-project",
  "arguments": {
    "targetDir": "/Users/you/projects/my-app",
    "projectName": "my-app",
    "theming": { "mode": "interactive", "primary": "#3b82f6", "secondary": "#f97316" },
    "identityProviders": { "email": "password", "google": true, "github": false }
  }
}
```

Everything else takes its default (Panda CSS + Ark UI, Oxlint + Oxfmt, Clerk, no Chromatic) — this produces a complete NX + React 19 + Vite + Panda/Ark + Storybook + Clerk-auth monorepo in one call.

## Architecture

- `src/server.ts` — the MCP server instance and tool registrations
- `src/tools/*.ts` — one file per wizard stage; each exports both a plain async function (for direct composition — `scaffold-project` calls the others' functions directly rather than re-entering the MCP transport) and an MCP tool registration
- `src/ui-lib/`, `src/auth-lib/`, `src/wizard/` — shared logic: theming normalization, the classname-lint rule, Figma kit links, the user schema template, project-name validation
- `src/lib/` — small cross-cutting helpers (async subprocess runner, JSON file I/O)

Generator tools shell out to real toolchains non-interactively (`create-nx-workspace`, NX generators, `panda`, `shadcn`, `nx add @nx-oxc/nx`, etc.) rather than hand-rolling config from scratch, so generated projects stay current with each tool's own conventions.

## Roadmap (v2)

- Additional frameworks: Next.js, TanStack Start/Router, Expo
- Backend/BFF (NestJS + tRPC by default, FastAPI + OpenAPI-codegen for the Python track)
- Figma bridge (design-to-code and code-to-Figma)
- Self-hosted auth engine (Better Auth)

## Development

```bash
pnpm build       # compile
pnpm typecheck   # type-check only
pnpm lint        # lint this repo's own source
pnpm test        # run the test suite (spawns real NX workspaces — several minutes)
```

## License

MIT
