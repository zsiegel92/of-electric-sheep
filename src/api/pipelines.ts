import * as api from "@/generated/sdk.gen";
import type {
  EvolvePipeline,
  RunPipeline,
  SetPipelineIgnored,
  UpdatePipelineName,
  UpdateQuestionAlias,
  UpdateQuestionLinks,
} from "@/generated/types.gen";
import type { PipelineQuestion } from "@/lib/decisions/pipeline-schemas";
import {
  question,
  systemOneResponse,
} from "@/lib/system-one/typesafe-api-schemas";
import { readApi } from "./http";

export function parseQuestion(
  row: Omit<PipelineQuestion, "question"> & { question: unknown },
): PipelineQuestion {
  return { ...row, question: question.parse(row.question) };
}

export const listPipelines = () => readApi(api.listPipelines());

export async function getPipelineVersions({ data }: { data: string[] }) {
  const versions = await readApi(
    api.getPipelineVersions({ query: { ids: data } }),
  );
  return versions.map((version) => ({
    ...version,
    questions: version.questions.map(parseQuestion),
  }));
}

export async function getPipelineQuestions({ data }: { data: string }) {
  const questions = await readApi(
    api.getPipelineQuestions({ path: { pipeline_id: data } }),
  );
  return questions.map(parseQuestion);
}

export const getEditablePipelineBaseUrls = () =>
  readApi(api.getEditablePipelineBaseUrls());

export async function evolvePipeline({ data }: { data: EvolvePipeline }) {
  const { pipelineId } = await readApi(api.evolvePipeline({ body: data }));
  return { id: pipelineId };
}

export async function makePipelinePrimary({ data }: { data: string }) {
  await readApi(api.makePipelinePrimary({ body: { pipelineId: data } }));
}

export async function updatePipeline({
  data,
}: {
  data: UpdatePipelineName | SetPipelineIgnored;
}) {
  await readApi(api.updatePipeline({ body: data }));
}

export function updateQuestionAlias({ data }: { data: UpdateQuestionAlias }) {
  return readApi(api.updateQuestionAlias({ body: data }));
}

export async function updateQuestionLinks({
  data,
}: {
  data: UpdateQuestionLinks;
}) {
  await readApi(api.updateQuestionLinks({ body: data }));
}

export async function runStoredPipeline({ data }: { data: RunPipeline }) {
  const result = await readApi(api.runStoredPipeline({ body: data }));
  return { ...result, ...systemOneResponse.parse(result) };
}
