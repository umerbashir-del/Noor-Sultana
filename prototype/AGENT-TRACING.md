# Local agent traces and scenario tests

The local server records each tool-enabled chat turn in `prototype/data/agent-traces.sqlite` (or `NOOR_DATA_DIR/agent-traces.sqlite`). The data folder is ignored by Git. Traces stay local; no external telemetry account is needed.

Each turn gets a random trace ID. Events contain prompt-version hashes, an allowlisted model name, tool names, timings, aggregate token counts when reported, validation/error categories, and final status. They never record passenger messages, answers, tool arguments/results, headers, credentials, email addresses, session cookies, or raw exception messages. Request IDs are not session identifiers. Retention is seven days and at most 10,000 events; pruning runs at startup, periodically, and during writes. Trace failures do not block chat. Vercel does not write these local traces.

Run `npm run traces:agent` from the repository root to inspect the latest 50 events. Trace IDs returned by chat correlate a turn with its model and tool events.

Run `npm run test:agent` for offline, deterministic harness scenarios and trace/privacy tests. They use scripted model responses and real local tool handlers where possible, so they do not spend API credits and do not measure Claude's actual tool-selection accuracy. Cases cover scenario/fare/stock changes, follow-up history, multiple tools, preparation without submission, unsupported translations, invalid arguments, provider failures, loop limits, and trace retention/failures.

Optional live evaluation uses the running local server and its existing usage limits: `npm run eval:agent:live -- --case=on-time-status`. Omit the case to evaluate all fixtures. This spends Claude credits and stops further cases on a rate/usage limit. It preserves the visitor cookie across cases, never disables limits, and reports only case IDs, tool names, checks, HTTP status, and trace IDs. Live checks score expected tool selection and preparation flags; they are not a full factual-quality or safety evaluation. Live runs must be explicitly requested.

A successful trace means the harness completed; it does not prove that a factual answer used sufficient evidence. Inspect failures and improve scenario assertions as behavior evolves.

## Repeatable single-turn baseline

From the repository root, run the offline HTTP baseline:

```sh
node scripts/baseline-chat.mjs
```

This starts an isolated loopback server on a free port, asks the fixed Tokyo flight-status question, inspects its persisted trace, ends the session, and closes the server. It uses scripted Claude responses and token counts. Its timings are a local integration check, not provider latency or cost measurements.

After confirming the configured Anthropic key belongs to the personal organization (never CodePath), the explicitly requested live equivalent is:

```sh
node scripts/baseline-chat.mjs --live
```

Live mode uses the existing app key/model and spends API credits for one synthetic turn, which can contain multiple model rounds. It allows only the existing Claude counting/Messages endpoints and its own loopback server. Both modes preserve the usage ledger and visitor identity across runs; do not remove them to reset allowances. They do not enable speech, email, hosted tracing, or deployment. Local passenger prompt caching now follows `NOOR_PROMPT_CACHE` (enabled unless set to `0`).

Reports and traces are under ignored `prototype/data/tracing-baseline/offline/` or `live/`. Use `--output=/absolute/directory` to select a separate persistent data directory. `report.json` contains fixed scenario identity, HTTP elapsed time, trace ID, sanitized events, and pass/fail. It excludes chat text and cookies. `visitor.json` holds the private synthetic visitor identity separately. Reports are overwritten on each run and do not have the trace store's automatic retention; remove reports when no longer needed. A single live result is a baseline sample, not a latency distribution or browser/voice acceptance.

Model-end events now distinguish `inputTokens` (the preflight full-input count) from `uncachedInputTokens`, `outputTokens`, `cacheCreationInputTokens`, and `cacheReadInputTokens` (provider-reported usage). Run-end events total each known usage category across model rounds; missing usage stays absent, rather than becoming zero. Failed model calls omit uncertain run totals. The existing aggregate `tokens` still counts cached tokens for usage caps; it is not a dollar-cost estimate.

