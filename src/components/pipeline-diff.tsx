import { diffWordsWithSpace } from "diff";
import { Fragment } from "react";
import type { PipelineDraft } from "@/lib/decisions/pipeline-draft";
import type { PipelineVersion } from "@/lib/decisions/question-links";
import {
  AlignedJsonColumns,
  type JsonRow,
  jsonProperty,
} from "./aligned-json-columns";
import { JsonText } from "./json-text";
import { QuestionName } from "./question-name";

type Snapshot = Omit<PipelineDraft, "model" | "options"> &
  Pick<PipelineVersion, "model" | "options">;
export type QuestionPair = {
  key: string;
  leftName?: string | undefined;
  leftAlias?: string | null | undefined;
  rightName?: string | undefined;
  rightAlias?: string | null | undefined;
};

export function pipelineSnapshot(version: PipelineVersion): Snapshot {
  return {
    displayName: version.displayName,
    model: version.model,
    baseUrl: version.baseUrl,
    options: version.options,
    uiIgnored: version.uiIgnored,
    questions: Object.fromEntries(
      version.questions.map(({ name, question }) => [name, question]),
    ),
  };
}

const fields = [
  ["displayName", "Name"],
  ["model", "Model"],
  ["baseUrl", "Upstream URL"],
  ["options", "Capabilities"],
  ["uiIgnored", "Ignored"],
] as const;
const questionFields = [
  ["type", "Type"],
  ["instructions", "Instructions"],
  ["criteria", "Criteria"],
] as const;

function display(value: unknown) {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function wordDifference(left: string, right: string, json = false) {
  if (left === right) {
    const text = json ? <JsonText text={left} /> : left;
    return [text, text] as const;
  }
  const changes = diffWordsWithSpace(left, right, { maxEditLength: 1500 }) ?? [
    { value: left, added: false, removed: true },
    { value: right, added: true, removed: false },
  ];
  const side = (before: boolean) => {
    let offset = 0;
    return changes
      .filter((change) => (before ? !change.added : !change.removed))
      .map((change) => {
        const start = offset;
        offset += change.value.length;
        const text = json ? <JsonText text={change.value} /> : change.value;
        return (
          <Fragment key={start}>
            {change.added || change.removed ? (
              <mark
                className={
                  change.added
                    ? "rounded-sm bg-green-100 text-green-950 decoration-clone"
                    : "rounded-sm bg-red-100 text-red-950 decoration-clone"
                }
              >
                {text}
              </mark>
            ) : (
              text
            )}
          </Fragment>
        );
      });
  };
  return [side(true), side(false)] as const;
}

function FieldDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: unknown;
  after: unknown;
}) {
  const a = display(before);
  const b = display(after);
  const [left, right] = wordDifference(a, b);
  return (
    <div className="border-t px-3 py-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 divide-x font-mono text-xs">
        <div className="min-w-0 pr-3 whitespace-pre-wrap wrap-anywhere">
          {a ? left : "—"}
        </div>
        <div className="min-w-0 pl-3 whitespace-pre-wrap wrap-anywhere">
          {b ? right : "—"}
        </div>
      </div>
    </div>
  );
}

function jsonRows(
  snapshot: Snapshot,
  pairs: QuestionPair[],
  side: "leftName" | "rightName",
) {
  const last = pairs.findLast((pair) => pair[side] !== undefined);
  return [
    { key: "open", text: "{" },
    ...fields.map(([key]) => ({
      key,
      text: `${jsonProperty(key, snapshot[key], 1)},`,
    })),
    { key: "questions", text: '  "questions": {' },
    ...pairs.map((pair) => {
      const name = pair[side];
      return {
        key: pair.key,
        text:
          name === undefined
            ? ""
            : jsonProperty(name, snapshot.questions[name], 2) +
              (pair === last ? "" : ","),
      };
    }),
    { key: "close", text: "  }\n}" },
  ];
}

export function PipelineComparison({
  left,
  right,
  pairs,
  showJson,
  rightLabel = "Compared version",
}: {
  left: Snapshot;
  right: Snapshot;
  pairs: QuestionPair[];
  showJson: boolean;
  rightLabel?: string;
}) {
  if (showJson) {
    const before = jsonRows(left, pairs, "leftName");
    const after = jsonRows(right, pairs, "rightName");
    const oldRows: JsonRow[] = [];
    const newRows: JsonRow[] = [];
    for (const [index, oldRow] of before.entries()) {
      const newRow = after[index];
      if (!newRow) continue;
      const [oldText, newText] = wordDifference(oldRow.text, newRow.text, true);
      oldRows.push({ ...oldRow, content: oldText });
      newRows.push({ ...newRow, content: newText });
    }
    return (
      <AlignedJsonColumns
        columns={[
          { label: "Original", rows: oldRows },
          { label: rightLabel, rows: newRows },
        ]}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm font-medium">
        <p>Original</p>
        <p>{rightLabel}</p>
      </div>
      <section className="overflow-hidden rounded-lg border">
        <h2 className="bg-muted px-3 py-2 text-sm font-medium">
          Pipeline settings
        </h2>
        {fields.map(([field, title]) => (
          <FieldDiff
            key={field}
            label={title}
            before={left[field]}
            after={right[field]}
          />
        ))}
      </section>
      <h2 className="pt-2 font-medium">Question differences</h2>
      {pairs.map(({ key, leftName, leftAlias, rightName, rightAlias }) => {
        const a = leftName === undefined ? undefined : left.questions[leftName];
        const b =
          rightName === undefined ? undefined : right.questions[rightName];
        return (
          <section key={key} className="overflow-hidden rounded-lg border">
            <h3 className="bg-muted px-3 py-2 text-sm font-medium break-all">
              <QuestionName
                name={leftName ?? rightName ?? ""}
                alias={
                  (leftName === undefined ? rightAlias : leftAlias) ?? null
                }
              />
            </h3>
            <FieldDiff
              label="Question name"
              before={leftName}
              after={rightName}
            />
            {(leftAlias || rightAlias) && (
              <FieldDiff
                label="Question alias"
                before={leftAlias ?? undefined}
                after={rightAlias ?? undefined}
              />
            )}
            {questionFields.map(([field, title]) => {
              const before =
                field === "criteria"
                  ? a && "criteria" in a
                    ? a.criteria
                    : undefined
                  : a?.[field];
              const after =
                field === "criteria"
                  ? b && "criteria" in b
                    ? b.criteria
                    : undefined
                  : b?.[field];
              return before !== undefined || after !== undefined ? (
                <FieldDiff
                  key={field}
                  label={title}
                  before={before}
                  after={after}
                />
              ) : null;
            })}
          </section>
        );
      })}
    </div>
  );
}
