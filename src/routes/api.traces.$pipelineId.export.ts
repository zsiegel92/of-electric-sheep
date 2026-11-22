import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { traceQuery } from "@/lib/traces/filters";
import { openPipelineTraceExport } from "@/lib/traces/queries";

export const Route = createFileRoute("/api/traces/$pipelineId/export")({
  server: {
    handlers: {
      GET: async ({ request, context, params }) => {
        if (!context.user)
          return new Response("Sign in required", { status: 401 });
        const pipelineId = z.uuid().safeParse(params.pipelineId.toLowerCase());
        if (!pipelineId.success)
          return new Response("Pipeline not found", { status: 404 });
        const search = new URL(request.url).searchParams;
        const filters = traceQuery.safeParse(Object.fromEntries(search));
        if (!filters.success)
          return new Response("Invalid trace filters", { status: 400 });
        const stream = await openPipelineTraceExport(
          context.user.githubId,
          pipelineId.data,
          filters.data,
          request.signal,
        );
        if (!stream) return new Response("Pipeline not found", { status: 404 });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filters.data.status ?? "all"}-traces-${pipelineId.data}.jsonl"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
