import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";

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
  z.object({ type: z.literal("box"), box, confidence: confidence.nullable() }),
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

export const multipartRequest = systemOneRequest.extend({
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
