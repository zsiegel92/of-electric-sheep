import { z } from "zod";
import { getDb } from "../src/lib/db/db";
import { getPipelineTracePage } from "../src/lib/traces/queries";

const pipelineId = z.uuid().parse(process.argv[2]);
try {
  console.log(
    JSON.stringify(
      (await getPipelineTracePage(pipelineId, {})).traces,
      null,
      2,
    ),
  );
} finally {
  await getDb().$client.end();
}
