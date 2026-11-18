import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro({ vercel: { functions: { runtime: "nodejs24.x" } } }),
    react(),
  ],
  server: { host: "localhost", port: 5173, strictPort: true },
});
