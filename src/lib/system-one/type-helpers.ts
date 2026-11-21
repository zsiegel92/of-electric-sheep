import { ORPCError } from "@orpc/server";
import { Image, type SystemOneRequest } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { RouteRequestBody } from "@/server/route-group";
import { inlineImage, systemOneRequest } from "./typesafe-api-schemas";

const assetName = z.string().min(1);

export const systemOneMultipartRequestSchema = systemOneRequest.extend({
  assets: z
    .record(
      assetName,
      z.union([
        z.object({
          type: z.literal("image"),
          part: assetName.describe("Name of the multipart image field."),
        }),
        inlineImage,
      ]),
    )
    .refine(
      (assets) => Object.keys(assets).length > 0,
      "Provide at least one image asset",
    )
    .describe(
      "If supplied, include at least one inline image or uploaded file reference, keyed by placeholder.",
    )
    .optional(),
});

export const badRequest = z.object({
  detail: z.union([z.string(), z.record(z.string(), z.unknown())]),
});
export const validationError = z.object({
  detail: z.array(
    z.object({
      loc: z.array(z.union([z.string(), z.int()])),
      msg: z.string(),
      type: z.string(),
      input: z.unknown().optional(),
      ctx: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export const typesafeErrors = {
  BAD_REQUEST: { data: badRequest },
  UNPROCESSABLE_CONTENT: { data: validationError },
  TOO_MANY_REQUESTS: { message: "TypeSafe rate limit reached" },
  BAD_GATEWAY: { message: "TypeSafe returned an unexpected response" },
  SERVICE_UNAVAILABLE: { message: "TypeSafe credentials are not configured" },
};

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

const requestPart = z.union([z.string(), z.file()]);
export const upload = z.object({ request: requestPart }).catchall(z.file());

export async function parseSystemOneMultipartRequest(
  input: z.output<typeof upload>,
) {
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
  const result = systemOneMultipartRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ORPCError("BAD_REQUEST", {
      data: {
        detail: "The request part must match the System One request schema.",
      },
    });
  }

  const { assets = {}, ...payload } = result.data;
  const parts = new Map(Object.entries(files));
  const resolvedAssets = Object.fromEntries(
    Object.entries(assets).map<[string, File | z.output<typeof inlineImage>]>(
      ([name, asset]) => {
        if (!("part" in asset)) return [name, asset];
        const file = parts.get(asset.part);
        if (!file) {
          throw new ORPCError("BAD_REQUEST", {
            data: {
              detail:
                "Each image asset part must reference a unique uploaded file.",
            },
          });
        }
        parts.delete(asset.part);
        return [name, file];
      },
    ),
  );
  if (parts.size > 0) {
    throw new ORPCError("BAD_REQUEST", {
      data: {
        detail: "Every uploaded file must be referenced by an image asset.",
      },
    });
  }

  return { ...payload, assets: resolvedAssets };
}

export const imagesHeader = "typesafe-danger-zone-images";
export const longContextHeader = "typesafe-danger-zone-long-context";
export const exactPipelineHeader = "x-use-exact-pipeline";
export const pipelineRoutingHeaders = z.object({
  [exactPipelineHeader]: z
    .literal("true")
    .exactOptional()
    .describe("Use the requested pipeline instead of its primary version."),
});
const headersSchema = z.object({
  [imagesHeader]: z
    .literal("true")
    .exactOptional()
    .describe("Enable image assets and box questions."),
  [longContextHeader]: z
    .literal("true")
    .exactOptional()
    .describe("Enable long context."),
});

export const decisionOptionsSchema = z.object({ headers: headersSchema });
export type DecisionOptions = z.output<typeof decisionOptionsSchema>;

export const decisionInputBody = z.union([systemOneRequest, upload]);
export type DecisionInputBody = z.output<typeof decisionInputBody>;

export type DecisionCapabilities = {
  enableImages?: boolean;
  enableLongContext?: boolean;
};

type ParsedDecisionRequest = Awaited<
  ReturnType<typeof parseSystemOneMultipartRequest>
>;
type DecisionQuestion = ParsedDecisionRequest["questions"][string];
export type SystemOneCoreIngredients = Omit<ParsedDecisionRequest, "assets"> & {
  assets: ParsedDecisionRequest["assets"] | undefined;
  options: DecisionOptions;
  questionParts: Record<
    string,
    {
      type: DecisionQuestion["type"];
      systemPrompt: DecisionQuestion["instructions"];
      choices: Exclude<DecisionQuestion, { type: "box" }>["criteria"];
    }
  >;
};

export async function getSystemOneCoreIngredients(
  input: DecisionInputBody,
  {
    enableImages = false,
    enableLongContext = false,
  }: DecisionCapabilities = {},
): Promise<SystemOneCoreIngredients> {
  const headers: DecisionOptions["headers"] = {};
  if (enableImages) headers[imagesHeader] = "true";
  if (enableLongContext) headers[longContextHeader] = "true";

  const { model, state, questions, assets, ...request } =
    "request" in input ? await parseSystemOneMultipartRequest(input) : input;
  const options: DecisionOptions = { headers };
  const questionParts = Object.fromEntries(
    Object.entries(questions).map(([name, question]) => {
      const { type, instructions: systemPrompt } = question;
      const choices = "criteria" in question ? question.criteria : undefined;
      return [name, { type, systemPrompt, choices }];
    }),
  );
  return {
    model,
    state,
    questions,
    questionParts,
    assets,
    options,
    ...request,
  };
}

export function toSystemOneRequest({
  assets,
  options: _options,
  questionParts: _questionParts,
  ...request
}: SystemOneCoreIngredients): SystemOneRequest<
  ParsedDecisionRequest["questions"]
> {
  return {
    ...request,
    ...(assets && {
      assets: Object.fromEntries(
        Object.entries(assets).map(([name, asset]) => [
          name,
          asset instanceof File
            ? new Image(asset)
            : Image.fromBase64(asset.data_base64),
        ]),
      ),
    }),
  };
}

// Data URIs let Langfuse retain image bytes as media attachments instead of File/Image placeholders.
export async function toSystemOneTraceInput({
  assets,
  questionParts: _questionParts,
  ...request
}: SystemOneCoreIngredients) {
  return {
    ...request,
    ...(assets && {
      assets: Object.fromEntries(
        await Promise.all(
          Object.entries(assets).map(async ([name, asset]) => {
            if (!(asset instanceof File)) {
              const mime = asset.format === "png" ? "image/png" : "image/jpeg";
              return [name, `data:${mime};base64,${asset.data_base64}`];
            }
            const bytes = Buffer.from(await asset.arrayBuffer());
            const mime = bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? "image/png"
              : bytes[0] === 0xff && bytes[1] === 0xd8
                ? "image/jpeg"
                : asset.type || "application/octet-stream";
            return [name, `data:${mime};base64,${bytes.toString("base64")}`];
          }),
        ),
      ),
    }),
  };
}

export const decisionInput = z.object({
  headers: headersSchema.extend(pipelineRoutingHeaders.shape),
  body: decisionInputBody,
});

export const decisionRequestBody = {
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
} satisfies RouteRequestBody;
