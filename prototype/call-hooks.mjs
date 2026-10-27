import { ClaudeUnavailable } from './claude.mjs';
import { safeTraceFields } from './trace-fields.mjs';
import { passengerTools } from './tool-contracts.mjs';

const phases = ['beforeModel', 'afterModel', 'beforeTool', 'afterTool'];
const tools = passengerTools.map(tool => tool.name);
export class HookBlocked extends ClaudeUnavailable {
 constructor() {
  super('Noor could not complete a required check. Please try again.');
  this.code = 'hook_blocked';
 }
}
// Hooks observe metadata; they cannot replace or mutate requests or results.
export function createCallHooks({ hooks = {}, requiredHooks = {}, timeoutMs = 100, emit = () => {} } = {}) {
 if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000
  || !requiredHooks || typeof requiredHooks !== 'object' || Array.isArray(requiredHooks)
  || Object.entries(requiredHooks).some(([phase, callbacks]) => !['beforeModel','beforeTool'].includes(phase)
   || !Array.isArray(callbacks) || callbacks.some(callback => typeof callback !== 'function'))) throw new HookBlocked();
 const report = (event, fields) => { try { emit(event, fields); } catch { /* Optional tracing. */ } };
 async function invoke(callback, metadata) {
  const controller = new AbortController();
  let timer;
  try {
   return await Promise.race([
    Promise.resolve().then(() => callback(metadata, controller.signal)),
    new Promise((_, reject) => { timer = setTimeout(() => {
     controller.abort();
     reject(Object.assign(new Error('Hook timed out'), { code: 'hook_timeout' }));
    }, timeoutMs); }),
   ]);
  } finally { clearTimeout(timer); }
 }
 return async (phase, fields = {}) => {
  if (!phases.includes(phase)) throw new HookBlocked();
  const metadata = Object.freeze(safeTraceFields(fields, tools));
  const required = requiredHooks[phase] ?? [];
  if (!Array.isArray(required)) throw new HookBlocked();
  for (const [hookIndex, callback] of required.entries()) {
   try {
    if (await invoke(callback, metadata) !== true) throw new HookBlocked();
   } catch {
    report('hook_failure', { ...metadata, hookPhase: phase, hookIndex, hookRequired: true, status: 'error', errorKind: 'hook_blocked' });
    throw new HookBlocked(); // Never expose a callback's exception or details.
   }
  }
  const optional = hooks?.[phase] ?? [];
  for (const [hookIndex, callback] of (Array.isArray(optional) ? optional : [optional]).entries()) {
   try { await invoke(callback, metadata); }
   catch (error) {
    report('hook_failure', { ...metadata, hookPhase: phase, hookIndex, hookRequired: false, status: 'error', errorKind: error?.code === 'hook_timeout' ? 'hook_timeout' : 'hook_failed' });
   }
  }
  report('call_hook', { ...metadata, hookPhase: phase });
 };
}
