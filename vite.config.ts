import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: { popup: resolve(import.meta.dirname, "popup.html"), pet: resolve(import.meta.dirname, "pet.html") },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
