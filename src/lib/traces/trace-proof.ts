import "@tanstack/react-start/server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

type TraceReference = { pipelineId: string; traceId: string };

// A pipeline test can prove the trace exists before Langfuse indexes it.
export function signTraceProof({ pipelineId, traceId }: TraceReference) {
  const secret = process.env["AUTH_SECRET"];
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", secret)
    .update(`trace-annotation:${pipelineId}:${traceId}`)
    .digest("hex");
}

export function verifyTraceProof(
  trace: TraceReference,
  serverSignedTraceProof: string,
) {
  if (!/^[a-f0-9]{64}$/.test(serverSignedTraceProof)) return false;
  return timingSafeEqual(
    Buffer.from(serverSignedTraceProof, "hex"),
    Buffer.from(signTraceProof(trace), "hex"),
  );
}
