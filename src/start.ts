import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getUser } from "./server/auth";

const authenticate = createMiddleware().server(
  async ({ request, handlerType, next }) => {
    const url = new URL(request.url);
    const isPublic =
      url.pathname === "/sign-in" || url.pathname.startsWith("/api/auth/");
    const user = isPublic ? null : await getUser(request.headers);
    if (!isPublic && !user) {
      if (url.pathname.startsWith("/api/") || handlerType === "serverFn") {
        return Response.json(
          { message: "Sign in required" },
          {
            status: 401,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      return new Response(null, {
        status: 303,
        headers: { Location: "/sign-in", "Cache-Control": "no-store" },
      });
    }

    const result = await next({ context: { user } });
    if (user) result.response.headers.set("Cache-Control", "private, no-store");
    return result;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: ({ request, handlerType }) =>
        handlerType === "serverFn" ||
        (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
          !new URL(request.url).pathname.startsWith("/api/auth/")),
    }),
    authenticate,
  ],
}));
