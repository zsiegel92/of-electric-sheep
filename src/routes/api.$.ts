import type { OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import type { AnyRouter } from "@orpc/server";
import { JSON_SCHEMA_REGISTRY, ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import {
  answer,
  choiceCriteria,
  imagePart,
  modelList,
  question,
  systemOneMultipartRequestSchema,
  systemOneRequest,
  systemOneResponse,
  upload,
} from "../lib/system-one/schemas";
import { apiKeyHeader } from "../server/api-key-schemas";
import { apiKeysTag, keyManagementRouter } from "../server/api-keys";
import type { User } from "../server/auth";
import { systemOneRouter, systemOneTag } from "../server/system-one/router";

export const apiRouters = {
  systemOne: systemOneRouter,
  apiKeys: keyManagementRouter,
} satisfies AnyRouter;

for (const schema of [
  choiceCriteria,
  systemOneRequest.shape.questions,
  systemOneRequest.shape.assets.unwrap(),
  systemOneMultipartRequestSchema.shape.assets.unwrap(),
  systemOneResponse.shape.answers,
]) {
  const { description, minProperties, maxProperties } = schema.meta() ?? {};
  JSON_SCHEMA_REGISTRY.add(schema, {
    ...(description === undefined ? {} : { description }),
    ...(typeof minProperties === "number" ? { minProperties } : {}),
    ...(typeof maxProperties === "number" ? { maxProperties } : {}),
  });
}
JSON_SCHEMA_REGISTRY.add(upload.shape.request, {
  type: "string",
  contentMediaType: "application/json",
  contentSchema: { $ref: "#/components/schemas/SystemOneMultipartRequest" },
});
JSON_SCHEMA_REGISTRY.add(imagePart, { type: "string", format: "binary" });

const schemaConverters = [new ZodToJsonSchemaConverter()];
const specOptions = {
  info: { title: "Of Electric Sheep", version: "1.0.0" },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      ApiKey: { type: "apiKey", in: "header", name: apiKeyHeader },
    },
  },
  commonSchemas: {
    SystemOneUpload: { schema: upload, strategy: "input" },
    SystemOneRequest: { schema: systemOneRequest, strategy: "input" },
    SystemOneMultipartRequest: {
      schema: systemOneMultipartRequestSchema,
      strategy: "input",
    },
    SystemOneResponse: { schema: systemOneResponse, strategy: "output" },
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
