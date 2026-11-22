import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "../auth-client";
import type { User } from "../lib/auth";

export function AuthControl({ user }: { user: User | null | undefined }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = user?.name.trim();
  const label = user
    ? name && name !== user.email
      ? `Sign out ${name}`
      : "Sign out"
    : "Sign in with GitHub";

  async function toggleAuth() {
    setPending(true);
    setFailed(false);
    try {
      const { error } = user
        ? await authClient.signOut()
        : await authClient.signIn.social({
            provider: "github",
            callbackURL: "/",
          });
      if (error) throw new Error(error.message);
      if (user) window.location.assign("/sign-in");
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        {user && (
          <span
            className="truncate text-xs text-muted-foreground"
            title={user.email}
          >
            {user.email}
          </span>
        )}
        <Button
          type="button"
          size="xs"
          variant={user ? "outline" : "default"}
          className="min-w-0 shrink"
          disabled={pending}
          title={label}
          onClick={() => void toggleAuth()}
        >
          <span className="truncate">{label}</span>
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {user ? "Could not sign out." : "Could not start GitHub sign-in."}
        </p>
      )}
    </div>
  );
}
