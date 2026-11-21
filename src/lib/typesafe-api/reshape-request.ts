import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { apiKeyHeader } from "@/lib/api-keys/schemas";
import { typeSafeApiAlias } from "./paths";

const decompress = promisify(zstdDecompress);

export async function reshapeTypeSafeApiRequest(
  request: Request,
): Promise<Request | Response> {
  const url = new URL(request.url);
  const alias = typeSafeApiAlias(url.pathname);
  if (!alias) return request;

  url.pathname = alias;
  const reshaped = new Request(url, request);
  const bearer = reshaped.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/i)?.[1];
  if (bearer && !reshaped.headers.has(apiKeyHeader)) {
    reshaped.headers.set(apiKeyHeader, bearer);
  }
  if (reshaped.headers.get("content-encoding") !== "zstd") return reshaped;

  try {
    // Bound expansion before handing the decoded request to oRPC.
    const body = await decompress(await reshaped.arrayBuffer(), {
      maxOutputLength: 16 * 1024 * 1024,
    });
    reshaped.headers.delete("content-encoding");
    reshaped.headers.delete("content-length");
    return new Request(url, {
      method: reshaped.method,
      headers: reshaped.headers,
      signal: reshaped.signal,
      body: new Uint8Array(body),
    });
  } catch {
    return Response.json(
      { detail: "Invalid or oversized zstd request body." },
      { status: 400 },
    );
  }
}
