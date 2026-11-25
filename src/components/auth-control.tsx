import { Button } from "@/components/ui/button";
import type { User } from "@/generated/types.gen";

export function AuthControl({ user }: { user: User | null | undefined }) {
  const name = user?.name.trim();
  const label = user
    ? name && name !== user.email
      ? `Sign out ${name}`
      : "Sign out"
    : "Sign in with GitHub";

  return (
    <form
      method="post"
      action={user ? "/api/auth/sign-out" : "/api/auth/start"}
      className="flex items-center gap-2"
    >
      {user && (
        <span
          className="truncate text-xs text-muted-foreground"
          title={user.email}
        >
          {user.email}
        </span>
      )}
      <Button
        type="submit"
        size="xs"
        variant={user ? "outline" : "default"}
        className="min-w-0 shrink"
        title={label}
      >
        <span className="truncate">{label}</span>
      </Button>
    </form>
  );
}
