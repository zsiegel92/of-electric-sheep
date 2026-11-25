import { createFileRoute } from "@tanstack/react-router";
import { handleOpenApiRequest } from "@/server/api/openapi";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request, context }) =>
        handleOpenApiRequest(request, context.user),
    },
  },
});
