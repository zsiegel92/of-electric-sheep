import "@tanstack/react-start/server-only";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { badRequest, validationError } from "./schemas";

const typesafeEnv = z.object({
  TYPESAFE_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .default("https://api.typesafe.ai"),
  TYPESAFE_API_KEY: z.string().trim().min(1),
});

export const typesafeErrors = {
  BAD_REQUEST: { data: badRequest },
  UNPROCESSABLE_CONTENT: { data: validationError },
  TOO_MANY_REQUESTS: { message: "TypeSafe rate limit reached" },
  BAD_GATEWAY: { message: "TypeSafe returned an unexpected response" },
  SERVICE_UNAVAILABLE: { message: "TypeSafe credentials are not configured" },
};

export async function typesafeRequest<T extends z.ZodType>(
  path: "v1/models" | "v1/systemone",
  schema: T,
  options: RequestInit,
): Promise<z.output<T>> {
  const env = typesafeEnv.safeParse(process.env);
  if (!env.success)
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: typesafeErrors.SERVICE_UNAVAILABLE.message,
    });

  const base = env.data.TYPESAFE_BASE_URL;
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${env.data.TYPESAFE_API_KEY}`);
  headers.set("Accept", "application/json");

  let response: Response;
  let data: unknown;
  try {
    response = await fetch(
      new URL(path, base.endsWith("/") ? base : `${base}/`),
      {
        ...options,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(55_000),
      },
    );
    if (response.status === 429) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: typesafeErrors.TOO_MANY_REQUESTS.message,
      });
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    throw new ORPCError("BAD_GATEWAY", {
      message: typesafeErrors.BAD_GATEWAY.message,
    });
  }

  if (response.status === 400) {
    const result = badRequest.safeParse(data);
    if (result.success)
      throw new ORPCError("BAD_REQUEST", { data: result.data });
  }
  if (response.status === 422) {
    const result = validationError.safeParse(data);
    if (result.success)
      throw new ORPCError("UNPROCESSABLE_CONTENT", { data: result.data });
  }
  if (response.ok) {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
  }
  throw new ORPCError("BAD_GATEWAY", {
    message: typesafeErrors.BAD_GATEWAY.message,
  });
}
