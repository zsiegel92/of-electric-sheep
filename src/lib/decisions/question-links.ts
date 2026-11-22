import type { PipelineDefinition } from "./pipeline-schemas";

export type PipelineQuestion = {
  name: string;
  alias: string | null;
  answerShape: string;
  primaryName: string | null;
  question: PipelineDefinition["questions"][string];
};

export type PipelineVersion = {
  id: string;
  primaryGroupedPipelineId: string;
  displayName: string | null;
  uiIgnored: boolean;
  baseUrl: string | null;
  createdAt: string;
  model: string | null;
  options: PipelineDefinition["options"] | null;
  questions: PipelineQuestion[];
};

// The label also serves as a stable key for the multiset of question types.
export function pipelineQuestionKinds(questions: PipelineQuestion[]) {
  const counts = new Map<PipelineQuestion["question"]["type"], number>();
  for (const {
    question: { type },
  } of questions) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return (
    [...counts.keys()]
      .sort()
      .map((type) => `${counts.get(type)} ${type}`)
      .join(" · ") || null
  );
}

export function compatibleQuestions(
  version: PipelineVersion,
  primary: PipelineVersion,
) {
  return (
    version.questions.length > 0 &&
    questionAnswerShapes(version.questions) ===
      questionAnswerShapes(primary.questions)
  );
}

export function questionAnswerShapes(questions: PipelineQuestion[]) {
  return questions
    .map(({ answerShape }) => answerShape)
    .sort()
    .join();
}

export function matchQuestions(
  version: PipelineVersion,
  primary: PipelineVersion,
  compareByType = false,
) {
  const links = new Map<string, string>();
  const available = new Map(
    primary.questions.map((question) => [question.name, question]),
  );
  const link = (name: string, primaryName: string) => {
    links.set(name, primaryName);
    available.delete(primaryName);
  };

  const shape = (question: PipelineQuestion) =>
    compareByType ? question.question.type : question.answerShape;
  if (!compareByType) {
    for (const { name, primaryName } of version.questions) {
      if (primaryName !== null) link(name, primaryName);
    }
  }
  for (const question of version.questions) {
    const { name } = question;
    const candidate = available.get(name);
    if (!links.has(name) && candidate && shape(candidate) === shape(question))
      link(name, name);
  }
  const unmatched = version.questions.filter(({ name }) => !links.has(name));
  for (const question of unmatched) {
    const key = shape(question);
    const candidates = [...available.values()].filter((q) => shape(q) === key);
    const [candidate] = candidates;
    if (
      candidate &&
      candidates.length === 1 &&
      unmatched.filter((q) => shape(q) === key).length === 1
    ) {
      link(question.name, candidate.name);
    }
  }
  return links;
}
