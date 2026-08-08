import type { Rule } from 'eslint';

// eslint's own types don't cover JSX AST nodes (they're a TSX/JSX-parser
// extension, not part of base ESTree) — this captures only the shape this
// rule actually inspects, narrower and dependency-free vs pulling in
// @typescript-eslint/utils just for JSXAttribute/JSXExpressionContainer types.
interface JsxAttributeNode {
  name?: { type: string; name?: string };
  value?: {
    type: string;
    value?: unknown;
    expression?: { type: string; value?: unknown; expressions?: unknown[] };
  } | null;
}

/**
 * Forbids raw string-literal `className` values (the Tailwind/shadcn "utility
 * soup" pattern). Customization must flow through a component's variant
 * props or a recipe function call (cva/sva-style) instead — any expression
 * that isn't a bare string literal is allowed.
 *
 * ESLint-plugin-API shaped so it works natively on the ESLint+Prettier path
 * and loads under Oxlint's JS-plugin compatibility layer for the Oxlint
 * default path (confirmed compatible with ESLint v9+ rule modules).
 */
export const noRawClassname: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw string-literal className values; use component variants or a recipe function instead.',
    },
    schema: [],
    messages: {
      rawClassname:
        "Raw className string literals are forbidden here. Use the component's variant props, or a recipe function call (e.g. cva/sva output), instead of inline utility classes.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node: JsxAttributeNode) {
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'className') {
          return;
        }
        const { value } = node;
        if (!value) {
          return;
        }
        const isBareStringLiteral =
          (value.type === 'Literal' && typeof value.value === 'string') ||
          (value.type === 'JSXExpressionContainer' &&
            value.expression?.type === 'Literal' &&
            typeof value.expression.value === 'string') ||
          (value.type === 'JSXExpressionContainer' &&
            value.expression?.type === 'TemplateLiteral' &&
            value.expression.expressions?.length === 0);

        if (isBareStringLiteral) {
          context.report({ node: node as unknown as Rule.Node, messageId: 'rawClassname' });
        }
      },
    };
  },
};
