// Derive a bounded playback queue from the already-authorized complete reply.
// Whitespace at segment boundaries is normalized; every word stays in order.
export function segmentSpeech(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  let rest = text.trim();
  const segments = [];
  while (segments.length < 2 && rest.length > 160) {
    const boundaries = Array.from(rest.matchAll(/[.!?]["'”’)]*(?=\s|$)/gu), match => match.index + match[0].length);
    let end = boundaries.find(index => index <= 160);
    if (!end) {
      const prefix = rest.slice(0, 161), whitespace = /\s+\S*$/u.exec(prefix);
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
  if (rest) segments.push(rest);
  return segments;
}
