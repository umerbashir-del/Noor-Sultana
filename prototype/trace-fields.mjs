// Shared metadata allowlist: no database or exporter dependency.
const statuses = new Set(['started','success','error']);
const errors = new Set(['missing_api_key','usage_limit','model_unavailable','invalid_response','unknown_tool','invalid_arguments','tool_failed','call_limit','agent_failed','missing_evidence']);
const numericFields = ['round','durationMs','tokens','inputTokens','reservedTokens','modelCalls','toolCalls','successfulTools','failedTools','reusedTools','uncachedInputTokens','outputTokens','cacheCreationInputTokens','cacheReadInputTokens','countDurationMs','reservationDurationMs','providerDurationMs','settlementDurationMs'];
// Deliberately no prompt, response, arguments, headers, error messages, or session identifier fields.
export function safeTraceFields(fields = {}, toolNames = []) {
 const safe = {};
 if (['ok','unsupported','unavailable','needs_confirmation'].includes(fields.resultStatus)) safe.resultStatus = fields.resultStatus;
 if (['grounded','limited','not_required'].includes(fields.evidenceStatus)) safe.evidenceStatus = fields.evidenceStatus;
 if (['counted','fallback'].includes(fields.reservationMethod)) safe.reservationMethod = fields.reservationMethod;
 if (typeof fields.confirmationRequired === 'boolean') safe.confirmationRequired = fields.confirmationRequired;
 if (statuses.has(fields.status)) safe.status = fields.status;
 if (errors.has(fields.errorKind)) safe.errorKind = fields.errorKind;
 if (fields.tool !== undefined) safe.tool = toolNames.includes(fields.tool) ? fields.tool : 'unknown';
 for (const key of numericFields) if (Number.isSafeInteger(fields[key]) && fields[key] >= 0) safe[key] = fields[key];
 if (typeof fields.model === 'string' && /^claude-[a-z0-9._:-]{1,80}$/i.test(fields.model)) safe.model = fields.model;
 if (/^[a-f0-9]{16}$/.test(fields.promptVersion || '')) safe.promptVersion = fields.promptVersion;
 return safe;
}
