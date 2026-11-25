import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { apiKeyHeader } from "@/lib/api-keys/schemas";
import { isTypeSafeSdkPath } from "@/lib/system-one/routes";

const decompress = promisify(zstdDecompress);

export async function reshapeTypeSafeApiRequest(
  request: Request,
): Promise<Request | Response> {
  if (!isTypeSafeSdkPath(new URL(request.url).pathname)) return request;

  // Use the URL and request fields so this also accepts Nitro's request wrapper.
  const reshaped = new Request(request.url, request);
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
    return new Request(request.url, {
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
