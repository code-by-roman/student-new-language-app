import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // dist-app / dist-node hold compiled copies of the tests; only run the sources.
    exclude: ['**/node_modules/**', 'dist-app/**', 'dist-node/**'],
  }
})