import { ExternalLink } from "lucide-react";

export function ObservabilityLink({ href }: { href: string | undefined }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
      External STore
    </a>
  );
}
