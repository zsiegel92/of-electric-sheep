import { ORPCError } from "@orpc/server";
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import type {
  Experimental_DecisionAnswer,
  Experimental_DecisionQuestion,
} from "ai";
import { z } from "zod";
import type { RouteRequestBody } from "@/server/route-group";

const content = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);
const instructions = content
  .nullish()
  .describe("What the model should decide in this question.");
const named = z.string().min(1);
const probability = z.number().min(0).max(1);
const probabilities = z
  .record(named, probability)
  .describe("Probabilities keyed by option or rubric level.");
const confidence = probability.describe("Confidence from 0 to 1.");
export const scoreLegend = z
  .record(named, content)
  .describe("Rubric descriptions indexed by level.");

function namedEntries<T extends z.ZodType>(
  value: T,
  description: string,
  maxProperties?: number,
) {
  const schema = z.record(named, value).refine(
    (entries) => {
      const size = Object.keys(entries).length;
      return size > 0 && (maxProperties === undefined || size <= maxProperties);
    },
    maxProperties
      ? `Provide 1 to ${maxProperties} entries`
      : "Provide at least one entry",
  );

  JSON_SCHEMA_REGISTRY.add(schema, {
    description,
    minProperties: 1,
    ...(maxProperties === undefined ? {} : { maxProperties }),
  });
  return schema;
}

export const question = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("noul"),
      instructions,
      criteria: z
        .object({ true: content.nullish(), false: content.nullish() })
        .nullish()
        .describe("What counts as a yes or no answer."),
    })
    .describe("Noul — evaluate a yes/no question or statement."),
  z
    .object({
      type: z.literal("choice"),
      instructions,
      criteria: namedEntries(
        content.nullable(),
        "Option names and their descriptions. Use null to rely on the option name alone.",
        255,
      ),
    })
    .describe("Choice — select one named option."),
  z
    .object({
      type: z.literal("score"),
      instructions,
      criteria: z
        .array(content)
        .min(1)
        .max(10)
        .describe("Ordered rubric levels, starting at zero."),
    })
    .describe("Score — rate content against an ordered rubric."),
  z
    .object({ type: z.literal("box"), instructions })
    .describe("Box — locate a region in an image. Requires the images header."),
]);

const box = z
  .object({
    top: probability,
    bottom: probability,
    left: probability,
    right: probability,
  })
  .describe("Normalized image edges, measured from the top or left.");

type SdkAnswer = Experimental_DecisionAnswer<Experimental_DecisionQuestion>;
type SdkAnswerSchema<K extends SdkAnswer["type"]> = z.ZodType<
  Extract<SdkAnswer, { type: K }>
>;

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
  }) satisfies SdkAnswerSchema<"choice">,
  z.object({
    type: z.literal("score"),
    score: z.number().describe("Probability-weighted expected rubric score."),
    confidence,
    legend: scoreLegend,
    probabilities,
  }) satisfies SdkAnswerSchema<"score">,
  z.object({
    type: z.literal("box"),
    box,
    confidence: confidence.nullable(),
  }) satisfies SdkAnswerSchema<"box">,
]);

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
  questions: namedEntries(
    question,
    "Questions keyed by caller-chosen names. Answers use the same names.",
  ),
  assets: namedEntries(
    inlineImage,
    "Inline images keyed by placeholders used in state or questions.",
  ).optional(),
});

export const systemOneMultipartRequestSchema = systemOneRequest.extend({
  assets: namedEntries(
    z.union([
      z.object({
        type: z.literal("image"),
        part: named.describe("Name of the multipart image field."),
      }),
      inlineImage,
    ]),
    "Inline images or references to uploaded image parts, keyed by placeholder.",
  ).optional(),
});

export const systemOneResponse = z.object({
  model: named.describe(
    "The model that answered the request. It may differ from the requested alias.",
  ),
  answers: namedEntries(answer, "Answers keyed by the input question names."),
  usage: z
    .object({
      input_tokens: z.int().nonnegative(),
      output_tokens: z.int().nonnegative(),
    })
    .describe("Input and output token counts."),
});

export const modelList = z.object({
  models: z.array(
    z.object({
      name: named.describe("Model name or alias accepted by System One."),
      description: z.string(),
      release_date: z
        .union([z.iso.date(), z.iso.datetime({ offset: true })])
        .describe("ISO release date or timestamp."),
    }),
  ),
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
const imagePart = z.file();
JSON_SCHEMA_REGISTRY.add(requestPart, {
  type: "string",
  contentMediaType: "application/json",
  contentSchema: { $ref: "#/components/schemas/SystemOneMultipartRequest" },
});
JSON_SCHEMA_REGISTRY.add(imagePart, { type: "string", format: "binary" });
export const upload = z.object({ request: requestPart }).catchall(imagePart);

export async function parseSystemOneMultipartRequest(
  input: z.output<typeof upload>,
): Promise<FormData> {
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
