import {
  OpenAPIGenerator,
  type OpenAPIGeneratorGenerateOptions,
} from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { type AnyProcedure, os } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { afterResponse } from "./after-response";
import { apiKeyHeader, apiKeysTag, keyManagement, saveUser } from "./api-keys";
import { requireUser, type User, userSchema } from "./auth";
import { systemOne, systemOneTag } from "./system-one/router";
import {
  answer,
  modelList,
  multipartRequest,
  question,
  systemOneRequest,
  systemOneResponse,
} from "./system-one/schemas";

const procedure = os.$context<{ user: User | null }>();

export const api = {
  systemOne,
  apiKeys: keyManagement,
  viewer: procedure
    .route({
      method: "GET",
      path: "/viewer",
      tags: ["Account"],
      summary: "Get the signed-in GitHub user",
    })
    .output(userSchema)
    .handler(async ({ context }) => {
      const user = requireUser(context.user);
      await saveUser(user);
      return user;
    }),
};

type ProcedureNames<Router> = {
  [Key in keyof Router & string]: Router[Key] extends AnyProcedure
    ? Key
    : Router[Key] extends object
      ? `${Key}.${ProcedureNames<Router[Key]>}`
      : never;
}[keyof Router & string];

export const afterResponseCallbacks = {
  viewer: () => {
    process.stdout.write("Finished sending GET /api/viewer\n");
  },
} satisfies Partial<
  Record<ProcedureNames<typeof api>, Parameters<typeof afterResponse>[1]>
>;

const schemaConverters = [new ZodToJsonSchemaConverter()];
const swaggerAssets = "https://unpkg.com/swagger-ui-dist@5.35.0";
const specOptions = {
  info: { title: "Of Electric Sheep", version: "1.0.0" },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      ApiKey: { type: "apiKey", in: "header", name: apiKeyHeader },
    },
  },
  commonSchemas: {
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
    { name: "Account", description: "Information about the signed-in user." },
  ],
} satisfies OpenAPIGeneratorGenerateOptions;

type OpenApiContext = {
  user: User | null;
  headers: Headers;
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
