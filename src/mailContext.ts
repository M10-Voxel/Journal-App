import model from './mailContextModel.json' with { type: 'json' };
import { mailContextFeatures } from './mailContextFeatures.ts';
import type { MailSentenceContext } from './mailContextFeatures.ts';

/** A trained, local sentence classifier; no user mail is used for training. */
export function calendarContextScore(context: MailSentenceContext): number {
  let value = model.bias;
  const weights = model.weights as Record<string, number>;
  for (const [feature, amount] of mailContextFeatures(context)) value += (weights[feature] ?? 0) * amount;
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}
export const calendarContextThreshold = model.threshold;
