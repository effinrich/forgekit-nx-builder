import { describe, expect, test } from 'vitest';
import { detectThemeFormat, normalizePastedTheme, tokensFromHex, validateHex } from './theming.js';

describe('theming', () => {
  test('validates hex colors', () => {
    expect(validateHex('#3b82f6')).toBe(true);
    expect(validateHex('#fff')).toBe(true);
    expect(validateHex('not-a-color')).toBe(false);
    expect(validateHex('')).toBe(false);
  });

  test('interactive mode: hex input produces a valid Panda token scale', () => {
    const tokens = tokensFromHex({ primary: '#3b82f6', secondary: '#f97316' });
    expect(tokens.colors.primary.value).toBe('#3b82f6');
    expect(tokens.colors.secondary?.value).toBe('#f97316');
  });

  test('interactive mode: rejects invalid hex', () => {
    expect(() => tokensFromHex({ primary: 'blue', secondary: '#f97316' })).toThrow();
  });

  test('paste mode: auto-detects CSS vars format', () => {
    expect(detectThemeFormat(':root{--primary: #3b82f6; --secondary: #f97316;}')).toBe('css-vars');
  });

  test('paste mode: auto-detects Panda-token-JSON format', () => {
    expect(detectThemeFormat('{"colors":{"primary":{"value":"#3b82f6"}}}')).toBe('panda-json');
  });

  test('paste mode: CSS vars normalize to the same token shape as hex input', () => {
    const fromCssVars = normalizePastedTheme(':root{\n  --primary: #3b82f6;\n  --secondary: #f97316;\n}');
    expect(fromCssVars).toEqual({
      colors: {
        primary: { value: '#3b82f6' },
        secondary: { value: '#f97316' },
      },
    });
  });

  test('paste mode: Panda token JSON normalizes to the same token shape as CSS vars', () => {
    const fromJson = normalizePastedTheme(
      JSON.stringify({ colors: { primary: { value: '#3b82f6' }, secondary: { value: '#f97316' } } }),
    );
    expect(fromJson).toEqual({
      colors: {
        primary: { value: '#3b82f6' },
        secondary: { value: '#f97316' },
      },
    });
  });

  test('both paste formats normalize to an identical result for equivalent input', () => {
    const cssVarsResult = normalizePastedTheme(':root{--primary: #3b82f6; --secondary: #f97316;}');
    const jsonResult = normalizePastedTheme(
      JSON.stringify({ colors: { primary: { value: '#3b82f6' }, secondary: { value: '#f97316' } } }),
    );
    expect(cssVarsResult).toEqual(jsonResult);
  });

  test('paste mode: unrecognized format throws a clear error', () => {
    expect(() => normalizePastedTheme('not a theme at all')).toThrow(/Could not detect/);
  });

  test('paste mode: malformed JSON throws a clear wizard message, not a raw SyntaxError', () => {
    expect(() => normalizePastedTheme('{not valid json')).toThrow(/not valid JSON/);
  });

  test('paste mode: non-hex values are rejected, closing the code-injection surface into generated panda.config.ts', () => {
    // Every theme value is later interpolated as a JS string literal into
    // generated source — a value like this, left unvalidated, would break
    // out of that literal and inject arbitrary code into the user's project.
    const malicious = ":root{--primary: '; process.exit(1); //; --secondary: #f97316;}";
    expect(() => normalizePastedTheme(malicious)).toThrow(/not a valid hex color/);

    const maliciousJson = JSON.stringify({
      colors: { primary: { value: "'; process.exit(1); //" }, secondary: { value: '#f97316' } },
    });
    expect(() => normalizePastedTheme(maliciousJson)).toThrow(/not a valid hex color/);
  });
});
