import { OpenAPIGenerator } from "@orpc/openapi";
import { api, schemaConverters, specOptions } from "../src/server/api";

const spec = await new OpenAPIGenerator({ schemaConverters }).generate(
  api,
  specOptions,
);
process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
