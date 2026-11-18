import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { api } from "./api";
import type { User } from "./auth";

const schemaConverters = [new ZodToJsonSchemaConverter()];
const swaggerAssets = "https://unpkg.com/swagger-ui-dist@5.35.0";
const specOptions = {
  info: { title: "Of Electric Sheep", version: "1.0.0" },
  servers: [{ url: "/api" }],
};

type OpenApiContext = {
  user: User;
  onProcedureSuccess: (name: string) => void;
};

export const openApi = new OpenAPIHandler<OpenApiContext>(api, {
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

export function generateOpenApi() {
  return new OpenAPIGenerator({ schemaConverters }).generate(api, specOptions);
}
