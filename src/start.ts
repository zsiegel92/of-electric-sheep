import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { isRequestThatRequiresApiKey } from "@/lib/system-one/routes";
import { getUser, type User } from "./lib/auth";

function handlesOwnAuthentication(pathname: string) {
  return pathname === "/api/inngest" || pathname.startsWith("/api/auth/");
}

const authenticate = createMiddleware().server<{ user: User | null }>(
  async ({ request, handlerType, next }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/sign-in" || handlesOwnAuthentication(pathname)) {
      return next({ context: { user: null } });
    }

    const requiresApiKey = isRequestThatRequiresApiKey(pathname);
    const user = requiresApiKey ? null : await getUser(request.headers);
    if (!user && !requiresApiKey) {
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
            !handlesOwnAuthentication(pathname) &&
            !isRequestThatRequiresApiKey(pathname))
        );
      },
    }),
    authenticate,
  ],
}));
