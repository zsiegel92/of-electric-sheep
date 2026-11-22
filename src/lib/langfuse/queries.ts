import "@tanstack/react-start/server-only";
import { z } from "zod";
import { langfuseConfig, observationPage } from "./schemas";

export function getLangfuseConfig() {
  const { LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } =
    process.env;
  if (!LANGFUSE_PUBLIC_KEY?.trim() || !LANGFUSE_SECRET_KEY?.trim()) return;
  return langfuseConfig.parse({
    baseUrl: LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    publicKey: LANGFUSE_PUBLIC_KEY,
    secretKey: LANGFUSE_SECRET_KEY,
  });
}

export async function getObservationPage(
  config: z.output<typeof langfuseConfig>,
  params: {
    from: Date;
    to: Date;
    limit: number;
    cursor?: string | undefined;
  } & (
    | { pipelineId: string; traceId?: never }
    | { traceId: string; pipelineId?: never }
  ),
  name?: string,
) {
  const { from, to, limit, cursor, pipelineId, traceId } = params;
  const url = new URL(
    `${config.baseUrl.replace(/\/$/, "")}/api/public/v2/observations`,
  );
  url.search = new URLSearchParams({
    fromStartTime: from.toISOString(),
    toStartTime: to.toISOString(),
    limit: String(limit),
    fields: "core,basic,metadata,model,usage,io",
    ...(cursor && { cursor }),
    ...(name && { name, type: "GENERATION" }),
    ...(traceId && { traceId }),
    ...(pipelineId && {
      filter: JSON.stringify([
        {
          type: "stringObject",
          column: "metadata",
          key: "pipelineId",
          operator: "=",
          value: pipelineId,
        },
      ]),
    }),
  }).toString();
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
    },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Langfuse query failed (${response.status})`);
  const page = observationPage.safeParse(await response.json());
  if (!page.success)
    throw new Error("Langfuse returned an unexpected response");
  return page.data;
}

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
  const config = getLangfuseConfig();
  if (!config) throw new Error("Langfuse is not configured");
  const spans: z.output<typeof observationPage>["data"] = [];
  let cursor: string | undefined;
  do {
    const page = await getObservationPage(config, {
      pipelineId,
      limit: limit - spans.length,
      from,
      to,
      cursor,
    });
    spans.push(
      ...page.data.filter(
        (span) => span.metadata?.["pipelineId"] === pipelineId,
      ),
    );
    cursor = page.meta.cursor ?? undefined;
  } while (cursor && spans.length < limit);
  return spans.slice(0, limit);
}
