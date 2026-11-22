import type { JsonValue } from "@typesafe-ai/sdk";
import { memo } from "react";
import { JsonText } from "./json-text";

export function DataValue({
  value,
  showJson,
  indentJson = false,
}: {
  value: JsonValue;
  showJson: boolean;
  indentJson?: boolean;
}) {
  return showJson || typeof value === "string" ? (
    <DataText value={value} indent={showJson && indentJson} />
  ) : (
    <Content value={value} />
  );
}

export const DataText = memo(function DataText({
  value,
  indent = false,
}: {
  value: JsonValue;
  indent?: boolean;
}) {
  const { text, json } = formatDataText(value, indent);
  return (
    <pre className="font-mono text-xs wrap-anywhere whitespace-pre-wrap">
      {json ? <JsonText text={text} /> : text}
    </pre>
  );
});

function formatDataText(value: JsonValue, indent: boolean) {
  if (typeof value !== "string") {
    return {
      text: JSON.stringify(value, null, indent ? 2 : undefined),
      json: true,
    };
  }

  const first = value.trimStart()[0];
  if (first === "{" || first === "[") {
    try {
      const parsed: unknown = JSON.parse(value);
      return {
        text: indent ? JSON.stringify(parsed, null, 2) : value,
        json: true,
      };
    } catch {
      // A string can start like JSON and still be plain text.
    }
  }
  return { text: value, json: false };
}

export function Content({ value }: { value: JsonValue }) {
  if (value === null || typeof value !== "object") {
    return (
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">
        {String(value)}
      </p>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {Array.isArray(value) ? "Empty list" : "Empty object"}
      </p>
    );
  }
  return (
    <dl className="space-y-1 border-l pl-3">
      {entries.map(([key, entry]) => (
        <div key={key} className="text-sm">
          <dt className="font-medium wrap-anywhere">
            {Array.isArray(value) ? Number(key) + 1 : key}
          </dt>
          <dd>
            <Content value={entry} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
