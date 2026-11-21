import { createHash } from "node:crypto";
import { canonicalize } from "./pipeline-draft";
import type { PipelineDefinition } from "./pipeline-schemas";

export function hashPipelineDefinition(
  definition: PipelineDefinition,
  baseUrl?: string | null,
): string {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(canonicalize({ version: 1, definition })))
    .digest("hex");
  // Incoming requests only supply a definition. An upstream-specific version
  // is reached by its ID or through the original pipeline's primary pointer.
  return baseUrl
    ? createHash("sha256").update(`${requestHash}:${baseUrl}`).digest("hex")
    : requestHash;
}
