import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests spawn real, heavy npm/NX/shadcn subprocesses. Running
    // test files in parallel (Vitest's default) makes them contend for CPU
    // and network simultaneously, which was causing genuine multi-minute
    // slowdowns and spurious MCP request timeouts — not flakiness in the
    // tools themselves. Run files sequentially instead.
    fileParallelism: false,
  },
});
