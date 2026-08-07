import { existsSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { PROJECT_NAME_PATTERN } from '../wizard/types.js'

/** For tools that scaffold a brand-new workspace into targetDir. */
export function validateNewTargetDir(targetDir: string): string {
  if (!isAbsolute(targetDir)) {
    throw new Error(`targetDir must be an absolute path, got "${targetDir}".`)
  }
  const resolved = resolve(targetDir)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`targetDir "${resolved}" is not an existing directory.`)
  }
  return resolved
}

/**
 * For tools that mutate an existing workspace. Refuses anything that isn't
 * a real NX workspace forgekit-reactor could plausibly have scaffolded —
 * without this, every tool that accepts targetDir is an arbitrary-directory
 * subprocess-execution and file-write primitive.
 */
export function validateExistingWorkspace(targetDir: string): string {
  const resolved = validateNewTargetDir(targetDir)
  for (const marker of ['nx.json', 'package.json']) {
    if (!existsSync(resolve(resolved, marker))) {
      throw new Error(
        `targetDir "${resolved}" is not an NX workspace (missing ${marker}). ` +
          'Run scaffold-workspace (or scaffold-project) first — forgekit-reactor refuses to modify arbitrary directories.'
      )
    }
  }
  return resolved
}

/**
 * Resolves the appName parameter for tools that operate on apps/<appName>.
 * Defaulting appName to a fixed string like "app" is wrong for any project
 * scaffolded under a different name — instead, when not explicitly given,
 * discover it from the single entry under apps/. Ambiguous or missing cases
 * fail loudly rather than silently operating on the wrong (or a nonexistent)
 * directory.
 */
export function resolveAppName(
  targetDir: string,
  appName: string | undefined
): string {
  if (appName !== undefined) {
    // The MCP schema layer already validates this per call site, but that
    // invariant shouldn't live only in scattered zod .regex() declarations —
    // resolveAppName feeds directly into fs paths and subprocess --cwd, so
    // it must refuse to pass through an unvalidated value itself.
    if (!PROJECT_NAME_PATTERN.test(appName)) {
      throw new Error(
        `appName "${appName}" must be lowercase alphanumeric with optional hyphens (e.g. "my-app").`
      )
    }
    return appName
  }
  const appsDir = join(targetDir, 'apps')
  if (!existsSync(appsDir)) {
    throw new Error(
      `No apps/ directory found under "${targetDir}" — run scaffold-workspace first.`
    )
  }
  const entries = readdirSync(appsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.endsWith('-e2e'))
    .map(e => e.name)
  if (entries.length === 0) {
    throw new Error(
      `No app found under "${appsDir}" — run scaffold-workspace first.`
    )
  }
  if (entries.length > 1) {
    throw new Error(
      `Multiple apps found under "${appsDir}" (${entries.join(', ')}) — pass appName explicitly to disambiguate.`
    )
  }
  return entries[0]!
}
