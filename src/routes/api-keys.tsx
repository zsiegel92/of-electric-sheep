import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CopyButton } from "../components/copy-button";
import { Button } from "../components/ui/button";
import {
  createApiKey,
  getTypeSafeApiBaseUrl,
  listApiKeys,
  revokeApiKey,
} from "../server/functions";

const keysQuery = queryOptions({
  queryKey: ["api-keys"],
  queryFn: () => listApiKeys(),
});

export const Route = createFileRoute("/api-keys")({
  loader: async ({ context }) => {
    const [baseUrl] = await Promise.all([
      getTypeSafeApiBaseUrl(),
      context.queryClient.ensureQueryData(keysQuery),
    ]);
    return baseUrl;
  },
  component: ApiKeys,
});

function TypeSafeApiBaseUrl() {
  const baseUrl = Route.useLoaderData();
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h2 className="text-sm font-medium">TypeSafe API base URL</h2>
      <div className="flex flex-wrap items-center gap-3">
        <code className="min-w-0 select-all break-all text-sm">{baseUrl}</code>
        <CopyButton value={baseUrl} />
      </div>
    </section>
  );
}

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
  const revoke = useMutation({ mutationFn: revokeApiKey, onSuccess: refresh });
  const failed = create.isError || revoke.isError;
  const inputClass = "min-w-0 rounded-md border px-3 py-1.5 text-sm";

  return (
    <main className="space-y-4 py-8">
      <h1 className="text-2xl font-semibold">API keys</h1>
      <TypeSafeApiBaseUrl />
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
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton key={secret} value={secret} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSecret(undefined)}
            >
              Dismiss
            </Button>
          </div>
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
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div>
                <p className="text-sm font-medium break-all">{key.name}</p>
                <code className="text-xs text-muted-foreground">
                  {key.prefix}…
                </code>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate({ data: { id: key.id } })}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
