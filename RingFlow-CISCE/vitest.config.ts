import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", ".next", "dist"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@event-suite/protocol": path.resolve(__dirname, "src/engine/protocol"),
      "@event-suite/domain": path.resolve(__dirname, "src/engine/domain"),
      "@event-suite/rules-engine": path.resolve(
        __dirname,
        "src/engine/rules-engine"
      ),
      "@event-suite/scoring": path.resolve(__dirname, "src/engine/scoring"),
      "@event-suite/draw-engine": path.resolve(
        __dirname,
        "src/engine/draw-engine"
      ),
    },
  },
});
