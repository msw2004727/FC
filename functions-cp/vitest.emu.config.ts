import { defineConfig } from 'vitest/config';

// 賽事 Callable 與 e2e（模擬器，asia-main＋(default) 兩庫）。由 `npm run test:emu` 經 firebase emulators:exec 啟動。
export default defineConfig({
  test: {
    include: ['test-emu/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000
  }
});
