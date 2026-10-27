/** Answers are positional; missing trailing answers must stay unanswered. */
export function retainCandidateAnswers<T>(answers: T[], retainedIndices: number[]): T[] {
  return retainedIndices.filter((index) => index < answers.length).map((index) => answers[index]);
}
