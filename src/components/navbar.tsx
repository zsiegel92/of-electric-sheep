import { useMatch } from "@tanstack/react-router";
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
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3"
      >
        <a href="/" className="text-lg font-semibold tracking-tight">
          OfElectricSheep
        </a>
        <AuthControl user={user} />
      </nav>
    </header>
  );
}
