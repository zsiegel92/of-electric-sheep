import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });
let database: ReturnType<typeof drizzle> | undefined;

export function getDb() {
  const { DATABASE_URL } = process.env;
  database ??= drizzle(postgres(databaseUrl.parse(DATABASE_URL)));
  return database;
}
