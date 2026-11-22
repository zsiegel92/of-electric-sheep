import type {
  OpenAPIGeneratorGenerateOptions,
  SchemaConverter,
} from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import type { AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import { apiKeyHeader } from "@/lib/api-keys/schemas";
import { reshapeTypeSafeApiRequest } from "@/lib/typesafe-api/reshape-request";
import type { User } from "../lib/auth";
import { systemOneMultipartRequestSchema } from "../lib/system-one/type-helpers";
import {
  answer,
  modelList,
  question,
  systemOneRequest,
  tracedSystemOneResponse,
} from "../lib/system-one/typesafe-api-schemas";
import { apiKeysTag, keyManagementRouter } from "../server/api-keys";
import { systemOneRouter, systemOneTag } from "../server/system-one/router";

export const apiRouters = {
  systemOne: systemOneRouter,
  apiKeys: keyManagementRouter,
} satisfies AnyRouter;

const schemaConverters = [new ZodToJsonSchemaConverter()];
type JsonSchema = Awaited<ReturnType<SchemaConverter["convert"]>>[1];

const specOptions = {
  info: { title: "Of Electric Sheep", version: "1.0.0" },
  servers: [{ url: "/api" }],
  components: {
    schemas: {
      SystemOneUpload: {
        type: "object",
        required: ["request"],
        properties: {
          request: {
            // oRPC's OpenAPI type omits the JSON Schema contentSchema keyword.
            ...({
              type: "string",
              contentMediaType: "application/json",
              contentSchema: {
                $ref: "#/components/schemas/SystemOneMultipartRequest",
              },
            } as const satisfies JsonSchema),
          },
        },
        additionalProperties: { type: "string", format: "binary" },
      },
    },
    securitySchemes: {
      ApiKey: { type: "apiKey", in: "header", name: apiKeyHeader },
    },
  },
  commonSchemas: {
    SystemOneRequest: { schema: systemOneRequest, strategy: "input" },
    SystemOneMultipartRequest: {
      schema: systemOneMultipartRequestSchema,
      strategy: "input",
    },
    SystemOneResponse: { schema: tracedSystemOneResponse, strategy: "output" },
    SystemOneQuestion: { schema: question, strategy: "input" },
    SystemOneAnswer: { schema: answer, strategy: "output" },
    TypeSafeModelList: { schema: modelList, strategy: "output" },
  },
  tags: [
    {
      name: systemOneTag,
      description:
        "Run live TypeSafe decisions with an OfElectricSheep API key.",
    },
    {
      name: apiKeysTag,
      description: "Create and manage keys using your signed-in session.",
    },
  ],
} satisfies OpenAPIGeneratorGenerateOptions;

const swaggerAssets = "https://unpkg.com/swagger-ui-dist@5.35.0";

type OpenApiContext = {
  user: User | null;
  headers: Headers;
};

const apiHandler = new OpenAPIHandler<OpenApiContext>(apiRouters, {
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
        const reshaped = await reshapeTypeSafeApiRequest(request);
        if (reshaped instanceof Response) return reshaped;

        const { response } = await apiHandler.handle(reshaped, {
          prefix: "/api",
          context: {
            user: context.user,
            headers: reshaped.headers,
          },
        });

        return response ?? new Response("Not found", { status: 404 });
      },
    },
  },
});
