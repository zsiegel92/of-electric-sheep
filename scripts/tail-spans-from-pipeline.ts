import { getPipelineSpans } from "../src/lib/langfuse/queries";

const pipelineId = process.argv[2];
if (!pipelineId)
  throw new Error(
    "Usage: pnpm run script scripts/tail-spans-from-pipeline.ts <pipeline-id>",
  );

// Last 10 observations from the past week, newest first.
console.log(JSON.stringify(await getPipelineSpans(pipelineId), null, 2));
