// Real Postgres, API-key authentication, and SDK HTTP with fake TypeSafe and stubbed Inngest.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { and, DrizzleQueryError, eq, inArray } from "drizzle-orm";
import { PostgresError } from "postgres";
import { createApiKey, saveUser } from "../src/lib/api-keys/queries";
import { apiKeyHeader } from "../src/lib/api-keys/schemas";
import type { User } from "../src/lib/auth";
import { getDb } from "../src/lib/db/db";
import {
  decisionPipelineDefinitions,
  decisionPipelineQuestions,
  decisionPipelines,
  users,
} from "../src/lib/db/schema";
import { newPipelineUsed, pipelineUsed } from "../src/lib/decisions/events";
import { pipelineDefinitionSchema } from "../src/lib/decisions/pipeline-schemas";
import {
  ensureDecisionPipeline,
  saveDecisionPipelineDefinition,
} from "../src/lib/decisions/queries";
import { inngest } from "../src/lib/inngest/inngest";
import { systemOneRequest } from "../src/lib/system-one/typesafe-api-schemas";
import { isRequestThatRequiresApiKey } from "../src/lib/typesafe-api/paths";
import { systemOneRouter } from "../src/server/system-one/router";
import { systemOneRoutes } from "../src/server/system-one/routes";
import { withTestScriptDb } from "./test-db";

const input = systemOneRequest.parse({
  model: "jev-latest",
  state: "First input",
  questions: {
    topic: {
      type: "choice",
      instructions: "Classify this input",
      criteria: { yes: "Relevant", no: null },
    },
    quality: { type: "score", criteria: ["Low", "High"] },
  },
});
const definition = pipelineDefinitionSchema.parse({
  ...input,
  options: { headers: {} },
});

type UsageEvent =
  | ReturnType<typeof newPipelineUsed.create>
  | ReturnType<typeof pipelineUsed.create>;

