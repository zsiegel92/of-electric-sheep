import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

export function CopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copied = status === "copied";
  const Icon = copied ? Check : Copy;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void copy()}
      >
        <Icon aria-hidden="true" />
        {copied ? "Copied" : "Copy"}
      </Button>
      {status === "failed" && (
        <span role="status" className="text-sm text-destructive">
          Could not copy. Select the text and copy it manually.
        </span>
      )}
    </>
  );
}
