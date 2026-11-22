import { useMutation } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import Editor from "react-simple-code-editor";
import { z } from "zod";
import { JsonText } from "@/components/json-text";
import { PageHeader } from "@/components/page-header";
import {
  PipelineComparison,
  pipelineSnapshot,
  type QuestionPair,
} from "@/components/pipeline-diff";
import { PipelineEditorLink } from "@/components/pipeline-view-links";
import { Button } from "@/components/ui/button";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import {
  type PipelineDraft,
  pipelineDraftSchema,
  pipelineExecutionKey,
} from "@/lib/decisions/pipeline-draft";
import { imagesHeader, longContextHeader } from "@/lib/system-one/type-helpers";
import {
  evolvePipeline,
  getEditablePipelineBaseUrls,
  getPipelineVersions,
} from "@/server/pipelines";

export const Route = createFileRoute("/pipelines/$id_/duplicate")({
  validateSearch: z.object({ json: z.boolean().optional().catch(undefined) }),
  loader: async ({ params }) => {
    const id = z.uuid().safeParse(params.id.toLowerCase());
    if (!id.success) throw notFound();
    const [[version], upstreams] = await Promise.all([
      getPipelineVersions({ data: [id.data] }).then((versions) =>
        versions.filter((version) => version.id === id.data),
      ),
      getEditablePipelineBaseUrls(),
    ]);
    if (!version?.options) throw notFound();
    return {
      id: version.id,
      original: pipelineDraftSchema.parse(pipelineSnapshot(version)),
      upstreams,
    };
  },
  component: EvolvePage,
});

type EditableQuestion = {
  key: string;
  name: string;
  type: PipelineDraft["questions"][string]["type"];
  instructions: string;
  criteria: string;
};

type EditableDraft = Omit<PipelineDraft, "questions"> & {
  questions: EditableQuestion[];
};
const input =
  "w-full min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm";
const types = [
  "noul",
  "choice",
  "score",
  "box",
] as const satisfies readonly EditableQuestion["type"][];
const capabilities = [
  [imagesHeader, "Enable images"],
  [longContextHeader, "Enable long context"],
] as const satisfies readonly (readonly [
  keyof PipelineDraft["options"]["headers"],
  string,
])[];

function toFields(
  draft: PipelineDraft,
  previous: EditableQuestion[] = [],
): EditableDraft {
  return {
    ...draft,
    questions: Object.entries(draft.questions).map(([name, q]) => ({
      key: previous.find((question) => question.name === name)?.key ?? name,
      name,
      type: q.type,
      instructions: JSON.stringify(q.instructions, null, 2) ?? "",
      criteria:
        JSON.stringify("criteria" in q ? q.criteria : undefined, null, 2) ?? "",
    })),
  };
}

function parseFields(fields: EditableDraft) {
  const questions = new Map<string, unknown>();
  for (const { name, type, instructions, criteria } of fields.questions) {
    if (questions.has(name)) throw new Error("Question names must be unique.");
    try {
      questions.set(name, {
        type,
        ...(instructions.trim() && { instructions: JSON.parse(instructions) }),
        ...(type !== "box" &&
          criteria.trim() && { criteria: JSON.parse(criteria) }),
      });
    } catch {
      throw new Error(
        `Check the JSON for the question ${name || "(unnamed)"}.`,
      );
    }
  }
  return parseDraft({ ...fields, questions: Object.fromEntries(questions) });
}

function parseDraft(value: unknown) {
  const result = pipelineDraftSchema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(
    issue
      ? `${issue.path.join(".") || "Draft"} · ${issue.message}`
      : "Invalid pipeline.",
  );
}

function EvolvePage() {
  const data = Route.useLoaderData();
  return <DraftEditor key={data.id} {...data} />;
}

