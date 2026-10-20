import type { ApiErrorDetail } from '../common/http/api-response.js';
import { QuestionType } from '../generated/prisma/client.js';
import type { AnswerDto } from './event-registration.dto.js';

export interface EventQuestionRule {
  questionId: number;
  questionType: QuestionType;
  isRequired: boolean;
  options: unknown;
}

const MAX_TEXT_LENGTH = 5000;

// Checks answers against the event's questions. Text, select and radio
// answers are stored as the string; checkbox answers as a JSON array string.
export function checkAnswers(
  questions: EventQuestionRule[],
  answers: AnswerDto[],
): {
  stored: { questionId: number; answerText: string }[];
  errors: ApiErrorDetail[];
} {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const answered = new Set<number>();
  const invalid = new Set<number>();
  const stored: { questionId: number; answerText: string }[] = [];
  const errors: ApiErrorDetail[] = [];

  answers.forEach(({ questionId, answer }, index) => {
    const pointer = `/answers/${index}`;
    const question = byId.get(questionId);
    if (!question || answered.has(questionId)) {
      errors.push({
        pointer: `${pointer}/questionId`,
        message: question
          ? 'Each question can be answered once.'
          : 'This question does not belong to the event.',
      });
      return;
    }
    answered.add(questionId);

    const text = toStoredText(question, answer);
    if (text === undefined) {
      invalid.add(questionId);
      errors.push({
        pointer: `${pointer}/answer`,
        message: 'This answer is not valid for the question.',
      });
    } else if (text !== null) {
      stored.push({ questionId, answerText: text });
    }
  });

  for (const { questionId, isRequired } of questions) {
    const given = stored.some((row) => row.questionId === questionId);
    if (isRequired && !given && !invalid.has(questionId)) {
      errors.push({
        pointer: '/answers',
        message: `Question ${questionId} is required.`,
      });
    }
  }
  return { stored, errors };
}

// Returns the text to store, null for an empty optional answer, or
// undefined when the answer does not fit the question.
function toStoredText(
  question: EventQuestionRule,
  answer: unknown,
): string | null | undefined {
  const options = Array.isArray(question.options)
    ? (question.options as unknown[])
    : [];

  if (question.questionType === QuestionType.CHECKBOX) {
    if (!Array.isArray(answer) || new Set(answer).size !== answer.length)
      return undefined;
    if (
      !answer.every(
        (choice) => typeof choice === 'string' && options.includes(choice),
      )
    ) {
      return undefined;
    }
    return answer.length === 0 ? null : JSON.stringify(answer);
  }

  if (typeof answer !== 'string') return undefined;
  const text = answer.trim();
  if (text === '') return null;
  if (question.questionType === QuestionType.TEXT) {
    return text.length <= MAX_TEXT_LENGTH ? text : undefined;
  }
  return options.includes(text) ? text : undefined;
}
