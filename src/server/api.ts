import type { OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import type { AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { apiKeyHeader, apiKeysTag, keyManagement } from "./api-keys";
import { systemOne, systemOneTag } from "./system-one/router";
import {
  answer,
  modelList,
  multipartRequest,
  question,
  systemOneRequest,
  systemOneResponse,
  upload,
} from "./system-one/schemas";

export const api = {
  systemOne,
  apiKeys: keyManagement,
} satisfies AnyRouter;

export const schemaConverters = [new ZodToJsonSchemaConverter()];
export const specOptions = {
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
    SystemOneMultipartRequest: { schema: multipartRequest, strategy: "input" },
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
