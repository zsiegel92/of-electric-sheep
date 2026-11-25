import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const backendByMode = new Map([
  ["modal-serve", "SHEEP_MODAL_SERVE_URL"],
  ["deployed-backend", "SHEEP_DEPLOYED_BACKEND_URL"],
]);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "SHEEP_");
  const backendVariable = backendByMode.get(mode);
  const target = backendVariable
    ? env[backendVariable]
    : env["SHEEP_BACKEND_URL"] || "http://127.0.0.1:8080";
  if (!target) throw new Error(`Set ${backendVariable} in .env or your shell.`);

  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      tailwindcss(),
      tanstackRouter({ autoCodeSplitting: true }),
      react(),
    ],
    build: { outDir: "build/web" },
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      proxy: {
        "^/api(?:/|$)": {
          target,
          changeOrigin: true,
          headers: { "X-Sheep-Origin": "http://localhost:5173" },
        },
      },
    },
  };
});
