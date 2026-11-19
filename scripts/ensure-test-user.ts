import { eq } from "drizzle-orm";
import { apiKeys } from "../src/lib/db/schema";
import { apiKeySecret } from "../src/server/api-key-schemas";
import { apiKeyStorageFields, saveUser } from "../src/server/api-keys";
import type { User } from "../src/server/auth";
import { withTestScriptDb } from "./test-db";

const testUser = {
  githubId: "system-one-smoke-test",
  email: "system-one-smoke@example.invalid",
  name: "System One Smoke Test",
} satisfies User;

const testKeyId = "4b0ff728-caa4-4859-9c02-d575b3565461";

export async function ensureTestUser() {
  const secret = apiKeySecret.parse(process.env["SYSTEM_ONE_TEST_API_KEY"]);
  await withTestScriptDb((db) =>
    db.transaction(async (tx) => {
      await saveUser(testUser, tx);
      const fields = {
        name: "System One smoke test",
        ...apiKeyStorageFields(secret),
      };
      const [key] = await tx
        .insert(apiKeys)
        .values({ id: testKeyId, userId: testUser.githubId, ...fields })
        .onConflictDoUpdate({
          target: apiKeys.id,
          set: fields,
          setWhere: eq(apiKeys.userId, testUser.githubId),
        })
        .returning({ id: apiKeys.id });
      if (!key)
        throw new Error("The smoke-test key ID belongs to another user");
    }),
  );

  return { user: testUser, secret };
}

if (import.meta.main) {
  const { user } = await ensureTestUser();
  console.log(`Ensured local test user ${user.githubId} and API key.`);
}
