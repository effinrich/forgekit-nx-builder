export const FRAMEWORK_CHOICES = ['none', 'nextjs', 'tanstack', 'expo'] as const;
export type FrameworkChoice = (typeof FRAMEWORK_CHOICES)[number];

export const FULLY_SUPPORTED_FRAMEWORKS: readonly FrameworkChoice[] = ['none'];

export interface ProjectBasics {
  projectName: string;
  framework: FrameworkChoice;
}

export function isFrameworkSupported(framework: FrameworkChoice): boolean {
  return FULLY_SUPPORTED_FRAMEWORKS.includes(framework);
}

const PROJECT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validateProjectName(name: string): { valid: true } | { valid: false; reason: string } {
  if (name.trim().length === 0) {
    return { valid: false, reason: 'Project name cannot be empty.' };
  }
  if (!PROJECT_NAME_PATTERN.test(name)) {
    return {
      valid: false,
      reason:
        'Project name must be lowercase alphanumeric with optional hyphens (e.g. "my-app"), no spaces or special characters.',
    };
  }
  return { valid: true };
}
