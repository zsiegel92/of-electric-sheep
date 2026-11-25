import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url);
const testKeyPlaceholder = "__LOCAL_SYSTEM_ONE_TEST_API_KEY__";
const hexPlaceholders = [
  ["__LOCAL_AUTH_SECRET__", 32],
  ["__LOCAL_DB_PASSWORD__", 24],
] as const satisfies readonly (readonly [placeholder: string, bytes: number])[];

if (!existsSync(envFile)) {
  let contents = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  contents = contents.replace(
    testKeyPlaceholder,
    `oes_${randomBytes(32).toString("base64url")}`,
  );
  for (const [placeholder, bytes] of hexPlaceholders) {
    if (!contents.includes(placeholder)) {
      throw new Error(`Missing ${placeholder} in .env.example`);
    }
    contents = contents.replaceAll(
      placeholder,
      randomBytes(bytes).toString("hex"),
    );
  }

  try {
    writeFileSync(envFile, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    // Another setup process may have created the file in the meantime.
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
  }
}
