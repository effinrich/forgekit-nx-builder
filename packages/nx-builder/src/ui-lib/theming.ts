import * as z from 'zod/v4';

export interface TokenScale {
  colors: {
    primary: { value: string };
    secondary?: { value: string };
    accent?: { value: string };
    background?: { value: string };
  };
}

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Pasted content is untrusted and unauthenticated (a single MCP call, no
// confirmation gate) — cap it before either parser touches it.
export const MAX_THEME_BYTES = 64 * 1024;

/** Shared by add-ui-library and scaffold-project — identical theming input shape. */
export const themingInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('interactive'),
    primary: z.string(),
    secondary: z.string(),
    accent: z.string().optional(),
    background: z.string().optional(),
  }),
  z.object({ mode: z.literal('paste'), pasted: z.string().max(MAX_THEME_BYTES) }),
]);

export interface HexThemeInput {
  primary: string;
  secondary: string;
  accent?: string;
  background?: string;
}

export function validateHex(value: string): boolean {
  return HEX_PATTERN.test(value);
}

export function tokensFromHex(input: HexThemeInput): TokenScale {
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !validateHex(value)) {
      throw new Error(`Invalid hex color for "${key}": "${value}". Expected e.g. "#3b82f6".`);
    }
  }
  return {
    colors: {
      primary: { value: input.primary },
      secondary: { value: input.secondary },
      ...(input.accent ? { accent: { value: input.accent } } : {}),
      ...(input.background ? { background: { value: input.background } } : {}),
    },
  };
}

export type ThemeFormat = 'css-vars' | 'panda-json';

export function detectThemeFormat(pasted: string): ThemeFormat | null {
  const trimmed = pasted.trim();
  if (trimmed.includes(':root') && trimmed.includes('--')) {
    return 'css-vars';
  }
  if (trimmed.startsWith('{')) {
    return 'panda-json';
  }
  return null;
}

// Every extracted value ends up interpolated as a string literal into
// generated TypeScript source (tokenScaleToPandaConfigSnippet) — validating
// as hex-only here, same as interactive mode, closes off any possibility of
// pasted content breaking out of that string literal and injecting code into
// the generated project.
function requireHex(name: string, value: string): string {
  if (!validateHex(value)) {
    throw new Error(`Pasted theme value for "${name}" is not a valid hex color: "${value}". Expected e.g. "#3b82f6".`);
  }
  return value;
}

function normalizeCssVars(pasted: string): TokenScale {
  // Bounded, non-backtracking — the prior /--([\w-]+)\s*:\s*([^;]+);/g pattern
  // hung 24s+ on ~80KB of adversarial pasted input (quadratic backtracking
  // between the \s* runs and the value class). Bounding the name/value
  // lengths (not line-anchoring — declarations are commonly all on one line,
  // e.g. `:root{--primary: #fff; --secondary: #000;}`) removes the blowup.
  const declarations = [...pasted.matchAll(/--([A-Za-z0-9_-]{1,64})[^\S\n]*:([^;\n]{0,256});/g)];
  const map: Record<string, string> = {};
  for (const [, name, value] of declarations) {
    map[name!.toLowerCase()] = value!.trim();
  }

  const primary = map['primary'] ?? map['color-primary'];
  const secondary = map['secondary'] ?? map['color-secondary'];
  if (!primary || !secondary) {
    throw new Error('Pasted CSS vars must define at least --primary and --secondary.');
  }

  const { accent } = map;
  const { background } = map;

  return {
    colors: {
      primary: { value: requireHex('primary', primary) },
      secondary: { value: requireHex('secondary', secondary) },
      ...(accent ? { accent: { value: requireHex('accent', accent) } } : {}),
      ...(background ? { background: { value: requireHex('background', background) } } : {}),
    },
  };
}

function extractTokenValue(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    return entry;
  }
  if (
    entry &&
    typeof entry === 'object' &&
    'value' in entry &&
    typeof (entry as { value: unknown }).value === 'string'
  ) {
    return (entry as { value: string }).value;
  }
  return undefined;
}

function normalizePandaJson(pasted: string): TokenScale {
  let parsed: { colors?: Record<string, unknown> } & Record<string, unknown>;
  try {
    parsed = JSON.parse(pasted);
  } catch {
    throw new Error('Pasted Panda token JSON is not valid JSON. Check for a missing/extra comma, quote, or brace.');
  }
  const colors = parsed.colors ?? parsed;

  const primary = extractTokenValue(colors.primary);
  const secondary = extractTokenValue(colors.secondary);
  if (!primary || !secondary) {
    throw new Error('Pasted Panda token JSON must define at least colors.primary and colors.secondary.');
  }

  const accent = extractTokenValue(colors.accent);
  const background = extractTokenValue(colors.background);

  return {
    colors: {
      primary: { value: requireHex('primary', primary) },
      secondary: { value: requireHex('secondary', secondary) },
      ...(accent ? { accent: { value: requireHex('accent', accent) } } : {}),
      ...(background ? { background: { value: requireHex('background', background) } } : {}),
    },
  };
}

export function normalizePastedTheme(pasted: string): TokenScale {
  if (pasted.length > MAX_THEME_BYTES) {
    throw new Error(`Pasted theme content is too large (${pasted.length} bytes, max ${MAX_THEME_BYTES}).`);
  }
  const format = detectThemeFormat(pasted);
  if (format === 'css-vars') {
    return normalizeCssVars(pasted);
  }
  if (format === 'panda-json') {
    return normalizePandaJson(pasted);
  }
  throw new Error(
    'Could not detect pasted theme format. Expected either a CSS vars block (":root{--primary: ...}") or a Panda token JSON object.',
  );
}

export function tokenScaleToPandaConfigSnippet(tokens: TokenScale): string {
  const lines = Object.entries(tokens.colors).map(([name, entry]) => `        ${name}: { value: '${entry?.value}' },`);
  return `theme: {\n    tokens: {\n      colors: {\n${lines.join('\n')}\n      },\n    },\n  },`;
}
