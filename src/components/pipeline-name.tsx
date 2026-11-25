import { useRouter } from "@tanstack/react-router";
import { updatePipeline } from "@/api/pipelines";
import { EditableName } from "./editable-name";

export function PipelineName({
  pipeline,
}: {
  pipeline: { id: string; displayName: string | null; model: string | null };
}) {
  const router = useRouter();
  return (
    <EditableName
      value={pipeline.displayName}
      label="Pipeline name"
      editLabel="Rename pipeline"
      placeholder={pipeline.model ?? "Pipeline name"}
      allowEmpty
      onSave={async (displayName) => {
        await updatePipeline({
          data: { pipelineId: pipeline.id, displayName },
        });
        await router.invalidate();
      }}
    >
      <span className="min-w-0 wrap-anywhere">
        {pipeline.displayName ?? pipeline.model ?? "Definition pending"}
      </span>
    </EditableName>
  );
}
