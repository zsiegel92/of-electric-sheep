import { CopyableCodeWithPlaceholders } from "./copyable-code";

export function CurlPreview({
  label,
  command,
  notice,
  hasStatePlaceholder,
  useCurrentBaseUrl,
  setUseCurrentBaseUrl,
  stateFromFile,
  setStateFromFile,
}: {
  label: string;
  command: string;
  notice?: string | undefined;
  hasStatePlaceholder: boolean;
  useCurrentBaseUrl: boolean;
  setUseCurrentBaseUrl: (checked: boolean) => void;
  stateFromFile: boolean;
  setStateFromFile: (checked: boolean) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useCurrentBaseUrl}
          onChange={(event) =>
            setUseCurrentBaseUrl(event.currentTarget.checked)
          }
        />
        Use current base URL
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={stateFromFile}
          onChange={(event) => setStateFromFile(event.currentTarget.checked)}
        />
        Read state from file
      </label>
      {stateFromFile && (
        <p className="text-xs text-muted-foreground">
          Replace <code>&lt;filepath&gt;</code> with a text file path. The
          command uses <code>jq</code> to encode the file contents as a JSON
          string.
        </p>
      )}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <CopyableCodeWithPlaceholders
        code={command}
        copyLabel={label}
        placeholders={[
          "<api-key>",
          ...(!useCurrentBaseUrl ? ["<base-url>"] : []),
          ...(stateFromFile ? ["<filepath>"] : []),
          ...(hasStatePlaceholder ? ["<state>"] : []),
        ]}
      />
    </>
  );
}
