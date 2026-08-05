# forgekit-reactor

An MCP that scaffolds production-grade NX monorepos through a deterministic wizard — NX + React 19 + Vite, Panda CSS + Ark UI, Storybook, and more. Same inputs → same repo, every time.

## What it generates

- **Workspace** — a real NX monorepo (`apps/<app>` + `libs/shared/ui` + `libs/features`), React 19 + Vite, pnpm
- **UI library** — Panda CSS + Ark UI by default (component composition enforced by lint), Tailwind + shadcn/ui available as an explicit opt-in
- **Theming** — interactive hex entry or paste an existing theme (CSS vars or Panda token JSON, auto-detected)
- **Storybook** — stories, accessibility tests, and interaction tests that actually fail on real violations (real headless Chromium via Playwright), Chromatic wiring optional
- **Lint/format** — Oxlint + Oxfmt by default, ESLint + Prettier as an alternative
- **Auth** — first-party sign-in/up screens wired to Clerk's headless API, user schema generated regardless of engine

Backend/BFF and the Figma design-source path are deferred to v2.

## Install

Not yet published. To use locally:

```bash
git clone https://github.com/effinrich/forgekit-nx-builder.git
cd forgekit-nx-builder
pnpm install
pnpm build
```

## Usage

forgekit-reactor speaks MCP over stdio. Add it to your MCP client's config (Claude Code, Claude Desktop, etc.):

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

Then, from a fresh empty directory, run the `scaffold-project` tool to drive the full wizard in one call — project name, theming, and your library/lint/auth choices (all default to the MVP-recommended stack) — or call each stage's tool individually (`scaffold-workspace`, `add-ui-library`, `setup-storybook`, `setup-lint-format`, `setup-auth`) if you want to inspect or customize between steps.

## Development

```bash
pnpm build       # compile
pnpm typecheck   # type-check only
pnpm lint        # lint this repo's own source
pnpm test        # run the test suite (spawns real NX workspaces — several minutes)
```
