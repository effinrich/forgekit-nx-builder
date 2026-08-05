export const USER_SCHEMA_SOURCE = `import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;
`;
