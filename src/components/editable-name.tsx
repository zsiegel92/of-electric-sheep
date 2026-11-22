import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";

export function EditableName({
  children,
  value,
  label,
  editLabel,
  placeholder,
  onSave,
  onRemove,
  allowEmpty = false,
}: {
  children: ReactNode;
  value: string | null;
  label: string;
  editLabel: string;
  placeholder: string;
  onSave: (value: string) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const change = useMutation({
    mutationFn: (value: string | null) =>
      value === null && onRemove ? onRemove() : onSave(value ?? ""),
    onSuccess: () => setOpen(false),
  });
  const canSave = (allowEmpty || draft.trim().length > 0) && !change.isPending;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {children}
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (change.isPending) return;
          if (next) {
            setDraft(value ?? "");
            change.reset();
          }
          setOpen(next);
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={editLabel}
            title={editLabel}
          >
            <Pencil aria-hidden="true" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={5}
            collisionPadding={8}
            aria-label={editLabel}
            className="z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-background p-3 shadow-md"
          >
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave) change.mutate(draft.trim());
              }}
            >
              <label className="block space-y-1 text-sm font-medium">
                <span>{label}</span>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  maxLength={100}
                  placeholder={placeholder}
                  disabled={change.isPending}
                  className="w-full rounded-md border bg-background px-2 py-1 text-sm font-normal"
                />
              </label>
              <div className="flex flex-wrap items-center gap-1">
                <Button type="submit" size="xs" disabled={!canSave}>
                  Save
                </Button>
                <Popover.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={change.isPending}
                  >
                    Cancel
                  </Button>
                </Popover.Close>
                {onRemove && value !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="ml-auto text-destructive"
                    disabled={change.isPending}
                    onClick={() => change.mutate(null)}
                  >
                    Remove alias
                  </Button>
                )}
              </div>
              {change.isError && (
                <p role="alert" className="text-xs text-destructive">
                  Could not update the name. Try again.
                </p>
              )}
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
