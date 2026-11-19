import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../components/ui/button";
import {
  createApiKey,
  listApiKeys,
  renameApiKey,
  revokeApiKey,
} from "../server/functions";

const keysQuery = queryOptions({
  queryKey: ["api-keys"],
  queryFn: () => listApiKeys(),
});

export const Route = createFileRoute("/api-keys")({
  loader: ({ context }) => context.queryClient.ensureQueryData(keysQuery),
  component: ApiKeys,
});

function ApiKeys() {
  const queryClient = useQueryClient();
  const { data: keys } = useSuspenseQuery(keysQuery);
  const [secret, setSecret] = useState<string>();
  const refresh = () => queryClient.invalidateQueries(keysQuery);
  const create = useMutation({
    mutationFn: createApiKey,
    onSuccess: (key) => {
      setSecret(key.secret);
      return refresh();
    },
  });
  const rename = useMutation({ mutationFn: renameApiKey, onSuccess: refresh });
  const revoke = useMutation({ mutationFn: revokeApiKey, onSuccess: refresh });
  const failed = create.isError || rename.isError || revoke.isError;
  const inputClass = "min-w-0 rounded-md border px-3 py-1.5 text-sm";

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">API keys</h1>
      <form
        className="flex items-center gap-2"
        action={(form) => {
          const name = form.get("name");
          if (typeof name === "string") create.mutate({ data: { name } });
        }}
      >
        <input
          name="name"
          aria-label="New key name"
          placeholder="Key name"
          required
          maxLength={80}
          className={inputClass}
        />
        <Button type="submit" disabled={create.isPending}>
          Create key
        </Button>
      </form>
      {secret && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">Copy this key now. It’s shown only once.</p>
          <code className="block select-all break-all text-sm">{secret}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSecret(undefined)}
          >
            Dismiss
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Could not update API keys. Try again.
        </p>
      )}
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {keys.map((key) => (
            <li key={key.id} className="space-y-2 p-3">
              <code className="text-xs text-muted-foreground">
                {key.prefix}…
              </code>
              <form
                className="flex flex-wrap gap-2"
                action={(form) => {
                  const name = form.get("name");
                  if (typeof name === "string")
                    rename.mutate({ data: { id: key.id, name } });
                }}
              >
                <input
                  name="name"
                  aria-label={`Name for key ${key.prefix}`}
                  defaultValue={key.name}
                  required
                  maxLength={80}
                  className={inputClass}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={rename.isPending}
                >
                  Rename
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ data: { id: key.id } })}
                >
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
