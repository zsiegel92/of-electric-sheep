import { ChevronDown, ChevronUp } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RowExpansion = createContext<{
  expanded: boolean;
  toggle: () => void;
} | null>(null);

export function TraceTableRow({
  children,
  header = false,
}: {
  children: ReactNode;
  header?: boolean;
}) {
  const row = useRef<HTMLTableRowElement>(null);
  const [height, setHeight] = useState<number>();

  function toggle() {
    const currentHeight = row.current?.offsetHeight;
    if (currentHeight === undefined) return;
    setHeight((previous) =>
      previous === undefined ? currentHeight + 64 : undefined,
    );
  }

  return (
    <RowExpansion value={{ expanded: height !== undefined, toggle }}>
      <tr ref={row} className={header ? "h-20" : "h-28"} style={{ height }}>
        {children}
      </tr>
    </RowExpansion>
  );
}

export function TraceTableCell({
  label,
  scope,
  className,
  children,
}: {
  label: string;
  scope?: "col";
  className?: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const id = useId();
  const expansion = useContext(RowExpansion);
  if (!expansion) throw new Error("TraceTableCell requires a TraceTableRow.");
  const { expanded, toggle } = expansion;
  const showToggle = expanded || overflows;
  const Cell = scope ? "th" : "td";
  const Icon = expanded ? ChevronUp : ChevronDown;
  const toggleLabel = `${expanded ? "Collapse" : "Expand"} ${label}`;

  useEffect(() => {
    const box = viewport.current;
    const body = content.current;
    if (!box || !body) return;
    const measure = () => setOverflows(body.offsetHeight > box.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  return (
    <Cell
      scope={scope}
      className={cn(
        "relative border-b border-l align-top",
        scope === "col" && "bg-muted font-normal",
        className,
      )}
    >
      <section
        ref={viewport}
        id={id}
        aria-label={label}
        tabIndex={overflows ? 0 : undefined}
        className="absolute inset-0 overflow-auto [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] focus-visible:outline-inset"
      >
        <div ref={content} className="space-y-1.5 p-3">
          {children}
        </div>
        {overflows && <div aria-hidden="true" className="h-6" />}
      </section>
      {showToggle && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-controls={id}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="absolute right-3 bottom-1 bg-background/90"
          onClick={toggle}
        >
          <Icon aria-hidden="true" />
        </Button>
      )}
    </Cell>
  );
}
