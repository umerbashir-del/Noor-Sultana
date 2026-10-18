// Model prose is never an authoritative action receipt. Real receipts are rendered
// by the separate crew, reminder and email endpoints after passenger confirmation.
const completed = '(?:sent|submitted|saved|scheduled|booked|reserved|ordered|cancelled|canceled|purchased|paid|refunded|notified|contacted|dispatched|confirmed|completed|processed|rebooked|changed)';
const action = '(?:(?:crew|assistance|service) request|request|reminder|email|e-mail|message|booking|reservation|order|payment|refund|ticket|flight|seat|crew|flight attendant)';
const patterns = [
 new RegExp("\\b(?:I|we|Noor)(?:['’](?:ve|d)|\\s+(?:have|had))?\\s+(?:(?:already|just|now|successfully)\\s+)*"+completed+'\\b','i'),
 new RegExp('\\b'+action+'(?:s)?\\s+(?:(?:has|have|had)\\s+been|is|are|was|were|got)\\s+(?:(?:already|just|now|successfully)\\s+)*'+completed+'\\b','i'),
 new RegExp("\\b(?:I|we)(?:['’]ll|\\s+will)\\s+(?:send|submit|save|schedule|book|reserve|order|cancel|purchase|pay|refund|notify|contact|dispatch|confirm|rebook|change)\\b",'i'),
 new RegExp('\\b(?:your|the)\\s+'+action+'(?:s)?\\s+(?:is|are)\\s+(?:all set|confirmed|set up|set|done|complete)\\b','i'),
 new RegExp('(?:^|[.!?]\\s+)(?:(?:successfully|already|just)\\s+)?'+completed+'\\s+(?:your|the)\\s+'+action+'\\b','i'),
 new RegExp('\\b(?:your|the)\\s+'+action+'\\s*:\\s*'+completed+'\\b','i'),
 /\b(?:crew|flight attendant)s?\s+(?:is|are)\s+(?:on (?:the|their) way|coming to (?:help|your seat))\b/i,
 /^(?:(?:all\s+)?(?:done|set)|sent|submitted|saved|scheduled|booked|reserved|ordered|cancelled|canceled|confirmed|completed|processed)[.!\s]*$/i,
];
export function actionClaimCheck(reply) {
 const blocked=patterns.some(pattern=>[...reply.matchAll(new RegExp(pattern.source,'gi'))].some(match=>{
  const prefix=reply.slice(Math.max(0,match.index-40),match.index);
  return !/\b(?:no|neither)(?:\s+(?:real|actual|such|other|additional))?\s*$/i.test(prefix)
   && !/\b(?:if|when|unless|whether)(?:\s+(?:your|the|a|an|this|that))?\s*$/i.test(prefix);
 }));
 return {blocked,reply:blocked
  ? 'I cannot confirm that any action was submitted, saved, scheduled, sent, or cancelled. Please review the form and check its status panel for confirmation.'
  :reply};
}
