import "@tanstack/react-start/server-only";
import { customOpenAPIOperation, type OpenAPI } from "@orpc/openapi";
import { type AnyProcedure, os } from "@orpc/server";
import { z } from "zod";
import { findApiKeyUser } from "@/lib/api-keys/queries";
import { processDecision, processStoredDecision } from "@/lib/decisions/decide";
import { systemOneRoutes } from "@/lib/system-one/routes";
import { listModels } from "@/lib/system-one/system-one-api-client";
import {
  decisionInput,
  exactPipelineHeader,
  imagesHeader,
  longContextHeader,
  pipelineRoutingHeaders,
  typesafeErrors,
} from "@/lib/system-one/type-helpers";
import {
  modelList,
  systemOneRequest,
} from "@/lib/system-one/typesafe-api-schemas";
import { tracedSystemOneResponse } from "@/lib/traces/schemas";

const state =
  "The parcel arrived two days late, but the customer is satisfied with the replacement.";
const examples = {
  noul: {
    summary: "Yes/no question",
    value: {
      model: "jev-latest",
      state,
      questions: {
        late: { type: "noul", instructions: "Did delivery run late?" },
      },
    },
  },
  choice: {
    summary: "Choose a category",
    value: {
      model: "jev-latest",
      state,
      questions: {
        topic: {
          type: "choice",
          criteria: {
            shipping: "Concerns about delivery",
            product: "Concerns about the item",
          },
        },
      },
    },
  },
  score: {
    summary: "Rate against a rubric",
    value: {
      model: "jev-latest",
      state,
      questions: {
        urgency: {
          type: "score",
          criteria: ["No action", "Review soon", "Immediate attention"],
        },
      },
    },
  },
  box: {
    summary: "Locate an image region (enable the images header)",
    value: {
      model: "jev-preview",
      state: "photo",
      questions: {
        region: {
          type: "box",
          instructions: "Locate the visible foreground region.",
        },
      },
      assets: {
        photo: {
          type: "image",
          format: "png",
          data_base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW1sAAAAASUVORK5CYII=",
        },
      },
    },
  },
} satisfies Record<
  string,
  { summary: string; value: z.input<typeof systemOneRequest> }
>;

const decisionRequestBody = {
  required: true,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/SystemOneRequest" },
      examples,
    },
    "multipart/form-data": {
      schema: { $ref: "#/components/schemas/SystemOneUpload" },
      encoding: { request: { contentType: "application/json" } },
    },
  },
} satisfies OpenAPI.RequestBodyObject;

const sdkSecurity = [{ TypeSafeBearer: [] }, { ApiKey: [] }];

export const systemOneTag = "System One · TypeSafe";

const api = os.$context<{ headers: Headers }>();

const apiKeyProcedure = api
  .errors({
    ...typesafeErrors,
    CONFLICT: { message: "Pipeline versions need compatible question links" },
    NOT_FOUND: { message: "Decision pipeline not found" },
    UNAUTHORIZED: { message: "An active API key is required" },
  })
  .use(
    customOpenAPIOperation(
      async ({ context, errors, next }) => {
        const user = await findApiKeyUser(context.headers);
        if (!user) throw errors.UNAUTHORIZED();
        return next({ context: { user } });
      },
      (operation) => ({
        ...operation,
        security: operation.security ?? [{ ApiKey: [] }],
      }),
    ),
  );

export const systemOneRouter = api.tag(systemOneTag).router({
  models: apiKeyProcedure
    .route({
      ...systemOneRoutes.models,
      summary: "List models",
      description:
        "List Jev models and aliases available to the configured TypeSafe account. TypeSafe SDK clients can use this app's /api URL and an OfElectricSheep API key.",
      spec: (operation) => ({ ...operation, security: sdkSecurity }),
    })
    .output(modelList)
    .handler(listModels),

  decide: apiKeyProcedure
    .route({
      ...systemOneRoutes.decide,
      summary: "Evaluate content with System One",
      description:
        "Ask named yes/no, choice, score, or box questions about shared content. TypeSafe SDK clients can use this app's /api URL and an OfElectricSheep API key. Accepts zstd-compressed request bodies up to 16 MiB after decompression.",
      inputStructure: "detailed",
      spec: (operation) => ({
        ...operation,
        requestBody: decisionRequestBody,
        security: sdkSecurity,
      }),
    })
    .input(decisionInput)
    .output(tracedSystemOneResponse)
    .handler(({ input: { body, headers }, context: { user } }) =>
      processDecision(
        body,
        user,
        {
          enableImages: headers[imagesHeader] === "true",
          enableLongContext: headers[longContextHeader] === "true",
        },
        headers[exactPipelineHeader] === "true",
      ),
    ),

  decideByPipeline: apiKeyProcedure
    .route({
      ...systemOneRoutes.decideByPipeline,
      summary: "Evaluate content using a stored pipeline",
      inputStructure: "detailed",
      description:
        "Run the primary pipeline's stored questions against new state. Requires an API key that owns the pipeline. Replay accepts state without image attachments.",
    })
    .input(
      z.object({
        headers: pipelineRoutingHeaders,
        body: z.object({
          pipelineId: z.uuid(),
          state: systemOneRequest.shape.state,
        }),
      }),
    )
    .output(tracedSystemOneResponse)
    .handler(
      async ({
        input: {
          body: { pipelineId, state },
          headers,
        },
        context: { user },
        errors,
      }) => {
        const result = await processStoredDecision(
          pipelineId,
          state,
          user,
          headers[exactPipelineHeader] === "true",
        );
        if (!result) throw errors.NOT_FOUND();
        return result.decision;
      },
    ),
} satisfies Record<keyof typeof systemOneRoutes, AnyProcedure>);
