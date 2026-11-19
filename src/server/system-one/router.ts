import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { findApiKeyUser } from "../api-keys";
import { routeGroup } from "../route-group";
import { typesafeErrors, typesafeRequest } from "./client";
import { systemOneModelsPath, systemOnePath } from "./paths";
import {
  decisionRequestBody,
  modelList,
  multipartRequest,
  systemOneRequest,
  systemOneResponse,
  upload,
} from "./schemas";

export const systemOneTag = "System One · TypeSafe";
const imagesHeader = "typesafe-danger-zone-images";
const longContextHeader = "typesafe-danger-zone-long-context";
const headersSchema = z.object({
  [imagesHeader]: z
    .literal("true")
    .optional()
    .describe("Enable image assets and box questions."),
  [longContextHeader]: z
    .literal("true")
    .optional()
    .describe("Enable long context."),
});

async function parseMultipart(input: z.output<typeof upload>) {
  const { request, ...files } = input;
  const json = typeof request === "string" ? request : await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      data: { detail: "The request part must contain JSON." },
    });
  }
  const result = multipartRequest.safeParse(parsed);
  if (!result.success) {
    throw new ORPCError("BAD_REQUEST", {
      data: {
        detail: "The request part must match the System One request schema.",
      },
    });
  }

  const parts = new Set(Object.keys(files));
  for (const asset of Object.values(result.data.assets ?? {})) {
    if ("part" in asset && !parts.delete(asset.part)) {
      throw new ORPCError("BAD_REQUEST", {
        data: {
          detail:
            "Each image asset part must reference a unique uploaded file.",
        },
      });
    }
  }
  if (parts.size > 0) {
    throw new ORPCError("BAD_REQUEST", {
      data: {
        detail: "Every uploaded file must be referenced by an image asset.",
      },
    });
  }

  const form = new FormData();
  form.set(
    "request",
    new Blob([JSON.stringify(result.data)], { type: "application/json" }),
    "request.json",
  );
  for (const [name, file] of Object.entries(files)) form.set(name, file);
  return form;
}

const apiKeyProcedure = os
  .$context<{ headers: Headers }>()
  .errors({
    ...typesafeErrors,
    UNAUTHORIZED: { message: "An active API key is required" },
  })
  .use(async ({ context, errors, next }) => {
    const user = await findApiKeyUser(context.headers);
    if (!user) throw errors.UNAUTHORIZED();
    return next({ context: { user } });
  });

const route = routeGroup(apiKeyProcedure, {
  tag: systemOneTag,
  security: [{ ApiKey: [] }],
});

export const systemOne = {
  models: route({
    method: "GET",
    path: systemOneModelsPath,
    summary: "List models",
    description:
      "List Jev models and aliases available to the configured TypeSafe account.",
  })
    .output(modelList)
    .handler(() => typesafeRequest("v1/models", modelList, { method: "GET" })),

  decide: route({
    method: "POST",
    path: systemOnePath,
    summary: "Evaluate content with System One",
    description:
      "Ask named yes/no, choice, score, or box questions about shared content. Mix question types in one request. Requires an API key created in OfElectricSheep.",
    inputStructure: "detailed",
    requestBody: decisionRequestBody,
  })
    .input(
      z.object({
        headers: headersSchema,
        body: z.union([systemOneRequest, upload]),
      }),
    )
    .output(systemOneResponse)
    .handler(async ({ input }) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(input.headers)) {
        if (value) headers.set(name, value);
      }
      const body =
        "request" in input.body
          ? await parseMultipart(input.body)
          : JSON.stringify(input.body);
      if (typeof body === "string")
        headers.set("Content-Type", "application/json");
      return typesafeRequest("v1/systemone", systemOneResponse, {
        method: "POST",
        headers,
        body,
      });
    }),
};
