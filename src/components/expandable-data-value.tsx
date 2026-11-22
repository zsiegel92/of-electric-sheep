import type { JsonValue } from "@typesafe-ai/sdk";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DataValue } from "@/components/data-value";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ExpandableDataValue({
  label,
  value,
  showJson,
}: {
  label: string;
  value: JsonValue;
  showJson: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [overflows, setOverflows] = useState(false);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleLabel = `${open ? "Collapse" : "Expand"} ${label.toLowerCase()}`;
  const Icon = open ? ChevronUp : ChevronDown;

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // Match the preview's two-line height limit, even while the input is open.
    const measure = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(content).lineHeight,
      );
      setOverflows(content.scrollHeight > 2 * lineHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("relative rounded-lg border p-3", overflows && "pb-8")}>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <section
        id={contentId}
        aria-label={label}
        tabIndex={open && overflows ? 0 : undefined}
        className={cn(
          "text-sm leading-5",
          open ? "max-h-24 overflow-auto" : "max-h-[2lh] overflow-hidden",
        )}
      >
        <div ref={contentRef}>
          <DataValue value={value} showJson={showJson} />
        </div>
      </section>
      {overflows && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={toggleLabel}
          aria-expanded={open}
          aria-controls={contentId}
          title={toggleLabel}
          className="absolute right-2 bottom-1.5"
          onClick={() => setOpen(!open)}
        >
          <Icon aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
