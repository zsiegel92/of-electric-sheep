import assert from "node:assert/strict";
import { apiKeyHeader } from "../src/server/api-keys";
import { systemOnePath } from "../src/server/system-one/paths";
import {
  systemOneRequest,
  systemOneResponse,
} from "../src/server/system-one/schemas";
import { ensureTestUser } from "./ensure-test-user";

const { APP_URL } = process.env;
const appUrl = new URL(APP_URL ?? "http://localhost:5173");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname) ||
  !["http:", "https:"].includes(appUrl.protocol)
) {
  throw new Error("The System One smoke test requires a local APP_URL");
}

const { secret } = await ensureTestUser();
const input = systemOneRequest.parse({
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
});

const response = await fetch(new URL(`/api${systemOnePath}`, appUrl), {
  method: "POST",
  headers: { [apiKeyHeader]: secret, "Content-Type": "application/json" },
  body: JSON.stringify(input),
  redirect: "error",
  signal: AbortSignal.timeout(65_000),
});
if (!response.ok) {
  throw new Error(
    `System One returned HTTP ${response.status}: ${await response.text()}`,
  );
}

const { answers, model } = systemOneResponse.parse(await response.json());
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
