import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getUser, type User } from "./server/auth";
import { isRequestThatRequiresApiKey } from "./server/system-one/routes";

const authenticate = createMiddleware().server<{ user: User | null }>(
  async ({ request, handlerType, next }) => {
    const pathname = new URL(request.url).pathname;
    const isPublic =
      pathname === "/sign-in" ||
      pathname === "/api/inngest" ||
      pathname.startsWith("/api/auth/");
    if (isPublic) return next({ context: { user: null } });

    if (isRequestThatRequiresApiKey(pathname)) {
      const result = await next({ context: { user: null } });
      result.response.headers.set("Cache-Control", "private, no-store");
      return result;
    }

    const user = await getUser(request.headers);
    if (!user) {
      if (pathname.startsWith("/api/") || handlerType === "serverFn") {
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
            !isRequestThatRequiresApiKey(pathname))
        );
      },
    }),
    authenticate,
  ],
}));
