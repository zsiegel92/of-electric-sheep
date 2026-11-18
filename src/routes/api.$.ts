import { createFileRoute } from "@tanstack/react-router";
import { afterResponse } from "../server/after-response";
import type { api } from "../server/api";
import { requireUser } from "../server/auth";
import { openApi } from "../server/openapi";

const afterResponseCallbacks = {
  viewer: () => {
    process.stdout.write("Finished sending GET /api/viewer\n");
  },
} satisfies Partial<
  Record<keyof typeof api, Parameters<typeof afterResponse>[1]>
>;

const callbacksByProcedure = new Map(Object.entries(afterResponseCallbacks));

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => {
        const matched: { procedure?: string } = {};
        const { response } = await openApi.handle(request, {
          prefix: "/api",
          context: {
            user: requireUser(context.user),
            onProcedureSuccess: (name) => {
              matched.procedure = name;
            },
          },
        });

        const callback = callbacksByProcedure.get(matched.procedure ?? "");
        if (response?.ok && callback) afterResponse(request, callback);

        return response ?? new Response("Not found", { status: 404 });
      },
    },
  },
});
