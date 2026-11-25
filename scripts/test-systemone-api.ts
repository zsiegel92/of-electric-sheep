import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { apiKeySecret } from "../src/lib/api-keys/schemas";
import {
  decide,
  type SystemOneInput,
} from "../src/lib/system-one/rest-api-client";

const { APP_URL } = process.env;
const appUrl = new URL(APP_URL ?? "http://localhost:5173");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname) ||
  !["http:", "https:"].includes(appUrl.protocol)
) {
  throw new Error("The System One smoke test requires a local APP_URL");
}

execFileSync(
  "uv",
  ["run", "--locked", "python", "-m", "scripts.ensure_smoke_user"],
  { stdio: "inherit" },
);
const secret = apiKeySecret.parse(process.env["SYSTEM_ONE_TEST_API_KEY"]);
const input = {
  model: "jev-latest",
  state: "The customer asked for a refund because the parcel arrived broken.",
  questions: {
    refund: {
      type: "noul",
      instructions: "Did the customer ask for a refund?",
    },
    team: {
      type: "choice",
      instructions: "Which team should handle the request?",
      criteria: { billing: "Refund requests", shipping: "Delivery updates" },
    },
    urgency: {
      type: "score",
      instructions: "How urgently does the ticket need attention?",
      criteria: ["Low", "Medium", "High"],
    },
  },
} satisfies SystemOneInput;

const { answers, model } = await decide(input, {
  apiKey: secret,
  baseUrl: appUrl,
});
for (const [name, question] of Object.entries(input.questions)) {
  assert.equal(
    answers[name]?.type,
    question.type,
    `Unexpected answer type for ${name}`,
  );
}
console.log(
  `System One smoke test passed (${model}): ${Object.keys(answers).join(", ")}`,
);
