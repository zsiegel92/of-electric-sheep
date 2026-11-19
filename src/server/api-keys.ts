import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { os } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/db";
import { apiKeys, users } from "@/lib/db/schema";
import {
  apiKey,
  apiKeyHeader,
  apiKeyId,
  apiKeyName,
  apiKeySecret,
  createdApiKey,
  deletedApiKey,
} from "./api-key-schemas";
import { type User, userSchema } from "./auth";
import { routeGroup } from "./route-group";

function hashKey(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function apiKeyStorageFields(secret: string) {
  return { prefix: secret.slice(0, 12), keyHash: hashKey(secret) };
}

export async function findApiKeyUser(headers: Headers): Promise<User | null> {
  const secret = apiKeySecret.safeParse(headers.get(apiKeyHeader));
  if (!secret.success) return null;

  const [owner] = await getDb()
    .select({ name: users.name, email: users.email, githubId: users.githubId })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.githubId))
    .where(eq(apiKeys.keyHash, hashKey(secret.data)));
  const result = userSchema.safeParse(owner);
  return result.success ? result.data : null;
}

export async function saveUser(
  user: User,
  db: Pick<ReturnType<typeof getDb>, "insert"> = getDb(),
) {
  await db
    .insert(users)
    .values(user)
    .onConflictDoUpdate({
      target: users.githubId,
      set: { email: user.email, name: user.name },
    });
}

const columns = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  createdAt: apiKeys.createdAt,
};

function serializeKey(row: {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
}) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function ownedKey(user: User, id: string) {
  return and(eq(apiKeys.id, id), eq(apiKeys.userId, user.githubId));
}

const sessionProcedure = os
  .$context<{ user: User | null }>()
  .errors({ UNAUTHORIZED: { message: "Sign in required" } })
  .use(({ context, errors, next }) => {
    if (!context.user) throw errors.UNAUTHORIZED();
    return next({ context: { user: context.user } });
  });

export const apiKeysTag = "API keys";

const route = routeGroup(sessionProcedure, { tag: apiKeysTag });

export const keyManagementRouter = {
  list: route({
    method: "GET",
    path: "/api-keys",
    summary: "List your API keys",
  })
    .output(z.array(apiKey))
    .handler(async ({ context: { user } }) => {
      const rows = await getDb()
        .select(columns)
        .from(apiKeys)
        .where(eq(apiKeys.userId, user.githubId))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(serializeKey);
    }),

  create: route({
    method: "POST",
    path: "/api-keys",
    summary: "Create an API key",
    successStatus: 201,
  })
    .input(apiKeyName)
    .output(createdApiKey)
    .handler(async ({ input, context: { user } }) => {
      const secret = `oes_${randomBytes(32).toString("base64url")}`;
      await saveUser(user);
      const [row] = await getDb()
        .insert(apiKeys)
        .values({
          userId: user.githubId,
          name: input.name,
          ...apiKeyStorageFields(secret),
        })
        .returning(columns);
      if (!row) throw new Error("API key was not created");
      return { ...serializeKey(row), secret };
    }),

  get: route({
    method: "GET",
    path: "/api-keys/{id}",
    summary: "Get an API key’s metadata",
  })
    .errors({ NOT_FOUND: {} })
    .input(apiKeyId)
    .output(apiKey)
    .handler(async ({ input, context: { user }, errors }) => {
      const [row] = await getDb()
        .select(columns)
        .from(apiKeys)
        .where(ownedKey(user, input.id));
      if (!row) throw errors.NOT_FOUND();
      return serializeKey(row);
    }),

  delete: route({
    method: "DELETE",
    path: "/api-keys/{id}",
    summary: "Revoke an API key",
  })
    .errors({ NOT_FOUND: {} })
    .input(apiKeyId)
    .output(deletedApiKey)
    .handler(async ({ input, context: { user }, errors }) => {
      const [row] = await getDb()
        .delete(apiKeys)
        .where(ownedKey(user, input.id))
        .returning({ id: apiKeys.id });
      if (!row) throw errors.NOT_FOUND();
      return { deleted: true };
    }),
};
