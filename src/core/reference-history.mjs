export function pushReference(history, current) {
  return { back: [...history.back, current], forward: [] };
}
export function traverseReferences(history, current, direction) {
  const source = history[direction];
  if (!source.length) return null;
  const opposite = direction === 'back' ? 'forward' : 'back';
  return { target: source[source.length - 1], history: { ...history, [direction]: source.slice(0, -1), [opposite]: [...history[opposite], current] } };
}
