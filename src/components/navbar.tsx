import { Link, useMatch } from "@tanstack/react-router";
import { AuthControl } from "./auth-control";

export function Navbar() {
  const user = useMatch({
    from: "__root__",
    select: (match) => match.loaderData,
  });

  return (
    <header className="border-b">
      <nav
        aria-label="Main navigation"
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="/" className="text-lg font-semibold tracking-tight">
            OfElectricSheep
          </a>
          {user && (
            <Link to="/api-keys" className="text-sm hover:underline">
              API keys
            </Link>
          )}
        </div>
        <div className="ml-auto min-w-0">
          <AuthControl user={user} />
        </div>
      </nav>
    </header>
  );
}
