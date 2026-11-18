import { os } from "@orpc/server";
import { type User, userSchema } from "./auth";

const procedure = os.$context<{ user: User }>();

export const api = {
  viewer: procedure
    .route({
      method: "GET",
      path: "/viewer",
      summary: "Get the signed-in GitHub user",
    })
    .output(userSchema)
    .handler(({ context: { user } }) => user),
};
