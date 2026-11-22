import { Link } from "@tanstack/react-router";
import { Activity, SlidersHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const views = {
  editor: {
    to: "/pipelines/$id",
    label: "View, Edit, Test",
    Icon: SlidersHorizontal,
  },
  traces: {
    to: "/traces/$id",
    label: "View Traces",
    Icon: Activity,
  },
} as const;

type PipelineLinkProps = { pipelineId: string };

export function PipelineViewLinks({ pipelineId }: PipelineLinkProps) {
  return (
    <div className="inline-flex divide-x divide-foreground/25 overflow-hidden rounded-md border border-foreground/25">
      <PipelineViewLink pipelineId={pipelineId} view="editor" grouped />
      <PipelineViewLink pipelineId={pipelineId} view="traces" grouped />
    </div>
  );
}

export function PipelineEditorLink(props: PipelineLinkProps) {
  return <PipelineViewLink {...props} view="editor" />;
}

export function PipelineTracesLink(props: PipelineLinkProps) {
  return <PipelineViewLink {...props} view="traces" />;
}

function PipelineViewLink({
  pipelineId,
  view,
  grouped = false,
}: PipelineLinkProps & { view: keyof typeof views; grouped?: boolean }) {
  const { to, label, Icon } = views[view];
  const isTraces = view === "traces";
  return (
    <Link
      to={to}
      params={{ id: pipelineId }}
      search={{}}
      className={cn(
        buttonVariants({ size: "sm", variant: "ghost" }),
        "bg-background",
        grouped
          ? "rounded-none focus-visible:ring-inset"
          : "border border-foreground/25",
        "from-primary/12 to-primary/3 hover:from-primary/18 hover:to-primary/8",
        isTraces ? "bg-linear-to-r" : "bg-linear-to-l",
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </Link>
  );
}
