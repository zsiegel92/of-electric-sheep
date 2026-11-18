import { os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { profiles } from "../db/schema";
import { type User, userSchema } from "./auth";
import { displayName, maxDisplayNameLength } from "./schemas";

const procedure = os.$context<{ user: User }>();

export const api = {
  viewer: procedure
    .route({
      method: "GET",
      path: "/viewer",
      summary: "Get the signed-in user's profile",
    })
    .output(userSchema.extend(displayName.shape))
    .handler(async ({ context: { user } }) => {
      const [profile] = await getDb()
        .select()
        .from(profiles)
        .where(eq(profiles.githubId, user.githubId));
      const defaultName = user.name.trim().slice(0, maxDisplayNameLength);
      return {
        ...user,
        displayName: profile?.displayName ?? (defaultName || user.githubId),
      };
    }),

  updateProfile: procedure
    .route({
      method: "PATCH",
      path: "/profile",
      summary: "Set your display name",
    })
    .input(displayName)
    .output(displayName)
    .handler(async ({ input, context: { user } }) => {
      await getDb()
        .insert(profiles)
        .values({ githubId: user.githubId, displayName: input.displayName })
        .onConflictDoUpdate({ target: profiles.githubId, set: input });
      return input;
    }),
};
