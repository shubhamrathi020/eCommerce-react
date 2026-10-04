import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.spec.{ts,tsx}'], setupFiles: ['./src/test-setup.ts'], testTimeout: 60_000 },
});
