import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./build/openapi.json",
  output: {
    path: "src/generated",
    entryFile: false,
    // The bundled fetch runtime does not support exactOptionalPropertyTypes.
    // Application code still checks against the generated signatures.
    header: ({ defaultValue }) => ["// @ts-nocheck", ...defaultValue],
  },
  plugins: ["@hey-api/client-fetch", "@hey-api/sdk"],
});
