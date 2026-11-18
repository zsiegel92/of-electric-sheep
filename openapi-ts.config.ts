import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./build/openapi.json",
  output: { path: "web/src/generated", indexFile: false },
  plugins: [
    "@hey-api/client-fetch",
    { name: "@hey-api/sdk", validator: "zod" },
    {
      name: "zod",
      definitions: { types: { infer: { case: "PascalCase" } } },
      requests: { types: { infer: { case: "PascalCase" } } },
      responses: { types: { infer: { case: "PascalCase" } } },
    },
    {
      name: "@tanstack/react-query",
      comments: false,
      useQuery: true,
      useMutation: true,
    },
  ],
});