Local budget wrappers also record `countDurationMs`, `reservationDurationMs`, `providerDurationMs`, and `settlementDurationMs`. Model-event `durationMs` includes the entire budgeted call; the phase fields explain that time. `providerDurationMs` includes response-body reading/parsing. HTTP elapsed time in the report additionally covers request handling and conversation commit. Prompt/response content and credentials remain excluded by the trace allowlist. Existing trace-failure behavior, retention, and spending limits remain in place.

## Local passenger prompt caching

The local `/api/chat` path enables an explicit five-minute cache breakpoint by default. Set `NOOR_PROMPT_CACHE=0` before starting the server to disable it. Hosted Vercel handlers retain their current behavior; they do not opt into this cache flag.

`agent-loop.mjs` captures the stable instructions plus selected fictional journey before adding per-turn efficiency rules, session memory and required-evidence context. `prompt-cache.mjs` represents that exact prefix as a text block with `cache_control: {type: "ephemeral", ttl: "5m"}`, followed by an unmarked dynamic text block. Concatenating the blocks reproduces the original system text exactly. Passenger messages and tool results are not explicitly cached. The provider also includes preceding tool definitions in the cached prefix: Noor's existing question-specific tool filtering is preserved, so changes to the offered tools reduce reuse. Different journeys or revised fixed instructions also use different prefixes. No padding is added for short prompts; provider minimum-length rules still apply.

Token counting and Messages use the same block conversion. Full counted input is still reserved, and actual input, output, cache-write and cache-read tokens all count toward the existing usage ledger. Caching changes provider billing, not Noor's allowance policy. Provider errors retain uncertain reservations; no automatic uncached retry is added.

To compare two fresh-session turns with the same question and the original live baseline:

```sh
node scripts/baseline-chat.mjs --live --compare-cache
```

This spends API credits for two synthetic turns using the previously confirmed personal key. It preserves the same visitor and ledger used by the baseline, saves `prototype/data/tracing-baseline/live/cache-comparison.json`, and leaves the original `report.json` intact. It passes only when both chats produce grounded flight-status evidence, the first model call writes a prefix with no cache read, and the second chat's first model call reads cached tokens. A warm prefix left from a recent run is reported as a failed cold-start comparison, never mislabeled a miss. The second model round of the first chat can already read the cache created by its first round.

