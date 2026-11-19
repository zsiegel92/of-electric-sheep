import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { createFileRoute } from "@tanstack/react-router";
import { afterResponse } from "../server/after-response";
import {
  afterResponseCallbacks,
  api,
  schemaConverters,
  specOptions,
} from "../server/api";

import type { User } from "../server/auth";

const swaggerAssets = "https://unpkg.com/swagger-ui-dist@5.35.0";

type OpenApiContext = {
  user: User | null;
  headers: Headers;
  onProcedureSuccess: (name: string) => void;
};

const apiHandler = new OpenAPIHandler<OpenApiContext>(api, {
  clientInterceptors: [
    async ({ context, next, path }) => {
      const output = await next();
      context.onProcedureSuccess(path.join("."));
      return output;
    },
  ],
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

const callbacksByProcedure = new Map(Object.entries(afterResponseCallbacks));

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => {
        const matched: { procedure?: string } = {};
        const { response } = await apiHandler.handle(request, {
          prefix: "/api",
          context: {
            user: context.user,
            headers: request.headers,
            onProcedureSuccess: (name) => {
              matched.procedure = name;
            },
          },
        });

        const callback = callbacksByProcedure.get(matched.procedure ?? "");
        if (response?.ok && callback) afterResponse(request, callback);

        return response ?? new Response("Not found", { status: 404 });
      },
    },
  },
});
