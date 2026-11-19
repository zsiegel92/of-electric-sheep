import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { type User, userSchema } from "@/lib/auth";
import { getDb } from "@/lib/db/db";
import { apiKeys, users } from "@/lib/db/schema";
import { apiKeyHeader, apiKeySecret } from "./schemas";

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

export async function listApiKeys(user: User) {
  const rows = await getDb()
    .select(columns)
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.githubId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(serializeKey);
}

export async function createApiKey(user: User, name: string) {
  const secret = `oes_${randomBytes(32).toString("base64url")}`;
  await saveUser(user);
  const [row] = await getDb()
    .insert(apiKeys)
    .values({
      userId: user.githubId,
      name,
      ...apiKeyStorageFields(secret),
    })
    .returning(columns);
  if (!row) throw new Error("API key was not created");
  return { ...serializeKey(row), secret };
}

export async function getApiKey(user: User, id: string) {
  const [row] = await getDb()
    .select(columns)
    .from(apiKeys)
    .where(ownedKey(user, id));
  return row ? serializeKey(row) : null;
}

export async function revokeApiKey(user: User, id: string) {
  const [row] = await getDb()
    .delete(apiKeys)
    .where(ownedKey(user, id))
    .returning({ id: apiKeys.id });
  return !!row;
}
