import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { getCurrentUser } from "../api/session";
import { Navbar } from "../components/navbar";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    beforeLoad: async ({ location }) => {
      const user = await getCurrentUser();
      if (location.pathname === "/sign-in") {
        if (user) throw redirect({ to: "/" });
      } else if (!user) {
        throw redirect({ to: "/sign-in" });
      }
      return { user };
    },
    loader: ({ context }) => context.user,
    component: Layout,
  },
);

function Layout() {
  return (
    <>
      <Navbar />
      <main className="app-gutters pt-4 pb-8">
        <Outlet />
      </main>
    </>
  );
}
