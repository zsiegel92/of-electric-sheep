import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { JsonText } from "./json-text";

export type JsonRow = { key: string; text: string; content?: ReactNode };

export function AlignedJsonColumns({
  columns,
}: {
  columns: { label: string; rows: JsonRow[] }[];
}) {
  const gridColumns = columns.length > 1 ? "grid-cols-2" : "grid-cols-1";
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className={`grid divide-x border-b bg-muted ${gridColumns}`}>
        {columns.map(({ label, rows }) => (
          <div
            key={label}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <span className="text-sm font-medium">{label}</span>
            <CopyButton
              label={`Copy ${label.toLowerCase()} JSON`}
              value={rows
                .map(({ text }) => text)
                .filter(Boolean)
                .join("\n")}
            />
          </div>
        ))}
      </div>
      <div className={`grid divide-x ${gridColumns}`}>
        {columns.map(({ label, rows }) => (
          // Keep each column contiguous in the DOM for native text selection.
          <pre
            key={label}
            className="grid min-w-0 cursor-text select-text grid-rows-subgrid whitespace-pre-wrap wrap-anywhere py-2 font-mono text-xs sm:text-sm"
            style={{ gridRow: `1 / span ${rows.length}` }}
          >
            {rows.map(({ key, text, content }, index) => (
              <span
                key={key}
                className={`block px-3 ${index > 1 && index < rows.length - 1 ? "border-t border-border/60" : ""}`}
              >
                {content ?? <JsonText text={text} />}
              </span>
            ))}
          </pre>
        ))}
      </div>
    </div>
  );
}

export function jsonProperty(name: string, value: unknown, depth: number) {
  const indent = "  ".repeat(depth);
  return `${indent}${JSON.stringify(name)}: ${JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`)}`;
}
