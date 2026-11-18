import { os } from "@orpc/server";
import type { afterResponse } from "./after-response";
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

export const afterResponseCallbacks = {
  viewer: () => {
    process.stdout.write("Finished sending GET /api/viewer\n");
  },
} satisfies Partial<
  Record<keyof typeof api, Parameters<typeof afterResponse>[1]>
>;