await test("decision processing integration", async (t) => {
  const calls: Array<{ path: string; body: unknown; authorization: string }> =
    [];
  const events: UsageEvent[] = [];
  const testUsers: User[] = [];
  const newUser = (): User => {
    const user = {
      githubId: randomUUID(),
      name: "Decision integration test",
      email: "decision@example.invalid",
    };
    testUsers.push(user);
    return user;
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls.push({
      path: request.url ?? "",
      body: JSON.parse(Buffer.concat(chunks).toString()),
      authorization: request.headers.authorization ?? "",
    });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        model: "test-model",
        answers: {
          topic: {
            type: "choice",
            choice: "yes",
            confidence: 1,
            probabilities: { yes: 1 },
          },
          quality: {
            type: "score",
            score: 0,
            confidence: 1,
            legend: { "0": "Low", "1": "High" },
            probabilities: { "0": 1, "1": 0 },
          },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env["TYPESAFE_BASE_URL"] = `${baseUrl}/default`;
  process.env["TYPESAFE_API_KEY"] = "local-decision-test-key";
  process.env["LANGFUSE_PUBLIC_KEY"] = "";
  process.env["LANGFUSE_SECRET_KEY"] = "";
  const { processDecision } = await import("../src/lib/decisions/decide");
  t.mock.method(inngest, "send", async (event: UsageEvent | UsageEvent[]) => {
    events.push(...(Array.isArray(event) ? event : [event]));
    return { ids: [randomUUID()] };
  });
  t.beforeEach(() => {
    calls.length = 0;
    events.length = 0;
  });

  try {
    await withTestScriptDb(async (db) => {
      const rowsFor = (user: User) =>
        db
          .select()
          .from(decisionPipelines)
          .where(eq(decisionPipelines.userId, user.githubId));
      const registerUser = async () => {
        const user = newUser();
        await saveUser(user, db);
        return user;
      };
      const replayPath = `/api${systemOneRoutes.decideByPipeline.path}`;
      const api = new OpenAPIHandler(systemOneRouter);
      const replay = async (pipelineId: string, secret?: string) => {
        const headers = new Headers({ "Content-Type": "application/json" });
        if (secret) headers.set(apiKeyHeader, secret);
        const request = new Request(`http://localhost${replayPath}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ pipelineId, state: { text: "Replay state" } }),
        });
        const { response } = await api.handle(request, {
          prefix: "/api",
          context: { headers },
        });
        assert.ok(response);
        return response;
      };
      try {
        await t.test(
          "a new decision uses the default upstream and publishes a creation event",
          async () => {
            const user = await registerUser();
            const result = await processDecision(input, user);
            assert.equal(result.model, "test-model");
            assert.deepEqual(calls, [
              {
                path: "/default/v1/systemone",
                body: input,
                authorization: "Bearer local-decision-test-key",
              },
            ]);
            assert.equal(events.length, 2);
            const creation = events[0];
            assert.ok(creation);
            assert.equal(creation.name, newPipelineUsed.name);
            assert.equal(events[1]?.name, pipelineUsed.name);
            assert.deepEqual(events[1]?.data, creation.data);
            assert.deepEqual(creation.data, {
              pipelineId: creation.data.pipelineId,
              user,
              definition,
              state: input.state,
            });
            assert.equal((await rowsFor(user)).length, 1);
            assert.equal(
              (await rowsFor(user))[0]?.id,
              creation.data.pipelineId,
            );
            assert.equal(
              (await rowsFor(user))[0]?.primaryGroupedPipelineId,
              creation.data.pipelineId,
            );
          },
        );

        await t.test(
          "concurrent first uses receive the UUID stored by the upsert",
          async () => {
            const user = await registerUser();
            await Promise.all([
              processDecision(input, user),
              processDecision({ ...input, state: "Concurrent input" }, user),
            ]);
            const creations = events.filter(
              (event) => event.name === newPipelineUsed.name,
            );
            assert.equal(creations.length, 2);
            assert.ok(creations[0]?.id);
            assert.equal(creations[0].id, creations[1]?.id);
            assert.equal(
              events.filter((event) => event.name === pipelineUsed.name).length,
              2,
            );
            const pipelineId = creations[0]?.data.pipelineId;
            assert.ok(pipelineId);
            assert.ok(
              events.every((event) => event.data.pipelineId === pipelineId),
            );
            assert.equal((await rowsFor(user)).length, 1);
            assert.equal((await rowsFor(user))[0]?.id, pipelineId);
            await saveDecisionPipelineDefinition(
              pipelineId,
              user.githubId,
              definition,
            );
            await processDecision(input, user);
            assert.equal(events.length, 5);
            assert.equal(events.at(-1)?.name, pipelineUsed.name);
            assert.equal(events.at(-1)?.data.pipelineId, pipelineId);
          },
        );

        await t.test(
          "concurrent upserts return one stored pipeline and one creation result",
          async () => {
            const user = await registerUser();
            const results = await Promise.all(
              Array.from({ length: 4 }, () =>
                ensureDecisionPipeline(user, definition),
              ),
            );
            const [pipeline] = await rowsFor(user);
            assert.ok(pipeline);
            assert.equal((await rowsFor(user)).length, 1);
            assert.ok(
              results.every((result) => result.pipeline.id === pipeline.id),
            );
            assert.equal(
              results.filter((result) => result.wasCreated).length,
              1,
            );
            await db
              .update(decisionPipelines)
              .set({ baseUrl: `${baseUrl}/custom` })
              .where(eq(decisionPipelines.id, pipeline.id));
            const reused = await ensureDecisionPipeline(user, definition);
            assert.deepEqual(reused, {
              pipeline: {
                id: pipeline.id,
                baseUrl: `${baseUrl}/custom`,
                primaryGroupedPipelineId: pipeline.id,
                hasDefinition: false,
              },
              wasCreated: false,
            });
          },
        );

        await t.test(
          "an existing pipeline is reused for different state and reordered question keys",
          async () => {
            const user = await registerUser();
            await ensureDecisionPipeline(user, definition);
            const [pipeline] = await rowsFor(user);
            assert.ok(pipeline);
            await saveDecisionPipelineDefinition(
              pipeline.id,
              user.githubId,
              definition,
            );
            const nextInput = {
              ...input,
              state: "Second input",
              questions: {
                quality: input.questions["quality"],
                topic: {
                  type: "choice" as const,
                  instructions: "Classify this input",
                  criteria: { no: null, yes: "Relevant" },
                },
              },
            };
            const request = systemOneRequest.parse(nextInput);
            await processDecision(request, user);
            assert.equal(calls[0]?.path, "/default/v1/systemone");
            assert.deepEqual(calls[0]?.body, request);
            assert.equal(events.length, 1);
            assert.equal(events[0]?.name, pipelineUsed.name);
            assert.deepEqual(events[0]?.data, {
              pipelineId: pipeline.id,
              user,
              definition,
              state: request.state,
            });
          },
        );

        await t.test(
          "model, capability, and ordered rubric changes select a new pipeline",
          async () => {
            const user = await registerUser();
            await ensureDecisionPipeline(user, definition);
            await processDecision({ ...input, model: "other-model" }, user);
            await processDecision(input, user, { enableImages: true });
            await processDecision(
              {
                ...input,
                questions: {
                  ...input.questions,
                  quality: { type: "score", criteria: ["High", "Low"] },
                },
              },
              user,
            );
            assert.equal(events.length, 6);
            assert.equal(
              events.filter((event) => event.name === newPipelineUsed.name)
                .length,
              3,
            );
            assert.equal(
              events.filter((event) => event.name === pipelineUsed.name).length,
              3,
            );
          },
        );

        await t.test(
          "a custom endpoint is used only for its owner's pipeline",
          async () => {
            const owner = await registerUser();
            const other = await registerUser();
            await ensureDecisionPipeline(owner, definition);
            const [pipeline] = await rowsFor(owner);
            assert.ok(pipeline);
            await saveDecisionPipelineDefinition(
              pipeline.id,
              owner.githubId,
              definition,
            );
            await db
              .update(decisionPipelines)
              .set({ baseUrl: `${baseUrl}/owner-pipeline` })
              .where(eq(decisionPipelines.id, pipeline.id));
            await processDecision(input, owner);
            await processDecision(input, other);
            assert.deepEqual(
              calls.map((call) => call.path),
              ["/owner-pipeline/v1/systemone", "/default/v1/systemone"],
            );
            assert.equal(events[0]?.name, pipelineUsed.name);
            assert.deepEqual(events[0]?.data, {
              pipelineId: pipeline.id,
              user: owner,
              definition,
              state: input.state,
            });
            assert.equal(events[1]?.name, newPipelineUsed.name);
            assert.equal(events[2]?.name, pipelineUsed.name);
            assert.deepEqual(events[1]?.data.user, other);
            const newPipelineId = events[1]?.data.pipelineId;
            assert.ok(newPipelineId);
            await ensureDecisionPipeline(other, definition);
            const [otherPipeline] = await rowsFor(other);
            assert.ok(otherPipeline);
            assert.notEqual(otherPipeline.id, pipeline.id);
            assert.equal(otherPipeline.id, newPipelineId);
            assert.equal(otherPipeline.baseUrl, null);
          },
        );

        await t.test(
          "stored definitions require a new pipeline version to edit",
          async () => {
            const user = await registerUser();
            const { pipeline } = await ensureDecisionPipeline(user, definition);
            const storedDefinition = eq(
              decisionPipelineDefinitions.pipelineId,
              pipeline.id,
            );
            const storedQuestions = eq(
              decisionPipelineQuestions.pipelineId,
              pipeline.id,
            );
            const addQuestion = (pipelineId: string) =>
              db.insert(decisionPipelineQuestions).values({
                pipelineId,
                name: "added",
                type: "noul",
              });

            await assert.rejects(addQuestion(pipeline.id));
            await saveDecisionPipelineDefinition(
              pipeline.id,
              user.githubId,
              definition,
            );

            const isImmutableError = (error: unknown) =>
              error instanceof DrizzleQueryError &&
              error.cause instanceof PostgresError &&
              error.cause.constraint_name ===
                "decision_pipeline_definition_immutable";
            await assert.rejects(
              db
                .update(decisionPipelines)
                .set({ definitionHash: "changed" })
                .where(eq(decisionPipelines.id, pipeline.id)),
              isImmutableError,
            );
            await assert.rejects(
              db
                .update(decisionPipelineDefinitions)
                .set({ model: "changed" })
                .where(storedDefinition),
              isImmutableError,
            );
            await assert.rejects(
              db
                .update(decisionPipelineQuestions)
                .set({ systemPrompt: "changed" })
                .where(storedQuestions),
              isImmutableError,
            );
            await assert.rejects(addQuestion(pipeline.id), isImmutableError);
            await assert.rejects(
              db.delete(decisionPipelineQuestions).where(storedQuestions),
              isImmutableError,
            );
            await assert.rejects(
              db.delete(decisionPipelineDefinitions).where(storedDefinition),
              isImmutableError,
            );

            const revised = { ...definition, model: "changed" };
            const { pipeline: version } = await ensureDecisionPipeline(
              user,
              revised,
            );
            assert.notEqual(version.id, pipeline.id);
            await saveDecisionPipelineDefinition(
              version.id,
              user.githubId,
              revised,
            );
            assert.equal((await rowsFor(user)).length, 2);

            await db
              .delete(decisionPipelines)
              .where(eq(decisionPipelines.id, pipeline.id));
            assert.equal(
              (
                await db
                  .select()
                  .from(decisionPipelineDefinitions)
                  .where(storedDefinition)
              ).length,
              0,
            );
            assert.equal(
              (
                await db
                  .select()
                  .from(decisionPipelineQuestions)
                  .where(storedQuestions)
              ).length,
              0,
            );
          },
        );

        await t.test(
          "replay waits for the worker and joins the same-owner canonical pipeline",
          async () => {
            const owner = await registerUser();
            const other = await registerUser();
            const { secret } = await createApiKey(owner, "Replay owner");
            const { secret: otherSecret } = await createApiKey(
              other,
              "Other owner",
            );
            const primaryInput = systemOneRequest.parse({
              model: "primary-model",
              state: "Initial state",
              questions: {
                ...input.questions,
                boolean: { type: "noul", instructions: "null", criteria: null },
                box: { type: "box", instructions: null },
              },
            });
            await processDecision(primaryInput, owner, { enableImages: true });
            const creation = events[0];
            assert.ok(creation && creation.name === newPipelineUsed.name);
            const { pipelineId: primaryId, definition: primaryDefinition } =
              creation.data;
            const { pipeline: alias } = await ensureDecisionPipeline(
              owner,
              definition,
            );
            const { pipeline: replacement } = await ensureDecisionPipeline(
              owner,
              {
                ...definition,
                model: "replacement-model",
              },
            );
            const { pipeline: foreign } = await ensureDecisionPipeline(
              other,
              definition,
            );
            const point = (id: string, target: string) =>
              db
                .update(decisionPipelines)
                .set({ primaryGroupedPipelineId: target })
                .where(eq(decisionPipelines.id, id));
            const violatesGroupConstraint = (error: unknown) =>
              error instanceof DrizzleQueryError &&
              error.cause instanceof PostgresError &&
              error.cause.code === "23503" &&
              error.cause.constraint_name ===
                "decision_pipelines_primary_grouped_pipeline_fk";
            await point(alias.id, primaryId);
            await assert.rejects(
              point(alias.id, foreign.id),
              violatesGroupConstraint,
            );
            await assert.rejects(
              point(replacement.id, alias.id),
              violatesGroupConstraint,
            );
            await assert.rejects(
              point(primaryId, alias.id),
              violatesGroupConstraint,
            );
            await assert.rejects(
              point(primaryId, replacement.id),
              violatesGroupConstraint,
            );
            const reused = await ensureDecisionPipeline(owner, definition);
            assert.equal(reused.pipeline.primaryGroupedPipelineId, primaryId);

            assert.ok(isRequestThatRequiresApiKey(replayPath));
            assert.equal((await replay(alias.id)).status, 401);
            assert.equal((await replay(randomUUID(), secret)).status, 404);
            assert.equal((await replay(alias.id, secret)).status, 404);
            assert.equal(calls.length, 1);
            await saveDecisionPipelineDefinition(
              primaryId,
              other.githubId,
              primaryDefinition,
            );
            assert.equal((await replay(alias.id, secret)).status, 404);
            await Promise.all([
              saveDecisionPipelineDefinition(
                primaryId,
                owner.githubId,
                primaryDefinition,
              ),
              saveDecisionPipelineDefinition(
                primaryId,
                owner.githubId,
                primaryDefinition,
              ),
            ]);
            await db
              .update(decisionPipelines)
              .set({ baseUrl: `${baseUrl}/primary` })
              .where(eq(decisionPipelines.id, primaryId));

            assert.equal((await replay(alias.id, otherSecret)).status, 404);
            const result = await replay(alias.id, secret);
            assert.equal(result.status, 200);
            assert.equal((await result.json()).model, "test-model");
            assert.equal(calls[1]?.path, "/primary/v1/systemone");
            assert.deepEqual(calls[1]?.body, {
              ...primaryInput,
              state: { text: "Replay state" },
            });
            assert.equal(events.length, 3);
            assert.equal(events[2]?.name, pipelineUsed.name);
            assert.equal(events[2]?.data.pipelineId, primaryId);
            assert.deepEqual(events[2]?.data.definition, primaryDefinition);
            assert.equal((await rowsFor(owner)).length, 3);

            await db
              .update(decisionPipelines)
              .set({ primaryGroupedPipelineId: replacement.id })
              .where(
                and(
                  eq(decisionPipelines.userId, owner.githubId),
                  eq(decisionPipelines.primaryGroupedPipelineId, primaryId),
                ),
              );
            assert.ok(
              (await rowsFor(owner)).every(
                (pipeline) =>
                  pipeline.primaryGroupedPipelineId === replacement.id,
              ),
            );
            assert.equal((await replay(alias.id, secret)).status, 404);
            assert.equal(calls.length, 2);
          },
        );
      } finally {
        if (testUsers.length)
          await db.delete(users).where(
            inArray(
              users.githubId,
              testUsers.map((user) => user.githubId),
            ),
          );
      }
    });
  } finally {
    await getDb().$client.end();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
