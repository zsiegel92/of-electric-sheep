import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { createFileRoute } from "@tanstack/react-router";
import { api, schemaConverters, specOptions } from "../server/api";
import type { User } from "../server/auth";

const swaggerAssets = "https://unpkg.com/swagger-ui-dist@5.35.0";

type OpenApiContext = {
  user: User | null;
  headers: Headers;
};

const apiHandler = new OpenAPIHandler<OpenApiContext>(api, {
  plugins: [
    new OpenAPIReferencePlugin({
      docsProvider: "swagger",
      docsScriptUrl: `${swaggerAssets}/swagger-ui-bundle.js`,
      docsCssUrl: `${swaggerAssets}/swagger-ui.css`,
      docsPath: "/docs",
      specPath: "/openapi.json",
      schemaConverters,
      specGenerateOptions: specOptions,
    }),
  ],
});

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => {
        const { response } = await apiHandler.handle(request, {
          prefix: "/api",
          context: {
            user: context.user,
            headers: request.headers,
          },
        });

        return response ?? new Response("Not found", { status: 404 });
      },
    },
  },
});
