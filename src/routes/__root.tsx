import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Navbar } from "../components/navbar";
import { getViewer } from "../server/functions";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  loader: ({ location }) =>
    location.pathname === "/sign-in" ? null : getViewer(),
  head: () => ({
    links: [{ rel: "stylesheet", href: styles }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Of Electric Sheep" },
    ],
  }),
  shellComponent: Document,
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Navbar />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
