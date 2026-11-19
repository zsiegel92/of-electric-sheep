import { ORPCError } from "@orpc/server";
import type {
  BoxCoordinates,
  BoxResponse,
  ChoiceResponse,
  EntryType,
  JsonValue,
  ModelCard,
  NoulResponse,
  Question,
  Questions,
  ScoreCriteria,
  ScoreResponse,
  SystemOneRequest,
  SystemOneResult,
  Usage,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import type { RouteRequestBody } from "@/server/route-group";

const content = z.union([
  z.string(),
  z.record(z.string(), z.json()),
  z.array(z.json()),
]) satisfies z.ZodType<NonNullable<EntryType>>;
const instructions = content
  .nullable()
  .exactOptional()
  .describe("What the model should decide in this question.");
const named = z.string().min(1);
const scoreCriteria = z
  .tuple([content, content], content)
  .check(z.minLength(2), z.maxLength(10, "Provide at most 10 levels"))
  .describe(
    "Ordered rubric levels, starting at zero.",
  ) satisfies z.ZodType<ScoreCriteria>;

const probability = z.number().min(0).max(1);
const probabilities = z
  .record(named, probability)
  .describe("Probabilities keyed by option or rubric level.");
const confidence = probability.describe("Confidence from 0 to 1.");
export const scoreLegend = z
  .record(named, content)
  .describe("Rubric descriptions indexed by level.") satisfies z.ZodType<
  Record<string, JsonValue>
>;

function hasEntries(entries: Record<string, unknown>) {
  return Object.keys(entries).length > 0;
}

export const question = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("noul"),
      instructions,
      criteria: z
        .object({
          true: content.nullable().exactOptional(),
          false: content.nullable().exactOptional(),
        })
        .nullable()
        .exactOptional()
        .describe("What counts as a yes or no answer."),
    })
    .describe("Noul — evaluate a yes/no question or statement."),
  z
    .object({
      type: z.literal("choice"),
      instructions,
      criteria: z
        .record(named, content.nullable())
        .refine(hasEntries, "Provide at least one option")
        .refine(
          (entries) => Object.keys(entries).length <= 255,
          "Provide at most 255 options",
        )
        .describe(
          "Provide 1–255 named options. Use null to rely on the option name alone.",
        ),
    })
    .describe("Choice — select one named option."),
  z
    .object({
      type: z.literal("score"),
      instructions,
      criteria: scoreCriteria,
    })
    .describe("Score — rate content against an ordered rubric."),
  z
    .object({ type: z.literal("box"), instructions })
    .describe("Box — locate a region in an image. Requires the images header."),
]) satisfies z.ZodType<Question>;

const box = z
  .object({
    top: probability,
    bottom: probability,
    left: probability,
    right: probability,
  })
  .describe(
    "Normalized image edges, measured from the top or left.",
  ) satisfies z.ZodType<BoxCoordinates>;

// The SDK's generic score legend expands recursively for untyped JSON criteria.
type TypeSafeAnswer =
  | NoulResponse
  | ChoiceResponse
  | (Omit<ScoreResponse, "legend"> & { legend: Record<string, JsonValue> })
  | BoxResponse;

export const answer = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    noul: probability.describe("Probability of yes or true."),
  }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence,
    probabilities,
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().describe("Probability-weighted expected rubric score."),
    confidence,
    legend: scoreLegend,
    probabilities,
  }),
  z.object({
    type: z.literal("box"),
    box,
    confidence: confidence.nullable(),
  }),
]) satisfies z.ZodType<TypeSafeAnswer>;

const inlineImage = z.object({
  type: z.literal("image"),
  format: z.enum(["png", "jpg", "jpeg"]),
  data_base64: z.base64().describe("Base64-encoded image bytes."),
});

export const systemOneRequest = z.object({
  model: named
    .describe("A model name or alias from the models endpoint.")
    .meta({ examples: ["jev-latest"] }),
  state: content.describe("Content all questions refer to."),
  questions: z
    .record(named, question)
    .refine(hasEntries, "Provide at least one question")
    .describe(
      "At least one question, keyed by name. Answers use the same names.",
    ),
  assets: z
    .record(named, inlineImage)
    .refine(hasEntries, "Provide at least one image asset")
    .describe(
      "If supplied, include at least one inline image, keyed by its placeholder.",
    )
    .optional(),
}) satisfies z.ZodType<Omit<SystemOneRequest, "assets">>;

export const systemOneMultipartRequestSchema = systemOneRequest.extend({
  assets: z
    .record(
      named,
      z.union([
        z.object({
          type: z.literal("image"),
          part: named.describe("Name of the multipart image field."),
        }),
        inlineImage,
      ]),
    )
    .refine(hasEntries, "Provide at least one image asset")
    .describe(
      "If supplied, include at least one inline image or uploaded file reference, keyed by placeholder.",
    )
    .optional(),
});

type TypeSafeDecisionResponse = Omit<SystemOneResult<Questions>, "answers"> & {
  answers: Record<string, TypeSafeAnswer>;
};

const usage = z
  .object({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
  })
  .describe("Input and output token counts.") satisfies z.ZodType<Usage>;

export const systemOneResponse = z.object({
  model: named.describe(
    "The model that answered the request. It may differ from the requested alias.",
  ),
  answers: z
    .record(named, answer)
    .refine(hasEntries, "Expected at least one answer")
    .describe("At least one answer, keyed by the input question names."),
  usage,
}) satisfies z.ZodType<TypeSafeDecisionResponse>;

const modelCard = z.object({
  name: named.describe("Model name or alias accepted by System One."),
  description: z.string(),
  release_date: z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .describe("ISO release date or timestamp."),
}) satisfies z.ZodType<ModelCard>;

export const modelList = z.object({
  models: z.array(modelCard),
}) satisfies z.ZodType<{ models: ModelCard[] }>;

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

export const decisionInputBody = z.union([systemOneRequest, upload]);
export type DecisionInputBody = z.output<typeof decisionInputBody>;

export const decisionInput = z.object({
  headers: headersSchema,
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
