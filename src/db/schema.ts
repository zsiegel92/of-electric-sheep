import { pgTable, text } from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  githubId: text("github_id").primaryKey(),
  displayName: text("display_name").notNull(),
});
