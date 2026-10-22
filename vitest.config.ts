import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps,examples}/*/test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    restoreMocks: true,
  },
});
