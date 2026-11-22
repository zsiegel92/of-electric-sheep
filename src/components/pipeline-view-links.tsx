import { Link, linkOptions } from "@tanstack/react-router";
import {
  Activity,
  ListTree,
  type LucideIcon,
  SlidersHorizontal,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PipelineLinkProps = { pipelineId: string };

type ViewLinkProps =
  | (PipelineLinkProps & {
      view: "editor" | "traces";
      grouped?: boolean;
      showJson?: boolean;
    })
  | { view: "trace"; traceId: string; showJson: boolean; grouped?: never };

const views = {
  editor: {
    label: "View, Edit, Test",
    Icon: SlidersHorizontal,
  },
  traces: {
    label: "View Traces",
    Icon: Activity,
  },
  trace: {
    label: "View Trace",
    Icon: ListTree,
  },
} satisfies Record<ViewLinkProps["view"], { label: string; Icon: LucideIcon }>;

export function PipelineViewLinks({
  pipelineId,
  showJson = false,
}: PipelineLinkProps & { showJson?: boolean }) {
  return (
    <div className="inline-flex divide-x divide-foreground/25 overflow-hidden rounded-md border border-foreground/25">
      <ViewLink pipelineId={pipelineId} view="editor" grouped />
      <ViewLink
        pipelineId={pipelineId}
        view="traces"
        showJson={showJson}
        grouped
      />
    </div>
  );
}

export function PipelineEditorLink(props: PipelineLinkProps) {
  return <ViewLink {...props} view="editor" />;
}

export function PipelineTracesLink(props: PipelineLinkProps) {
  return <ViewLink {...props} view="traces" />;
}

export function TraceDetailLink({
  traceId,
  showJson,
}: {
  traceId: string;
  showJson: boolean;
}) {
  return <ViewLink view="trace" traceId={traceId} showJson={showJson} />;
}

function ViewLink(props: ViewLinkProps) {
  const { view, grouped } = props;
  const { label, Icon } = views[view];
  const destination =
    view === "trace"
      ? linkOptions({
          to: "/trace/$traceId",
          params: { traceId: props.traceId },
          search: { json: props.showJson || undefined },
        })
      : view === "traces"
        ? linkOptions({
            to: "/traces/$pipelineId",
            params: { pipelineId: props.pipelineId },
            search: { json: props.showJson || undefined },
          })
        : linkOptions({
            to: "/pipelines/$id",
            params: { id: props.pipelineId },
          });
  return (
    <Link
      search={{}}
      {...destination}
      aria-label={view === "trace" ? `${label} ${props.traceId}` : undefined}
      className={cn(
        buttonVariants({ size: "sm", variant: "ghost" }),
        "bg-background",
        grouped
          ? "rounded-none focus-visible:ring-inset"
          : "border border-foreground/25",
        "from-primary/12 to-primary/3 hover:from-primary/18 hover:to-primary/8",
        view === "editor" ? "bg-linear-to-l" : "bg-linear-to-r",
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </Link>
  );
}
