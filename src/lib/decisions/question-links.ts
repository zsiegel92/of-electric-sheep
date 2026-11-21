import type { PipelineDefinition } from "./pipeline-schemas";

export type PipelineQuestion = {
  name: string;
  answerShape: string;
  primaryName: string | null;
  question: PipelineDefinition["questions"][string];
};

export type PipelineVersion = {
  id: string;
  primaryGroupedPipelineId: string;
  baseUrl: string | null;
  createdAt: string;
  model: string | null;
  options: PipelineDefinition["options"] | null;
  questions: PipelineQuestion[];
};

export function compatibleQuestions(
  version: PipelineVersion,
  primary: PipelineVersion,
) {
  const shapes = (pipeline: PipelineVersion) =>
    pipeline.questions
      .map(({ answerShape }) => answerShape)
      .sort()
      .join();
  return version.questions.length > 0 && shapes(version) === shapes(primary);
}

export function matchQuestions(
  version: PipelineVersion,
  primary: PipelineVersion,
) {
  const links = new Map<string, string>();
  const available = new Map(
    primary.questions.map((question) => [question.name, question]),
  );
  const link = (name: string, primaryName: string) => {
    links.set(name, primaryName);
    available.delete(primaryName);
  };

  for (const { name, primaryName } of version.questions) {
    if (primaryName !== null) link(name, primaryName);
  }
  for (const { name, answerShape } of version.questions) {
    if (!links.has(name) && available.get(name)?.answerShape === answerShape)
      link(name, name);
  }
  const unmatched = version.questions.filter(({ name }) => !links.has(name));
  for (const { name, answerShape } of unmatched) {
    const candidates = [...available.values()].filter(
      (q) => q.answerShape === answerShape,
    );
    const [candidate] = candidates;
    if (
      candidate &&
      candidates.length === 1 &&
      unmatched.filter((q) => q.answerShape === answerShape).length === 1
    ) {
      link(name, candidate.name);
    }
  }
  return links;
}
