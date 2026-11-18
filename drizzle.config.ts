import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const { DATABASE_URL } = process.env;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: DATABASE_URL ?? "" },
});
