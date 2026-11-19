import { type AnyProcedure, os } from "@orpc/server";
import type { afterResponse } from "./after-response";
import { type User, userSchema } from "./auth";
import { systemOne } from "./system-one/router";

const procedure = os.$context<{ user: User }>();

export const api = {
  systemOne,
  viewer: procedure
    .route({
      method: "GET",
      path: "/viewer",
      tags: ["Account"],
      summary: "Get the signed-in GitHub user",
    })
    .output(userSchema)
    .handler(({ context: { user } }) => user),
};

type ProcedureNames<Router> = {
  [Key in keyof Router & string]: Router[Key] extends AnyProcedure
    ? Key
    : Router[Key] extends object
      ? `${Key}.${ProcedureNames<Router[Key]>}`
      : never;
}[keyof Router & string];

export const afterResponseCallbacks = {
  viewer: () => {
    process.stdout.write("Finished sending GET /api/viewer\n");
  },
} satisfies Partial<
  Record<ProcedureNames<typeof api>, Parameters<typeof afterResponse>[1]>
>;
