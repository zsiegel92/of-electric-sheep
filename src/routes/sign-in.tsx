import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../auth-client";

export const Route = createFileRoute("/sign-in")({ component: SignIn });

function SignIn() {
  const [error, setError] = useState(false);

  async function signIn() {
    setError(false);
    try {
      const result = await authClient.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
      setError(Boolean(result.error));
    } catch {
      setError(true);
    }
  }

  return (
    <main>
      <h1>Of Electric Sheep</h1>
      <button
        type="button"
        onClick={() => {
          void signIn();
        }}
      >
        Sign in with GitHub
      </button>
      {error && <p role="alert">Could not start GitHub sign-in.</p>}
    </main>
  );
}
