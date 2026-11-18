import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useGetViewerQuery } from "./generated/@tanstack/react-query.gen";
import { zApiError } from "./generated/zod.gen";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function App() {
  const viewer = useGetViewerQuery();
  const error = zApiError.safeParse(viewer.error);

  return (
    <main>
      <h1>Of Electric Sheep</h1>
      {viewer.isPending && <p>Loading…</p>}
      {error.success && error.data.detail === "Sign in required" && (
        <a href="/auth/login">Sign in with GitHub</a>
      )}
      {viewer.isError &&
        (!error.success || error.data.detail !== "Sign in required") && (
          <p role="alert">Could not load your account.</p>
        )}
      {viewer.data && (
        <>
          <p>Signed in as {viewer.data.user.githubLogin}</p>
          <p>Database: {viewer.data.database}</p>
          <form action="/auth/sign-out" method="post">
            <button type="submit">Sign out</button>
          </form>
        </>
      )}
    </main>
  );
}

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
