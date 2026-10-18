const active = new Set(['submitted', 'acknowledged', 'in_progress']);
const nextStatus = {acknowledge: ['submitted', 'acknowledged'], start: ['acknowledged', 'in_progress'], complete: ['in_progress', 'completed']};
const label = status => ({submitted:'submitted', acknowledged:'acknowledged', in_progress:'in progress', completed:'completed', cancelled:'cancelled'})[status] || 'unknown';
const seatIn = question => question.toUpperCase().match(/\b\d{1,2}[A-F]\b/)?.[0] || null;
const requestLine = row => `Seat ${row.seat}: ${row.details} (${label(row.status)}).`;
const subset = (rows, seat) => seat ? rows.filter(row => row.seat === seat) : rows;
const reply = (answer, proposal = null) => ({reply:answer, ...(proposal ? {proposal} : {})});

export function answerCrewQuestion(question, requests) {
  if(typeof question !== 'string' || !question.trim() || question.length > 300) return reply('Ask a crew question in 300 characters or fewer.');
  const text = question.trim();
  const seat = seatIn(text);
  const rows = subset(Array.isArray(requests) ? requests : [], seat);
  const open = rows.filter(row => active.has(row.status));
  const change = /^(?:please\s+)?(?:mark|acknowledge|start|complete)\b/i.test(text)
    ? /\b(acknowledge|acknowledged)\b/i.test(text) ? 'acknowledge'
      : /\b(start|in progress)\b/i.test(text) ? 'start'
        : /\b(complete|completed)\b/i.test(text) ? 'complete' : null
    : null;

  if (change) {
    if (!seat) return reply('Name a seat so I can show the exact request for crew confirmation.');
    const [expectedStatus, status] = nextStatus[change];
    const candidates = open.filter(row => row.status === expectedStatus);
    if (candidates.length > 1) return reply(`Seat ${seat} has ${candidates.length} requests ready for that change. Use the request's button in the board to choose the right one.`);
    if (!candidates.length) return reply(seat ? `Seat ${seat} has no request ready to ${change}. Check its current status on the board.` : `No request is ready to ${change}. Check the current queue.`);
    const row = candidates[0];
    return reply(`Review this demo change: ${requestLine(row)} Change status to ${label(status)}? Nothing changes until you confirm.`, {
      sessionId:row.sessionId, id:row.id, expectedStatus, status, seat:row.seat, details:row.details,
    });
  }

  if (/\b(draft|wording|reply|respond|say to|tell the passenger)\b/i.test(text)) {
    if(!seat) return reply('Name a seat so I can draft an update for the right request.');
    if(rows.length !== 1) return reply(rows.length ? `Seat ${seat} has several requests. Choose one on the board before drafting a passenger update.` : `I have no confirmed request for seat ${seat} in the current queue.`);
    const row = rows[0];
    const update = row.status === 'submitted' ? 'We have your request and the crew will review it.'
      : row.status === 'acknowledged' ? 'The crew has acknowledged your request.'
        : row.status === 'in_progress' ? 'The crew is working on your request.'
          : row.status === 'completed' ? 'The crew marked your request as completed.'
            : 'Your request was cancelled.';
    return reply(`Draft for crew review, seat ${seat}: “${update}” This is a suggested message only; it has not been sent.`);
  }

  if (/\b(handover|hand off|shift|briefing|brief)\b/i.test(text)) {
    const allOpen = rows.filter(row => active.has(row.status));
    if(!allOpen.length) return reply('Handover: no open confirmed demo requests in active conversations.');
    const shown = allOpen.slice(0,8).map(requestLine).join(' ');
    return reply(`Handover: ${allOpen.length} open confirmed demo request${allOpen.length === 1 ? '' : 's'}. ${shown}${allOpen.length > 8 ? ` ${allOpen.length-8} more are on the board.` : ''} Confirm current status before taking action; this queue includes at most 200 requests from active conversations.`);
  }

  if (seat) {
    return reply(rows.length ? `Seat ${seat} has ${rows.length} confirmed demo request${rows.length === 1 ? '' : 's'}: ${rows.slice(0,5).map(requestLine).join(' ')}${rows.length > 5 ? ` ${rows.length-5} more are on the board.` : ''}` : `I have no confirmed request for seat ${seat} in the current queue.`);
  }
  if (/\b(queue|pending|waiting|open|requests|attention|priority)\b/i.test(text)) {
    if(!open.length) return reply('There are no open confirmed demo requests in active conversations.');
    return reply(`${open.length} open confirmed demo request${open.length === 1 ? '' : 's'}. ${open.slice(0,5).map(requestLine).join(' ')}${open.length > 5 ? ` ${open.length-5} more are on the board.` : ''}`);
  }
  return reply('I can check the confirmed request queue, look up a seat, prepare a handover, draft a passenger update, or prepare a status change for crew confirmation.');
}
