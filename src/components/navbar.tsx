import { Link, useMatch } from "@tanstack/react-router";
import { AuthControl } from "./auth-control";

const navLink =
  "inline-flex h-7 items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-muted data-[status=active]:text-foreground data-[status=active]:inset-ring data-[status=active]:inset-ring-border";

export function Navbar() {
  const user = useMatch({
    from: "__root__",
    select: (match) => match.loaderData,
  });

  return (
    <header className="border-b">
      <nav
        aria-label="Main navigation"
        className="app-gutters flex flex-wrap items-center gap-x-4 gap-y-1 py-1"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="mr-1 rounded-sm text-base font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring"
          >
            OfElectricSheep
          </Link>
          {user && (
            <>
              <Link to="/pipelines" className={navLink}>
                Pipelines
              </Link>
              <Link to="/api-keys" className={navLink}>
                API Keys
              </Link>
            </>
          )}
        </div>
        <div className="ml-auto min-w-0 max-w-full">
          <AuthControl user={user} />
        </div>
      </nav>
    </header>
  );
}
