import type { ReactNode } from "react";

export function PageHeader({
  title,
  pipelineName,
  actions,
  controls,
}: {
  title: string;
  pipelineName?: ReactNode;
  actions?: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          {pipelineName && (
            <span className="min-w-0 rounded-md border bg-muted px-2 py-0.5 text-sm font-medium tracking-normal wrap-anywhere">
              {pipelineName}
            </span>
          )}
        </h1>
        {actions}
      </div>
      {controls}
    </header>
  );
}
