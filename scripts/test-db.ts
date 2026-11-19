import { createDb } from "../src/lib/db/db";

export async function withTestScriptDb<T>(
  run: (db: ReturnType<typeof createDb>) => Promise<T>,
): Promise<T> {
  const databaseUrl = URL.parse(process.env["DATABASE_URL"] ?? "");
  if (
    !databaseUrl ||
    databaseUrl.search ||
    databaseUrl.hostname !== "127.0.0.1" ||
    databaseUrl.port !== "54873" ||
    databaseUrl.pathname !== "/of_electric_sheep"
  ) {
    throw new Error(
      "The smoke-test fixture requires the repo's local Postgres database",
    );
  }

  const db = createDb(databaseUrl.href);
  await using _client = db.$client;
  return await run(db);
}
