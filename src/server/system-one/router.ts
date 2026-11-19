import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import type { User } from "../auth";
import { typesafeErrors, typesafeRequest } from "./client";
import {
  modelList,
  multipartRequest,
  systemOneRequest,
  systemOneResponse,
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

const upload = z
  .object({ request: z.union([z.string(), z.file()]) })
  .catchall(z.file());

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

async function encodeMultipart(
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
  );
  for (const [name, file] of Object.entries(files)) form.set(name, file);
  return form;
}

const procedure = os.$context<{ user: User }>().errors(typesafeErrors);

export const systemOne = {
  models: procedure
    .route({
      method: "GET",
      path: "/system-one/models",
      tags: [systemOneTag],
      summary: "List models",
      description:
        "List Jev models and aliases available to this app’s TypeSafe account.",
    })
    .output(modelList)
    .handler(() => typesafeRequest("v1/models", modelList, { method: "GET" })),

  decide: procedure
    .route({
      method: "POST",
      path: "/system-one",
      tags: [systemOneTag],
      summary: "Evaluate content with System One",
      description:
        "Ask named yes/no, choice, score, or box questions about shared content. Mix question types in one request. The app supplies its TypeSafe credentials.",
      inputStructure: "detailed",
      spec: (operation) => ({
        ...operation,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SystemOneRequest" },
              examples,
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["request"],
                properties: {
                  request: {
                    type: "string",
                    description:
                      "System One request JSON; use asset.part to name an uploaded image.",
                    contentMediaType: "application/json",
                    contentSchema: {
                      $ref: "#/components/schemas/SystemOneMultipartRequest",
                    },
                  },
                },
                additionalProperties: {
                  type: "string",
                  format: "binary",
                  description: "Image file named by the asset's part field.",
                },
              },
              encoding: { request: { contentType: "application/json" } },
            },
          },
        },
      }),
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
      if ("request" in input.body) {
        return typesafeRequest("v1/systemone", systemOneResponse, {
          method: "POST",
          headers,
          body: await encodeMultipart(input.body),
        });
      }
      headers.set("Content-Type", "application/json");
      return typesafeRequest("v1/systemone", systemOneResponse, {
        method: "POST",
        headers,
        body: JSON.stringify(input.body),
      });
    }),
};
