export type UiLibraryChoice = 'panda-ark' | 'shadcn-tailwind';

interface FigmaKitInfo {
  url: string;
  note: string;
}

/**
 * Sourced live (WebFetch/WebSearch against each library's own official docs)
 * during Phase 3 implementation, not guessed. Re-verify periodically —
 * community kits especially can move or be superseded.
 */
const FIGMA_KITS: Record<UiLibraryChoice, FigmaKitInfo | null> = {
  // Ark UI itself is headless and ships no visual design, so it has no Figma
  // kit. The styled reference implementation for this exact stack (Ark UI +
  // Panda CSS) is Park UI, whose official Figma kit docs page is the
  // accurate link to surface here.
  'panda-ark': {
    url: 'https://park-ui.com/docs/overview/figma',
    note: 'Ark UI is headless and has no Figma kit of its own. This links Park UI\'s official Figma kit — Park UI is the styled Ark UI + Panda CSS reference implementation this stack is built on.',
  },
  // shadcn/ui has no single first-party kit; its own docs page curates
  // community-maintained kits. Link the docs page itself (stable), not one
  // specific community file (can be taken down/superseded).
  'shadcn-tailwind': {
    url: 'https://ui.shadcn.com/docs/figma',
    note: 'shadcn/ui has no single official first-party kit — this links shadcn/ui\'s own docs page, which curates community-maintained Figma kits.',
  },
};

export function getFigmaKitInfo(choice: UiLibraryChoice): FigmaKitInfo | null {
  return FIGMA_KITS[choice];
}
