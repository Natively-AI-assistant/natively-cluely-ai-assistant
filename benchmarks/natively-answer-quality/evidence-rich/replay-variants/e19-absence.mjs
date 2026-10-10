// E19: saying that the material does NOT contain something is not a claim that needs a record.
// Extends the "Never list these" sentence of LIST_THEN_REWRITE; everything else is the app's prompt, byte for byte.
const OLD = `general knowledge; what the other person said; what the material states.`;
export const NEW = `general knowledge; what the other person said; what the material states; a statement that the material does NOT contain, state or settle something ("nothing in the notes says legal has signed off", "there's no cost figure anywhere in the paper", "that isn't in what I have"), which is the honest answer when the asked thing is absent; declining to give a figure or a detail they cannot verify ("I don't want to give you a number I haven't checked").`;
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD)) throw new Error('e19-absence: the app prompt no longer holds the sentence this variant extends');
  return recorded.replace(OLD, NEW);
}
