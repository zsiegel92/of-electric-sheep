import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

export function CopyableCode({
  code,
  copyLabel,
  children,
}: {
  code: string;
  copyLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <pre className="max-h-96 min-w-0 flex-1 overflow-auto rounded-md border bg-muted p-3 text-sm">
        <code>{children ?? code}</code>
      </pre>
      <div className="flex max-w-28 shrink-0 flex-col items-start gap-1">
        <CopyButton key={code} label={copyLabel} value={code} />
      </div>
    </div>
  );
}

export function CopyableCodeWithPlaceholders({
  code,
  copyLabel,
  placeholders,
}: {
  code: string;
  copyLabel: string;
  placeholders: string[];
}) {
  return (
    <CopyableCode code={code} copyLabel={copyLabel}>
      {highlightPlaceholders(code, placeholders)}
    </CopyableCode>
  );
}

function highlightPlaceholders(code: string, placeholders: string[]) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const { 0: token, index } of code.matchAll(/<[a-z][a-z-]*>/g)) {
    if (!placeholders.includes(token)) continue;
    parts.push(code.slice(offset, index));
    parts.push(
      <span className="font-semibold text-violet-700" key={index}>
        {token}
      </span>,
    );
    offset = index + token.length;
  }
  parts.push(code.slice(offset));
  return parts;
}
