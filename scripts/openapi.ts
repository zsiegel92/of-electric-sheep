import { generateOpenApi } from "../src/server/api";

process.stdout.write(`${JSON.stringify(await generateOpenApi(), null, 2)}\n`);
