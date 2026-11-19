import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Navbar } from "../components/navbar";
import { getCurrentUser } from "../server/functions";
import styles from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: ({ location }) =>
      location.pathname === "/sign-in" ? null : getCurrentUser(),
    head: () => ({
      links: [{ rel: "stylesheet", href: styles }],
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Of Electric Sheep" },
      ],
    }),
    shellComponent: Document,
  },
);

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Navbar />
        <div className="px-6 sm:px-10 lg:px-16">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
