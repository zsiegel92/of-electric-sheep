import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { ORPCError, os } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { apiKeys, users } from "../db/schema";
import {
  apiKey,
  apiKeyId,
  apiKeyName,
  apiKeyUpdate,
  createdApiKey,
  deletedApiKey,
} from "./api-key-schemas";
import { type User, userSchema } from "./auth";

export const apiKeyHeader = "X-API-Key";
const keyFormat = /^oes_[\w-]{43}$/;

function hashKey(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export async function findApiKeyUser(headers: Headers): Promise<User> {
  const secret = headers.get(apiKeyHeader);
  if (!secret || !keyFormat.test(secret)) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "An active API key is required",
    });
  }
  const [owner] = await getDb()
    .select({ name: users.name, email: users.email, githubId: users.githubId })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.githubId))
    .where(eq(apiKeys.keyHash, hashKey(secret)));
  const result = userSchema.safeParse(owner);
  if (!result.success) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "An active API key is required",
    });
  }
  return result.data;
}

export async function saveUser(user: User) {
  await getDb()
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

const userProcedure = os
  .$context<{ user: User | null }>()
  .errors({ UNAUTHORIZED: { message: "Sign in required" } })
  .use(({ context, errors, next }) => {
    if (!context.user) throw errors.UNAUTHORIZED();
    return next({ context: { user: context.user } });
  });

export const apiKeysTag = "API keys";

export const keyManagement = {
  list: userProcedure
    .route({
      method: "GET",
      path: "/api-keys",
      tags: [apiKeysTag],
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

  create: userProcedure
    .route({
      method: "POST",
      path: "/api-keys",
      tags: [apiKeysTag],
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
          prefix: secret.slice(0, 12),
          keyHash: hashKey(secret),
        })
        .returning(columns);
      if (!row) throw new Error("API key was not created");
      return { ...serializeKey(row), secret };
    }),

  get: userProcedure
    .route({
      method: "GET",
      path: "/api-keys/{id}",
      tags: [apiKeysTag],
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

  update: userProcedure
    .route({
      method: "PATCH",
      path: "/api-keys/{id}",
      tags: [apiKeysTag],
      summary: "Rename an API key",
    })
    .errors({ NOT_FOUND: {} })
    .input(apiKeyUpdate)
    .output(apiKey)
    .handler(async ({ input, context: { user }, errors }) => {
      const [row] = await getDb()
        .update(apiKeys)
        .set({ name: input.name })
        .where(ownedKey(user, input.id))
        .returning(columns);
      if (!row) throw errors.NOT_FOUND();
      return serializeKey(row);
    }),

  delete: userProcedure
    .route({
      method: "DELETE",
      path: "/api-keys/{id}",
      tags: [apiKeysTag],
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
