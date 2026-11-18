import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../auth-client";
import { getViewer, updateProfile } from "../server/functions";
import { maxDisplayNameLength } from "../server/schemas";

export const Route = createFileRoute("/")({
  loader: () => getViewer(),
  component: Home,
});

function Home() {
  const viewer = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState("");

  async function save(form: FormData) {
    const displayName = form.get("displayName");
    if (typeof displayName !== "string") return;

    setError("");
    try {
      await updateProfile({ data: { displayName } });
      await router.invalidate();
    } catch {
      setError("Could not save your display name.");
    }
  }

  async function signOut() {
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      window.location.assign("/sign-in");
    } catch {
      setError("Could not sign out.");
    }
  }

  return (
    <main>
      <h1>Of Electric Sheep</h1>
      <p>Signed in as {viewer.email}</p>
      <form action={save}>
        <label>
          Display name{" "}
          <input
            name="displayName"
            defaultValue={viewer.displayName}
            required
            maxLength={maxDisplayNameLength}
          />
        </label>
        <button type="submit">Save</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p>
        <a href="/api/docs">API docs</a>
      </p>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </main>
  );
}
