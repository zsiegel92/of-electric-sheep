import type { z } from "zod";
import { apiKeyHeader, apiKeySecret } from "@/server/api-key-schemas";
import { systemOneRoutes } from "./routes";
import { systemOneRequest, systemOneResponse } from "./schemas";

export type SystemOneInput = z.input<typeof systemOneRequest>;

export async function decide(
  input: SystemOneInput,
  { apiKey, baseUrl }: { apiKey: string; baseUrl?: URL | string },
) {
  const { method, path } = systemOneRoutes.decide;
  const endpoint = `/api${path}`;
  const response = await fetch(
    baseUrl ? new URL(endpoint, baseUrl) : endpoint,
    {
      method,
      headers: {
        [apiKeyHeader]: apiKeySecret.parse(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(systemOneRequest.parse(input)),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(65_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `System One returned HTTP ${response.status}: ${await response.text()}`,
    );
  }

  return systemOneResponse.parse(await response.json());
}
