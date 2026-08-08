export interface AddUiLibraryGeneratorSchema {
  appName?: string;
  library?: 'panda-ark' | 'shadcn-tailwind';
  themingMode: 'interactive' | 'paste';
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  pasted?: string;
}
