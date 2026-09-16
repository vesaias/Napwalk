import { defaultExclude, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The unit tests run through the app's own Vite config. The only thing this
// file adds is the e2e package: web/e2e/*.spec.ts are Playwright tests, and
// Vitest's default `include` would otherwise pick them up and fail on the
// first `test()` call. (2026-09-06)
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { exclude: [...defaultExclude, "e2e/**"] },
  }),
);
