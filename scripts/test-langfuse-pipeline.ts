// Live Langfuse check: recover the full synthetic request, response, and image bytes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { getPipelineSpans } from "../src/lib/langfuse/queries";
import { langfuseConfig } from "../src/lib/langfuse/schemas";
import { traceGeneration } from "../src/lib/langfuse/tracing";
import {
  getSystemOneCoreIngredients,
  toSystemOneTraceInput,
  upload,
} from "../src/lib/system-one/type-helpers";
import {
  systemOneRequest,
  systemOneResponse,
} from "../src/lib/system-one/typesafe-api-schemas";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW1sAAAAASUVORK5CYII=";
const bytes = Buffer.from(png, "base64");
const request = systemOneRequest.parse({
  model: "pipeline-test-model",
  state: { description: "Full decision context <photo> ".repeat(1000) },
  questions: {
    matches: {
      type: "noul",
      instructions: "Does <photo> match the description?",
      criteria: { true: "Matches", false: "Does not match" },
    },
  },
  assets: { photo: { type: "image", format: "png", data_base64: png } },
});
const output = systemOneResponse.parse({
  model: "pipeline-test-model",
  answers: { matches: { type: "noul", noul: 0.75 } },
  usage: { input_tokens: 8, output_tokens: 1 },
});
const input = await toSystemOneTraceInput(
  await getSystemOneCoreIngredients(request, { enableImages: true }),
);
// Multipart uploads must record the same bytes, even without a MIME type.
const multipart = upload.parse({
  request: JSON.stringify({
    ...request,
    assets: { photo: { type: "image", part: "photo" } },
  }),
  photo: new File([bytes], "photo.bin"),
});
assert.deepEqual(
  await toSystemOneTraceInput(
    await getSystemOneCoreIngredients(multipart, { enableImages: true }),
  ),
  input,
);

const pipelineId = randomUUID();
const from = new Date();
let spanId = "";
await traceGeneration(
  "pipeline-correlation-check",
  { pipelineId },
  async (generation) => {
    assert.ok(
      generation,
      "Configure LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY",
    );
    spanId = generation.id;
    generation.update({
      input,
      model: output.model,
      usageDetails: { input: 8, output: 1 },
    });
    return output;
  },
);
for (let attempt = 0; attempt < 12; attempt++) {
  const span = (await getPipelineSpans(pipelineId, { from })).find(
    (entry) => entry.id === spanId,
  );
  if (span) {
    assert.equal(span.metadata?.["pipelineId"], pipelineId);
    assert.deepEqual(span.output, output);
    const recorded = z
      .looseObject({ assets: z.record(z.string(), z.string()) })
      .parse(span.input);
    const image = recorded.assets["photo"];
    assert.ok(image, "Expected the complete image asset");
    assert.deepEqual(recorded, { ...input, assets: { photo: image } });
    // Langfuse extracts the data URI into a media reference. Verify the original bytes are recoverable.
    if (image !== `data:image/png;base64,${png}`) {
      const mediaId = /\|id=([^|]+)\|/.exec(image)?.[1];
      assert.ok(mediaId, "Expected a Langfuse media reference");
      const config = langfuseConfig.parse({
        baseUrl:
          process.env["LANGFUSE_BASE_URL"] || "https://cloud.langfuse.com",
        publicKey: process.env["LANGFUSE_PUBLIC_KEY"],
        secretKey: process.env["LANGFUSE_SECRET_KEY"],
      });
      const mediaResponse = await fetch(
        `${config.baseUrl}/api/public/media/${mediaId}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
      assert.ok(
        mediaResponse.ok,
        `Media lookup failed: ${mediaResponse.status}`,
      );
      const media = z
        .object({ url: z.url() })
        .parse(await mediaResponse.json());
      const download = await fetch(media.url, {
        signal: AbortSignal.timeout(20_000),
      });
      assert.ok(download.ok, `Media download failed: ${download.status}`);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    }
    assert.equal((await getPipelineSpans(randomUUID(), { from })).length, 0);
    console.log(
      JSON.stringify(
        {
          pipelineId,
          spanId,
          traceId: span.traceId,
          fullInputOutputVerified: true,
          imageBytesVerified: true,
        },
        null,
        2,
      ),
    );
    break;
  }
  assert.ok(attempt < 11, "Synthetic span was not queryable within 60 seconds");
  await setTimeout(5000);
}
