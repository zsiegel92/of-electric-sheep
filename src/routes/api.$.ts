import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../server/auth";
import { openApi } from "../server/openapi";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => {
        const { response } = await openApi.handle(request, {
          prefix: "/api",
          context: { user: requireUser(context.user) },
        });
        return response ?? new Response("Not found", { status: 404 });
      },
    },
  },
});
