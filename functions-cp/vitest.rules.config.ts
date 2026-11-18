import { defineConfig } from 'vitest/config';

// asia-main Rules 測試（模擬器）。由 `npm run test:rules` 經 firebase emulators:exec 啟動。
export default defineConfig({
  test: {
    include: ['test-rules/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000
  }
});
