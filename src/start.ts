import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getUser } from "./server/auth";
import { isSystemOneRequest } from "./server/system-one/paths";

const authenticate = createMiddleware().server(
  async ({ request, handlerType, next }) => {
    const url = new URL(request.url);
    const isPublic =
      url.pathname === "/sign-in" ||
      url.pathname === "/api/inngest" ||
      url.pathname.startsWith("/api/auth/");
    const usesApiKey = isSystemOneRequest(url.pathname);
    const user = isPublic || usesApiKey ? null : await getUser(request.headers);
    if (!isPublic && !usesApiKey && !user) {
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
    if (user || usesApiKey)
      result.response.headers.set("Cache-Control", "private, no-store");
    return result;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: ({ request, handlerType }) => {
        const { pathname } = new URL(request.url);
        return (
          handlerType === "serverFn" ||
          (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
            pathname !== "/api/inngest" &&
            !pathname.startsWith("/api/auth/") &&
            !isSystemOneRequest(pathname))
        );
      },
    }),
    authenticate,
  ],
}));
