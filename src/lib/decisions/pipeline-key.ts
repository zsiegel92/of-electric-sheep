import { createHash } from "node:crypto";
import type { PipelineDefinition } from "./pipeline-schemas";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function hashPipelineDefinition(definition: PipelineDefinition): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({ version: 1, definition })))
    .digest("hex");
}
