import type { FrameworkChoice } from './types.js';

const FRAMEWORK_LABELS: Record<FrameworkChoice, string> = {
  none: 'None (React + Vite)',
  nextjs: 'Next.js',
  tanstack: 'TanStack (Start / Router)',
  expo: 'Expo (React Native)',
};

export function comingSoonMessage(framework: FrameworkChoice): string {
  return `${FRAMEWORK_LABELS[framework]} support is coming in v2 — the MVP wizard currently scaffolds "None (React + Vite)" only. Re-run with framework: "none" to scaffold now.`;
}
