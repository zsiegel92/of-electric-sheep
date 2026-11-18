import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "../auth-client";
import type { User } from "../server/auth";

export function AuthControl({ user }: { user: User | null | undefined }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

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
      <div className="flex items-center gap-3">
        {user && (
          <div className="text-right text-sm break-all">
            {user.name && user.name !== user.email && (
              <p className="font-medium">{user.name}</p>
            )}
            <p className="text-muted-foreground">{user.email}</p>
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant={user ? "outline" : "default"}
          disabled={pending}
          onClick={() => void toggleAuth()}
        >
          {user ? "Sign out" : "Sign in with GitHub"}
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
