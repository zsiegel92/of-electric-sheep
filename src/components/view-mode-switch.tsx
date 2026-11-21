import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ViewModeSwitch({
  showJson,
  onChange,
}: {
  showJson: boolean;
  onChange: (showJson: boolean) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Display format"
      value={showJson ? "json" : "render"}
      onValueChange={(value) => {
        if (value) onChange(value === "json");
      }}
    >
      <ToggleGroupItem
        className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        value="render"
      >
        Render
      </ToggleGroupItem>
      <ToggleGroupItem
        className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        value="json"
      >
        JSON
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
