## Learned User Preferences

- Never declare software done or green without exact command output and exit-code evidence; no status theater or unverified claims.
- Do not wipe or delete working workspaces or untracked nested projects when reverting unrelated WIP; ask first.
- Do not use soft validation phrasing such as "you're right to be mad."
- Prefer real policing/validator gates that actually run over simulated process or pretend setup.
- Be pragmatic and no-hype; if something cannot be done, say so and stop rather than overclaiming.
- Keep this repo a single-package MCP Nx workspace; do not force-fit a full monorepo conversion onto it.

## Learned Workspace Facts

- `forgekit-nx-builder` on main is the Node MCP package (`forgekit-reactor`), structured as a single-package Nx workspace.
- Nested `nx-reactor/` is a separate plugin workspace and is gitignored from the parent repo.
- Remote is https://github.com/effinrich/forgekit-nx-builder.
- Lint/format uses oxlint/oxfmt; run Nx via the workspace package manager (`bunx nx` / `pnpm nx`).
- `ContextPool/` artifacts are not real Nx projects and must stay out of the workspace graph (gitignored).
