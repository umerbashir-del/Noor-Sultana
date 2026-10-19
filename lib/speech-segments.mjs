// Derive a bounded playback queue from the already-authorized complete reply.
// Whitespace at segment boundaries is normalized; every word stays in order.
export function segmentSpeech(text, { local = false } = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  let rest = text.trim();
  const segments = [];
  // Local CPU generation finishes each WAV before playback can start. Smaller
  // clauses reduce long mid-reply waits; keep the hosted prediction count intact.
  const limit = local ? 80 : 160;
  const maxSegments = local ? 5 : 3;
  const punctuation = local ? /[.!?;]["'”’)]*(?=\s|$)/gu : /[.!?]["'”’)]*(?=\s|$)/gu;
  while (segments.length < maxSegments - 1 && rest.length > limit) {
    const boundaries = Array.from(rest.matchAll(punctuation), match => match.index + match[0].length);
    let end = boundaries.find(index => index <= limit);
    if (!end) {
      const prefix = rest.slice(0, limit + 1), whitespace = /\s+\S*$/u.exec(prefix);
      end = whitespace?.index;
      if (!end) end = rest.search(/\s/u);
    }
    if (!end || end < 0 || end >= rest.length) break;
    segments.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  // A short first sentence may play while the longer remainder is synthesized.
  if (!segments.length) {
    const first = /[.!?]["'”’)]*(?=\s)/u.exec(rest);
    const end = first && first.index + first[0].length;
    if (end && end < rest.length) { segments.push(rest.slice(0, end).trim()); rest = rest.slice(end).trim(); }
  }
  // Keep the entire remainder even when it exceeds the preferred split length.
  if (rest) segments.push(rest);
  return segments;
}
