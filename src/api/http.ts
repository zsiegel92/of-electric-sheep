import { notFound, redirect } from "@tanstack/react-router";
import { z } from "zod";

const errorDetail = z.object({
  detail: z.union([z.string(), z.array(z.object({ msg: z.string() }))]),
});

export async function readApi<T>(
  request: Promise<{
    data: T | undefined;
    response?: Response;
    error: unknown;
  }>,
): Promise<T> {
  const { data, response, error } = await request;
  if (!response)
    throw new Error("Could not reach the backend.", { cause: error });
  if (response.ok && data !== undefined) return data;
  if (response.status === 401) throw redirect({ to: "/sign-in" });
  if (response.status === 404) throw notFound();
  const detail = errorDetail.safeParse(error).data?.detail;
  throw new Error(
    typeof detail === "string"
      ? detail
      : (detail?.[0]?.msg ?? `Request failed (HTTP ${response.status}).`),
  );
}
