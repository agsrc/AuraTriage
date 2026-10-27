import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig(({ mode }) => {
  // Deliberately not `PORT`: many hosts set that for the server they start, and here it would be
  // this dev server's own port. The proxy target has its own name.
  const apiTarget = loadEnv(mode, repoRoot, "").API_PROXY_TARGET ?? "http://127.0.0.1:3001";

  return {
    plugins: [react(), tailwindcss()],
    // Only VITE_-prefixed variables from the root .env reach the browser bundle.
    envDir: repoRoot,
    resolve: {
      alias: {
        // One contract for both sides: the orchestrator's Zod schemas and types.
        "@contracts": path.resolve(repoRoot, "agent-orchestrator/src/contracts.ts"),
      },
    },
    server: {
      port: 5173,
      // No CORS to configure: the browser talks to this origin and Vite forwards /api.
      proxy: { "/api": apiTarget },
    },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["./test/setup.ts"],
      css: false,
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  };
});
