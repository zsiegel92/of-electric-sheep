import { useNavigate, useSearch } from "@tanstack/react-router";
import { ViewModeSwitch } from "@/components/view-mode-switch";

export function TraceViewMode({
  from,
}: {
  from: "/trace/$traceId" | "/traces/$pipelineId";
}) {
  const { json = false } = useSearch({ from });
  const navigate = useNavigate({ from });
  return (
    <ViewModeSwitch
      showJson={json}
      onChange={(json) =>
        void navigate({
          params: true,
          replace: true,
          resetScroll: false,
          search: (previous) => ({ ...previous, json: json || undefined }),
        })
      }
    />
  );
}