function DraftEditor({
  id,
  original,
  upstreams,
}: {
  id: string;
  original: PipelineDraft;
  upstreams: string[];
}) {
  const { json } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [draft, setDraft] = useState(original);
  const [fields, setFields] = useState(() => toFields(original));
  const [raw, setRaw] = useState(() => JSON.stringify(original, null, 2));
  const [fieldError, setFieldError] = useState("");
  const [jsonError, setJsonError] = useState("");
  const hasChanges =
    pipelineExecutionKey(draft) !== pipelineExecutionKey(original);
  const save = useMutation({
    mutationFn: evolvePipeline,
    onSuccess: ({ id }) =>
      navigate({ to: "/pipelines/$id", params: { id }, search: {} }),
  });

  const updateFields = (next: EditableDraft) => {
    setFields(next);
    try {
      const parsed = parseFields(next);
      setDraft(parsed);
      setRaw(JSON.stringify(parsed, null, 2));
      setFieldError("");
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : "Invalid draft.");
    }
  };
  const updateJson = (text: string) => {
    setRaw(text);
    try {
      const parsed = parseDraft(JSON.parse(text));
      setDraft(parsed);
      setFields(toFields(parsed, fields.questions));
      setJsonError("");
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON.");
    }
  };

  const originalNames = Object.keys(original.questions);
  const names = new Set(Object.keys(draft.questions));
  const mapped = new Map(
    fields.questions
      .filter(({ name }) => names.has(name))
      .map(({ key, name }) => [key, name]),
  );
  const pairs: QuestionPair[] = originalNames.map((name) => {
    const rightName = mapped.get(name) ?? (names.has(name) ? name : undefined);
    if (rightName !== undefined) names.delete(rightName);
    return { key: `old-${name}`, leftName: name, rightName };
  });
  for (const name of names)
    pairs.push({ key: `new-${name}`, leftName: undefined, rightName: name });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Evolve pipeline"
        actions={<PipelineEditorLink pipelineId={id} />}
        controls={
          <div className="flex flex-wrap items-center gap-2">
            <ViewModeSwitch
              showJson={json === true}
              onChange={(value) => {
                void navigate({
                  search: { json: value || undefined },
                  replace: true,
                });
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={
                !hasChanges || !!fieldError || !!jsonError || save.isPending
              }
              onClick={() => save.mutate({ data: { sourceId: id, draft } })}
            >
              {save.isPending ? "Saving…" : "Save new pipeline"}
            </Button>
          </div>
        }
      />
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">
          {json ? (
            <label htmlFor="draft-pipeline-json">Edit draft</label>
          ) : (
            "Edit draft"
          )}
        </h2>
        {json ? (
          <Editor
            textareaId="draft-pipeline-json"
            className="max-h-[32rem] min-h-64 overflow-auto rounded-md border bg-background font-mono text-sm"
            spellCheck={false}
            value={raw}
            readOnly={!!fieldError || save.isPending}
            padding={12}
            ignoreTabKey
            highlight={(text) => <JsonText text={text} />}
            onValueChange={updateJson}
          />
        ) : (
          <fieldset
            className="space-y-3"
            disabled={!!jsonError || save.isPending}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm">
                Name
                <input
                  className={input}
                  value={fields.displayName ?? ""}
                  onChange={(event) =>
                    updateFields({
                      ...fields,
                      displayName: event.currentTarget.value || null,
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                Model
                <input
                  className={input}
                  value={fields.model}
                  onChange={(event) =>
                    updateFields({
                      ...fields,
                      model: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                Upstream URL
                <select
                  className={input}
                  value={fields.baseUrl ?? ""}
                  onChange={(event) =>
                    updateFields({
                      ...fields,
                      baseUrl: event.currentTarget.value || null,
                    })
                  }
                >
                  <option value="">Default upstream</option>
                  {[
                    ...new Set([
                      ...(original.baseUrl ? [original.baseUrl] : []),
                      ...(fields.baseUrl ? [fields.baseUrl] : []),
                      ...upstreams,
                    ]),
                  ].map((url) => (
                    <option key={url}>{url}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {capabilities.map(([header, label]) => (
                <label key={header} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fields.options.headers[header] === "true"}
                    onChange={(event) => {
                      const headers = { ...fields.options.headers };
                      if (event.currentTarget.checked) headers[header] = "true";
                      else delete headers[header];
                      updateFields({ ...fields, options: { headers } });
                    }}
                  />{" "}
                  {label}
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fields.uiIgnored}
                  onChange={(event) =>
                    updateFields({
                      ...fields,
                      uiIgnored: event.currentTarget.checked,
                    })
                  }
                />{" "}
                Ignore in list
              </label>
            </div>
            {fields.questions.map((question, index) => {
              const edit = (change: Partial<EditableQuestion>) =>
                updateFields({
                  ...fields,
                  questions: fields.questions.map((row, i) =>
                    i === index ? { ...row, ...change } : row,
                  ),
                });
              return (
                <div
                  key={question.key}
                  className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
                >
                  <label className="space-y-1 text-sm">
                    Question name
                    <input
                      className={input}
                      value={question.name}
                      onChange={(event) =>
                        edit({ name: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    Question type
                    <select
                      className={input}
                      value={question.type}
                      onChange={(event) =>
                        edit({
                          type: z.enum(types).parse(event.currentTarget.value),
                        })
                      }
                    >
                      {types.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    Instructions (JSON)
                    <textarea
                      className={`${input} font-mono`}
                      rows={3}
                      value={question.instructions}
                      onChange={(event) =>
                        edit({ instructions: event.currentTarget.value })
                      }
                    />
                  </label>
                  {question.type !== "box" && (
                    <label className="space-y-1 text-sm">
                      Criteria (JSON)
                      <textarea
                        className={`${input} font-mono`}
                        rows={3}
                        value={question.criteria}
                        onChange={(event) =>
                          edit({ criteria: event.currentTarget.value })
                        }
                      />
                    </label>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateFields({
                        ...fields,
                        questions: fields.questions.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove question
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateFields({
                  ...fields,
                  questions: [
                    ...fields.questions,
                    {
                      key: crypto.randomUUID(),
                      name: "",
                      type: "noul",
                      instructions: "",
                      criteria: "",
                    },
                  ],
                })
              }
            >
              Add question
            </Button>
          </fieldset>
        )}
        {(fieldError || jsonError || save.error) && (
          <p role="alert" className="text-sm text-destructive">
            {json && fieldError
              ? "Fix the invalid field in Render to continue editing JSON."
              : !json && jsonError
                ? "Fix the invalid draft in JSON to continue editing in Render."
                : fieldError || jsonError || save.error?.message}
          </p>
        )}
      </section>
      <PipelineComparison
        left={original}
        right={draft}
        pairs={pairs}
        showJson={json === true}
        rightLabel="Draft"
      />
    </div>
  );
}
