import "@tanstack/react-start/server-only";
import type {
  OpenAPIGeneratorGenerateOptions,
  SchemaConverter,
} from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { apiKeyHeader } from "@/lib/api-keys/schemas";
import type { User } from "@/lib/auth";
import { apiBasePath } from "@/lib/system-one/routes";
import { systemOneMultipartRequestSchema } from "@/lib/system-one/type-helpers";
import {
  answer,
  modelList,
  question,
  systemOneRequest,
} from "@/lib/system-one/typesafe-api-schemas";
import { tracedSystemOneResponse } from "@/lib/traces/schemas";
import { apiKeysTag, keyManagementRouter } from "./api-keys";
import { systemOneRouter, systemOneTag } from "./system-one";
import { reshapeTypeSafeApiRequest } from "./typesafe-request";

type JsonSchema = Awaited<ReturnType<SchemaConverter["convert"]>>[1];

const specOptions = {
  info: { title: "Of Electric Sheep", version: "1.0.0" },
  servers: [{ url: apiBasePath }],
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
      TypeSafeBearer: {
        type: "http",
        scheme: "bearer",
        description:
          "Use an API key created in OfElectricSheep as the Bearer token.",
      },
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

const apiHandler = new OpenAPIHandler<OpenApiContext>(
  {
    systemOne: systemOneRouter,
    apiKeys: keyManagementRouter,
  },
  {
    plugins: [
      new OpenAPIReferencePlugin({
        docsProvider: "swagger",
        docsScriptUrl: `${swaggerAssets}/swagger-ui-bundle.js`,
        docsCssUrl: `${swaggerAssets}/swagger-ui.css`,
        docsPath: "/docs",
        specPath: "/openapi.json",
        schemaConverters: [new ZodToJsonSchemaConverter()],
        specGenerateOptions: specOptions,
      }),
    ],
  },
);

export async function handleOpenApiRequest(
  request: Request,
  user: User | null,
) {
  const reshaped = await reshapeTypeSafeApiRequest(request);
  if (reshaped instanceof Response) return reshaped;

  const { response } = await apiHandler.handle(reshaped, {
    prefix: apiBasePath,
    context: { user, headers: reshaped.headers },
  });
  return response ?? new Response("Not found", { status: 404 });
}
