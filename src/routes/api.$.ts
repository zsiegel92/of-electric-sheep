import { createFileRoute } from "@tanstack/react-router";
import { afterResponse } from "../server/after-response";
import { afterResponseCallbacks } from "../server/api";
import { requireUser } from "../server/auth";
import { openApi } from "../server/openapi";

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
