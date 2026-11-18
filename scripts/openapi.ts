import { generateOpenApi } from "../src/server/openapi";

process.stdout.write(`${JSON.stringify(await generateOpenApi(), null, 2)}\n`);
