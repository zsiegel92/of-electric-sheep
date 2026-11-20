import "@tanstack/react-start/server-only";
import { z } from "zod";
import { langfuseConfig, observationPage } from "./schemas";

// Langfuse v2 returns newest observations first. Keep the time range bounded.
export async function getPipelineSpans(
  pipelineId: string,
  {
    limit = 10,
    from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to = new Date(),
  }: { limit?: number; from?: Date; to?: Date } = {},
) {
  z.uuid().parse(pipelineId);
  z.int().min(1).max(1000).parse(limit);
  const config = langfuseConfig.parse({
    baseUrl: process.env["LANGFUSE_BASE_URL"] || "https://cloud.langfuse.com",
    publicKey: process.env["LANGFUSE_PUBLIC_KEY"],
    secretKey: process.env["LANGFUSE_SECRET_KEY"],
  });
  const url = new URL(
    `${config.baseUrl.replace(/\/$/, "")}/api/public/v2/observations`,
  );
  url.searchParams.set("fromStartTime", from.toISOString());
  url.searchParams.set("toStartTime", to.toISOString());
  url.searchParams.set("fields", "core,basic,metadata,model,usage,io");
  url.searchParams.set(
    "filter",
    JSON.stringify([
      {
        type: "stringObject",
        column: "metadata",
        key: "pipelineId",
        operator: "=",
        value: pipelineId,
      },
    ]),
  );
  const spans: z.output<typeof observationPage>["data"] = [];
  let cursor: string | null | undefined;
  do {
    url.searchParams.set("limit", String(limit - spans.length));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Langfuse query failed (${response.status} ${response.statusText})`,
      );
    const page = observationPage.parse(await response.json());
    spans.push(...page.data);
    cursor = page.meta.cursor;
  } while (cursor && spans.length < limit);
  return spans.slice(0, limit);
}
