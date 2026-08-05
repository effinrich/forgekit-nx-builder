export interface TokenScale {
  colors: {
    primary: { value: string };
    secondary?: { value: string };
    accent?: { value: string };
    background?: { value: string };
  };
}

const HEX_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

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

function normalizeCssVars(pasted: string): TokenScale {
  const declarations = [...pasted.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)];
  const map: Record<string, string> = {};
  for (const [, name, value] of declarations) {
    map[name!.toLowerCase()] = value!.trim();
  }

  const primary = map['primary'] ?? map['color-primary'];
  const secondary = map['secondary'] ?? map['color-secondary'];
  if (!primary || !secondary) {
    throw new Error('Pasted CSS vars must define at least --primary and --secondary.');
  }

  return {
    colors: {
      primary: { value: primary },
      secondary: { value: secondary },
      ...(map['accent'] ? { accent: { value: map['accent'] } } : {}),
      ...(map['background'] ? { background: { value: map['background'] } } : {}),
    },
  };
}

function normalizePandaJson(pasted: string): TokenScale {
  const parsed = JSON.parse(pasted);
  const colors = parsed.colors ?? parsed;

  const extractValue = (entry: unknown): string | undefined => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && 'value' in entry) return (entry as { value: string }).value;
    return undefined;
  };

  const primary = extractValue(colors.primary);
  const secondary = extractValue(colors.secondary);
  if (!primary || !secondary) {
    throw new Error('Pasted Panda token JSON must define at least colors.primary and colors.secondary.');
  }

  const accent = extractValue(colors.accent);
  const background = extractValue(colors.background);

  return {
    colors: {
      primary: { value: primary },
      secondary: { value: secondary },
      ...(accent ? { accent: { value: accent } } : {}),
      ...(background ? { background: { value: background } } : {}),
    },
  };
}

export function normalizePastedTheme(pasted: string): TokenScale {
  const format = detectThemeFormat(pasted);
  if (format === 'css-vars') return normalizeCssVars(pasted);
  if (format === 'panda-json') return normalizePandaJson(pasted);
  throw new Error(
    'Could not detect pasted theme format. Expected either a CSS vars block (":root{--primary: ...}") or a Panda token JSON object.',
  );
}

export function tokenScaleToPandaConfigSnippet(tokens: TokenScale): string {
  const lines = Object.entries(tokens.colors).map(([name, entry]) => `        ${name}: { value: '${entry?.value}' },`);
  return `theme: {\n    tokens: {\n      colors: {\n${lines.join('\n')}\n      },\n    },\n  },`;
}