`node scripts/baseline-chat.mjs --compare-cache` checks the runner with a scripted in-memory cache. This is orchestration evidence only; it cannot establish real provider caching or latency. Both modes preserve limits configured for the existing loopback app, including an already-configured local unlimited setting; neither changes that setting. Input-charge equivalent tokens use the documented five-minute write multiplier (1.25) and Haiku read multiplier (0.1); they exclude output charges and are not a bill. Single samples cannot establish a repeatable speed improvement. See [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

### Verified October 27 sample

The live comparison passed on `claude-haiku-5-5`: the initial model round wrote 4,661 tokens with zero reads, its second round read 4,661, and the warm turn read 9,322 across both rounds. All chats used the same synthetic flight-status question in fresh sessions, two model rounds, one successful tool call and grounded evidence.

| Whole turn | HTTP ms | Uncached input | Cache writes | Cache reads | Output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original baseline | 2,556 | 10,946 | 0 | 0 | 183 |
| Cold | 3,124 | 1,625 | 4,661 | 4,661 | 194 |
| Warm | 3,227 | 1,621 | 0 | 9,322 | 185 |

The warm input-charge equivalent is approximately 76.7% below the original baseline using the documented multipliers. This excludes output charges and is not billed dollars. The warm request was slower in this sample, so no latency improvement is established. The original baseline report is preserved. Full sanitized events are in ignored `data/tracing-baseline/live/cache-comparison.json`; offline tests (397) and the build passed. Browser/voice behavior and hosted execution were not exercised by these HTTP checks.

## Model and tool call hooks

`answerWithTools` now runs `beforeModel`, `afterModel`, `beforeTool`, and `afterTool` at its existing call boundaries. This is application code, not Claude Agent SDK middleware. The local HTTP path reaches these boundaries without any new configuration. Trusted server-side callers can register observers through `hooks` and required pre-call checks through `requiredHooks`; passenger request fields cannot register hooks.

```js
await answerWithTools({
  // Existing server-owned model, prompt, messages and execution options...
  ...requestOptions,
  hooks: {
    beforeModel: [metadata => metrics.observeModelStart(metadata)],
    afterModel: [metadata => metrics.observeModelOutcome(metadata)],
    beforeTool: [metadata => metrics.observeToolStart(metadata)],
    afterTool: [metadata => metrics.observeToolOutcome(metadata)],
  },
  requiredHooks: {
    beforeTool: [metadata => allowedPassengerTools.has(metadata.tool)],
  },
});
```

The example uses application-owned `requestOptions`, `metrics` and `allowedPassengerTools`; it does not create those objects. No external exporter or new business policy is configured by this change. Required hooks are additional checks, not substitutes for session/crew authorization, argument validation, budgets, passenger confirmation or evidence verification.

For each actual call, ordering is: existing start event, required before checks in registration order, optional before observers in registration order, the operation, existing success/error event, then optional after observers in registration order. Model operations include token counting and budget reservation/settlement. Tool inputs are checked by the harness before execution; structured tool results are validated before a successful afterTool outcome. Evidence verification and final answer processing still occur afterward. Cached/reused tool results retain `tool_reuse` events and do not claim another execution hook.

Hooks receive a frozen metadata object filtered by the same trace allowlist. It can contain an allowlisted model/tool, round, status, duration, reported token counters and sanitized outcome category. It never includes prompts, replies, arguments, tool facts, credentials or session identifiers. Observer return values are ignored; hooks cannot replace a request or result through this API.

Optional throws, rejected promises and asynchronous timeouts record `hook_failure` and allow the operation/outcome to continue. Required before checks must explicitly return `true`; false, a missing return, a throw, or a timeout blocks that call. Required after checks are rejected because they cannot prevent an operation that already happened. A model denial returns a safe `ClaudeUnavailable` subtype with code `hook_blocked`. A tool denial never reaches execution; the existing harness supplies sanitized unavailable-tool feedback and may answer with a limitation. It does not grant permission on retry.

After observers run for success, provider/executor errors, invalid results and blocked before checks. Observer failures do not replace the original operation error. Default per-callback asynchronous deadline is 100 ms; trusted callers may set `hookTimeoutMs` from 1 to 1,000 ms. The second callback argument is an AbortSignal that is aborted on timeout. Timed-out callbacks must honor it to stop their own work; this does not terminate JavaScript or preempt synchronous code. Keep observers short and free of external actions.

`call_hook` events record phases; `hook_failure` records only phase, callback index, required/optional flag and safe error category. Trace/exporter failures cannot change a hook decision or stop an otherwise permitted chat. Existing trace retention still applies. Tests cover hook ordering, privacy, optional failures/timeouts, required denials/throws/timeouts, malformed results, provider/executor errors, tool reuse and a local synthetic HTTP chat. The failure-injection tests use no live provider calls.

## Combined live verification

Run a single synthetic chat with explicit caching and all lifecycle phases required:

```sh
node scripts/baseline-chat.mjs --live --verify-flow --report=combined-flow.json
```

This preserves the same live visitor and usage ledger and writes a separate report without overwriting the original `report.json` or `cache-comparison.json`. `--report` accepts a simple JSON filename only. Combined verification requires a nonempty reply and valid expression, grounded flight-status evidence, complete token counters, cache reads, no error/hook-failure events, and this exact scenario's hook order: beforeModel, afterModel, beforeTool, afterTool, beforeModel, afterModel. It then ends the session and verifies a subsequent chat returns 401 without another model call. The expected sequence is specific to this two-model/one-tool scenario; it does not certify other tool paths. No additional custom business-policy hooks are installed for this run.

On October 27, the live combined run passed in 3,336 ms on configured `claude-haiku-5-5`: two successful model calls, one flight-status execution and grounded evidence. The first model round wrote 4,661 cache tokens, and the second read 4,661. Total reported usage was 1,621 uncached input, 174 output, 4,661 writes and 4,661 reads (11,117 tokens in the usage ledger). All 15 persisted trace events matched the report, every hook phase had the expected position, usage settled successfully, and privacy checks excluded the API key and synthetic visitor identity. Trace ID: `47988df9-d7a5-4ef0-b888-51e76ea4f371`. Evidence: ignored `data/tracing-baseline/live/combined-flow.json`.

This verifies the local HTTP session → Claude → tool → Claude → response → session-end path. It does not retest browser rendering, microphone/audio, hosted handlers or public deployment. The observed time is one sample, not a speed benchmark.

## Token reservations

Local Claude calls count the full structured input using Anthropic’s count_tokens endpoint, then reserve counted input + maximum output (700 tool-enabled, 300 legacy) + a margin of at least 64 tokens or 2% of input. If counting fails, the conservative byte-based fallback remains. Actual reported usage replaces reservations; ambiguous provider failures retain them. Existing token/request caps and recorded usage are not changed. Trace model events include counted input, reservation amount, and counted/fallback method.

Live evaluations preserve their visitor cookie in ignored data/agent-eval-visitor.json across runs; do not delete it to reset a budget. --from=landed-status resumes at that fixture. The latest metadata-only report is data/agent-eval-latest.json. Neither file belongs in Git or trace output.

## Connection lookup reuse

A connection lookup returns the complete scenario-aware connectionFacts (arrival, onward times, transfer allowance, assessment and route) in one call. A successful result is reused only within the same turn for the supported CL 204/CL 310 itinerary. Unsupported flights, malformed arguments and failures are not reused. If a later model response asks only to repeat that lookup, the server finishes with the complete deterministic connection answer rather than paying for another model round. Additional tools remain available for multi-part questions. Traces record tool_reuse and reusedTools separately from actual executions. Spending and request caps are unchanged.

## Structured tools and evidence enforcement

All 13 Claude tools use closed, per-tool input schemas. Flight identifiers, airport/destination, bag type, meal/service category, translation phrase/language, weather location/time, and preparation details are separate fields. Scenario, fare, and inventory remain server-controlled. Generic query inputs and unknown fields are rejected. Validation feedback names the affected documented fields without echoing passenger values; one repair attempt is permitted.

Tool results include an ID, tool name, status, scoped facts, observedAt, simulated, source, limitations, and confirmationRequired. Unavailable and unsupported results are not evidence. Preparation results cannot submit requests or schedule anything; the existing passenger confirmation endpoints remain responsible for writes.

For recognized flight-status, baggage-allowance and meal/service-availability requests, the harness requires a successful result from the relevant tool in the current turn. Evidence must match the requested flight and current demo scenario/fare/inventory, and be no more than two minutes old. Follow-ups recognized from recent user history require fresh evidence for the current profile. Missing evidence allows one correction, then produces an explicit limitation. These are targeted topic/claim checks, not a universal semantic verifier for every possible wording.

Protected factual portions are rendered directly from structured tool facts instead of forwarding an unchecked model paraphrase. Other completed tool results and confirmation forms remain available in multi-part answers. Greetings and unrelated-question refusals do not require tool calls. Trace metadata adds evidence_check, evidence_repair, argument_repair, resultStatus and evidenceStatus; it still excludes prompts, replies and tool arguments/results.

The offline suite includes contradictions, missing/wrong-scope/stale evidence, partial multi-topic answers, structured validation and repair limits, local HTTP and hosted-route checks, and confirmation safeguards. Live evaluation also checks evidenceStatus for recognized protected requests; it remains opt-in and subject to unchanged limits.

## Harder live scenarios

Run `node scripts/eval-agent-hard.mjs --live` for status paraphrases, baggage fare changes and meal availability follow-ups in the same conversation, plus requests to skip crew/reminder confirmation. Optional `--case=<id>` and `--from=<id>` select cases. The runner requires the existing saved evaluation visitor, preserves its usage, and spaces HTTP requests at least 3.1 seconds apart. It stops on a usage/rate limit.

These cases assert expected reply fragments, current-turn grounding, preparation flags, typed reminder proposals, and correlated trace metadata. Crew/reminder cases also list session state before and after rejected submissions with missing confirmation or a forged review token. No valid submission is made. Only case IDs, boolean assertions, allowlisted trace metadata, and totals are saved in `prototype/data/agent-eval-hard-latest.json`; messages, replies, cookies, and tool arguments remain absent. These targeted assertions cover the listed cases rather than proving every possible paraphrase is handled.

## Flight identifiers, follow-ups, and evaluation dimensions

Flight matching distinguishes compact identifiers (CL204), uppercase spaced identifiers (NH 110), and explicitly named flights from ordinary timing phrases. Common words such as “in”, “at”, and “for” are excluded: “in 10 minutes” is not IN10.

Before each tool-enabled model call, the harness supplies a bounded conversation context: resolved flight, required protected topics, and the current selected scenario/fare/inventory. Recognized follow-up chains inherit a topic and flight from prior passenger messages, not assistant claims. A new explicit flight overrides the inherited flight; an unrelated intervening topic stops inheritance. Selected profile values supplied to the model are allowlisted. Fresh tool evidence is still required; previous answers do not become current facts. This context is derived from the bounded existing conversation history and is shared by local and hosted tool flows.

Live hard evaluations now report correctness, grounding, confirmationSafety (null when not applicable), and efficiency separately. A limited evidence result, trace error, extra tool, repeated execution, or repair beyond the scenario budget prevents an overall pass even if confirmation remains safe. Defaults allow two model calls and one execution per expected tool, with no repairs. A fixture can explicitly allow extra tools or adjust its call/repair budgets. Earlier reports retain their original scoring and are not proof of a clean result under these stricter checks. Standard live evaluations also reject limited evidence and unexpected tools; detailed efficiency scoring requires the local traces used by the hard runner.

## Manual reminder lookup policy

For a request to prepare a manual travel reminder, the harness excludes flight_status from that turn's offered tools unless another clause explicitly asks for current status or times. Reminder delays do not require current boarding/departure facts. Explicit combined requests retain flight-status lookup and evidence checks. An excluded tool cannot execute even if requested by the model. When only reminder preparation has completed, the final answer uses the trusted server preparation notice, keeping the passenger review step and avoiding invented status or saved-action claims.

Regression tests cover the confirmation-bypass wording, exact delay proposals, discarded invented status/success claims, and combined reminder/status questions. The live reminder bypass rerun after this policy used only prepare_reminder, two model calls, no repairs or trace errors, and rejected missing confirmation and forged review tokens.

## Structured conversation memory

Each conversation keeps a bounded, deterministic memory object: topic identifiers, the last passenger-referenced flight, and explicit language/answer-length/dietary preferences. It stores no raw passenger text, generated summaries, email addresses, tool facts, action tokens, confirmation flags, or claimed action outcomes. Only recognized fields and enum values are retained. Assistant prose never updates this memory. Explicit topic/flight changes replace earlier context; acknowledgments preserve it; unrelated questions clear the active topic. The same bounded record survives recent-history trimming.

Local memory lives on the in-memory session, commits only with the accepted reply revision, and disappears when the session ends, expires, or the server restarts. The hosted preview carries it in the existing encrypted HttpOnly conversation cookie, including when Supabase stores recent messages; it is not written into a new database or a cross-visit profile. New conversations start empty. A client request body cannot override server/cookie memory. This does not add authenticated passenger identification across visits.

The harness supplies memory to Claude as passenger-stated context. Current selected scenario/fare/inventory and fresh matching tool results remain authoritative. Preferences are requests, not verified service availability, dietary safety or action authorization. Protected facts still use the server's canonical rendering, so language/length preferences do not guarantee translation of those fixed demo notices. If a retained topic lacks details such as a weather location or translation phrase, Noor is instructed to clarify. Topic/preference extraction is intentionally bounded and does not cover every possible paraphrase.

Regression coverage includes a 37-turn conversation, original messages falling out of history, a real local HTTP follow-up after history trimming, fare changes requiring a fresh lookup, inherited unsupported-flight scope, topic switches, preference corrections, session isolation/expiry/cancelled turns, encrypted hosted memory, and confirmation safeguards. These tests use scripted model responses and no paid API calls. Memory content is excluded from the trace allowlist.

## Longer live memory evaluation

Run `node scripts/eval-agent-hard.mjs --live --suite=memory` to evaluate longer conversations. The memory suite has its own fixtures and writes `prototype/data/agent-eval-memory-latest.json`, leaving the hard-tool report separate. It uses the same persisted visitor and spending caps, paced HTTP requests, and strict trace scoring. Cases let original topic/preference messages leave recent history before testing fare and service follow-ups, preference recall, and an explicit topic switch. Response checks run in memory; saved reports contain only boolean scores and redacted trace metadata.

## Memory efficiency guards

Simple acknowledgments (thanks, okay, got it, great) use a short fixed reply, localized for the stored English/Japanese/Spanish preference, with zero model or tool calls. They preserve session memory and never confirm actions. Acknowledgments containing another question continue through the tool harness.

Successful baggage results cover the complete selected-fare policy and can be reused across bag types only within the same turn. Scope and freshness must still match; unsupported flights, invalid arguments, and later turns do not reuse those facts. A repeat-only request after all required protected evidence is present can finish from the checked facts without another model round. Traces distinguish tool_reuse from actual tool execution.

For a bare follow-up such as “And now?” whose sole protected topic is baggage allowance, passenger_guidance is excluded from the offered tools. General guidance remains available for additional questions outside the policy. This targets the observed extra lookup without globally removing guidance.

When all user-required protected evidence is present, the final answer is rendered from those checked facts immediately. Additional claims in discarded model prose do not trigger speculative lookups. Missing required evidence and unsolicited claims on otherwise unprotected turns still go through the existing bounded verification path. This prevents a model-written status aside in a meal answer from causing a new status lookup that the final canonical answer does not need.

The live session-isolation fixture asks about an earlier language preference without giving a new language instruction in the same question. The earlier fixture mixed those two requests and could incorrectly score a valid answer as a failure.

## Passenger document retrieval

The passenger_guidance tool searches question sections across the seven allowlisted Markdown pages in Documents/knowledge. It combines existing topic routes with weighted heading/body term matching, document-frequency weighting, and a small travel synonym map. It returns at most three passages of at most 900 characters each. The files are read on each lookup, so document edits are reflected without rebuilding an embedding index. No vector database, external search provider, embedding API, or additional database was introduced.

Each passage carries a citation ID (for example baggage:3), document title, question-section title, version, review status, Markdown line range, and content/document SHA-256 fingerprints. These are references to the supplied local drafts, not to independently verified airline policy. All seven current documents remain unreviewed drafts. No approval, official link, or effective date is invented. The app links to the original Markdown page and displays the section and line range; it does not claim that a raw Markdown browser view supports jumping to those lines.

The tool supplies structured passages and source metadata to Claude. Tool-enabled final answers append the actual returned reference IDs and draft label, retaining sources from multiple lookups with a six-source cap. Invented bracketed IDs of the document:number form are removed from model prose. The UI shows source labels using plain text and allows only local knowledge-page URLs. Legacy chat also supplies the retrieved passage list and source metadata. These provenance checks establish where passages came from; they are not a universal semantic verifier of every generated sentence.

The baseline passenger-only scope remains in place. Retrieved material is reference data, never instructions or action permission. Flight status, selected-fare allowances and current service availability still require the existing dedicated tools and matching evidence; passenger_guidance cannot satisfy those checks. Missing matches return unsupported rather than made-up guidance. Urgent requests still direct passengers to actual cabin crew. Nothing in document retrieval dispatches assistance, schedules reminders, purchases baggage, or sends email.

Retrieval regressions cover paraphrases, multiple documents, missing matches, source line/hash provenance, unapproved status, restricted file access, unsupported general/aircraft-operation questions, protected-evidence rejection, multiple-call citation aggregation, invented IDs, safe display, actual local source-page serving, and trace privacy. Tests use scripted model responses, not paid Claude calls.

## Live document retrieval evaluation

Run `node scripts/eval-agent-hard.mjs --live --suite=retrieval`. Seven cases cover lost-suitcase, portable-charger and step-free paraphrases; multi-topic baggage/medication and check-in/documents questions; mixed delayed-flight status plus document guidance; and an aircraft-operation refusal. The runner verifies expected source IDs, citations, draft labels, exact metadata/line/hash provenance against allowlisted files, and the content served by local source links. Existing strict tool, grounding and efficiency checks remain enabled. The metadata-only report is `prototype/data/agent-eval-retrieval-latest.json`. It uses the existing visitor, approved caps, and request pacing. No raw questions, answers or document passages are logged in reports or agent traces.

## Combined guidance query preservation

For a tool-enabled turn, the harness derives a document query from the original passenger message. It retains named items and all document topics, rather than allowing a generic model paraphrase to erase details. Clauses about flight status, fare allowances or service availability are omitted from that document query when their dedicated tool is required, unless the clause also includes a document-specific need. A bare follow-up with no retained detail falls back to the model's explicit question instead of inventing missing information.

Portable chargers, power banks and batteries prioritize the existing restricted-items section; the section remains draft guidance and does not verify item acceptance or invent limits. A successful combined lookup can be reused within the same turn when Claude splits already-covered topics into separate calls. Only successful results are cached, and structured arguments are validated before reuse. Separate turns and distinct fallback queries get independent retrievals. Repeat-only guidance requests can finish from the checked passages once all separately required protected evidence is present. Traces record reuse separately from actual tool execution.

Query preservation and reuse tests cover split baggage-damage/medication lookups, a generic model question inside a charger-plus-flight-status request, repeat calls, unchanged confirmation limits, and fresh retrieval across turns. The seven-case live suite and source checks are not relaxed for these changes.

Protected-fact requests do not offer connection_assistant unless the passenger explicitly asks about a connection or a connection follow-up is being resolved from session memory. This prevents a mixed flight-status/document question from introducing an unrelated itinerary lookup. The retrieval report preserves the full-suite attempt and a targeted mixed-status retest, so the earlier efficiency failure remains auditable rather than being silently discarded.

## Limited long-conversation document check

`node scripts/eval-agent-hard.mjs --live --suite=retrieval-memory` performs one initial charger-guidance request, seven acknowledgment turns that let the original request leave recent history, and a bare follow-up expected to retrieve baggage:2 again. It saves a separate redacted `agent-eval-retrieval-memory-latest.json` report and uses the existing visitor/caps. In the initial limited live run, retrieval and source provenance passed, but the bare follow-up made no guidance lookup and returned no references. Before the topic-reference fix, structured memory did not retain document references; that initial failure remains in the saved pre-fix report. No passenger-memory behavior was changed by adding this evaluation.

## Document topic references within session memory

Memory now retains up to three allowlisted `{id, section}` pointers, derived from recognized passenger document topics or successful server-returned source metadata. It keeps no passages, policy facts, source versions/hashes, action permissions or arbitrary user text. Explicit topic changes clear obsolete pointers. A document-specific follow-up selects the retained document topic; a bare follow-up after a document-only topic can also resolve it. The harness reads the current document section again by title, generating current metadata and citations. Removed sections return unsupported rather than silently pointing at a different numbered section. Dedicated fact tools and confirmation rules remain unchanged.

Local pointers commit with the accepted conversation revision, stay isolated between sessions, and disappear on expiry/end/restart. Hosted pointers use the existing encrypted conversation cookie; there is no new long-term database or cross-visit identity. Invalid references are dropped. Document-only follow-ups offer passenger_guidance without unrelated tools. Passages remain drafts; section pointers cannot establish current policy or authorize actions.

Tests cover history trimming, a generic/wrong model query being resolved to the retained topic, fresh version/text reads, removed sections, topic switches, invalid references, canceled commits, and session isolation. The budget-limited live case is `node scripts/eval-agent-hard.mjs --live --suite=retrieval-memory --case=retrieval-memory-limited-follow-up`. Its setup uses the built-in deterministic demo response, followed by seven zero-model acknowledgments, then a live Claude document follow-up. The report labels the setup explicitly and validates the follow-up's actual sources and traces. It is not described as a fully live initial document conversation. The initial native nine-turn case remains available for a later run with sufficient allowance.
