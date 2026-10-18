// Count the same structured input sent to Messages; never log its contents.
export async function planClaudeReservation({ apiKey, model, system, messages, tools, maxOutputTokens = 700, fetchImpl = fetch }) {
 if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('Invalid response allowance.');
 const input = { model, system, messages, ...(tools ? { tools } : {}) };
 try {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages/count_tokens', {
   method: 'POST', signal: AbortSignal.timeout(8000),
   headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
   body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Counting unavailable');
  const result = await response.json();
  if (!Number.isSafeInteger(result.input_tokens) || result.input_tokens < 0) throw new Error('Invalid count');
  const margin = Math.max(64, Math.ceil(result.input_tokens * 0.02));
  const reservedTokens = result.input_tokens + maxOutputTokens + margin;
  if (!Number.isSafeInteger(reservedTokens)) throw new Error('Count overflow');
  return { inputTokens: result.input_tokens, reservedTokens, reservationMethod: 'counted' };
 } catch {
  // Preserve a conservative bound if token counting is unavailable. No heuristic discount.
  const reservedTokens = Math.max(3000, Buffer.byteLength(JSON.stringify(input),'utf8') + maxOutputTokens);
  return { reservedTokens, reservationMethod: 'fallback' };
 }
}
export async function runBudgetedClaude(args, { store, visitorId, requestModel, maxOutputTokens = 700, count = planClaudeReservation }) {
 const reservationInfo = await count({ ...args, maxOutputTokens });
 let reservation;
 try { reservation = store.reserveClaude(visitorId, reservationInfo.reservedTokens); }
 catch(error) { error.reservation = reservationInfo; throw error; }
 try {
  const result = await requestModel({ ...args, maxOutputTokens });
  store.settleClaude(reservation, result.usageTokens);
  return { ...result, reservation: reservationInfo };
 } catch(error) {
  // A request that may have reached the provider keeps its reservation.
  store.markUncertain(reservation);
  error.reservation = reservationInfo;
  throw error;
 }
}
