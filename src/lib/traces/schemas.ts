import { z } from "zod";
import { systemOneResponse } from "@/lib/system-one/typesafe-api-schemas";

export const traceId = z.string().regex(/^[a-f0-9]{32}$/);

export const tracedSystemOneResponse = systemOneResponse.extend({
  traceId: traceId.optional().describe("ID of the decision trace."),
});
