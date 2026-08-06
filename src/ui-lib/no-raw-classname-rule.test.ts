import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { noRawClassname } from './no-raw-classname-rule.js';

describe('no-raw-classname rule', () => {
  it('catches raw string classNames, allows variant/recipe-call classNames', () => {
    const ruleTester = new RuleTester({
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    });

    ruleTester.run('no-raw-classname', noRawClassname, {
      valid: [
        // Recipe function call — the intended pattern.
        { code: `const el = <div className={checkbox({ size: "sm" }).root} />;` },
        // Variant prop on the component itself, no className at all.
        { code: `const el = <Button variant="primary" />;` },
        // Dynamic expression (identifier), not a bare string literal.
        { code: `const el = <div className={computedClass} />;` },
        // Template literal with an interpolated expression.
        { code: 'const el = <div className={`${base} extra`} />;' },
      ],
      invalid: [
        {
          code: `const el = <div className="bg-red-500 p-4" />;`,
          errors: [{ messageId: 'rawClassname' }],
        },
        {
          code: `const el = <div className={"bg-red-500 p-4"} />;`,
          errors: [{ messageId: 'rawClassname' }],
        },
        {
          code: 'const el = <div className={`bg-red-500 p-4`} />;',
          errors: [{ messageId: 'rawClassname' }],
        },
      ],
    });
  });
});
