# Noor Sultana in-flight assistant — PRD summary

**Status:** Concept and initial PRD filled; several implementation choices remain TBD.

**Source of truth:** [AI agent PRD in Google Docs](https://docs.google.com/document/d/1DRyTAUEr5OJAxn74JRIA0d0NzAgnldxgB7L7HlPXCxA/edit?tab=t.0)

**Recent direction (October 11, 2026; pending update to the Google Doc):** Noor is being planned for passengers, not staff. Crew sign-in and announcement publishing are outside the current plan. A passenger can schedule the fixed arrival email to their own verified address after reviewing its full content and send time, once Resend is configured. The earlier crew scope recorded below reflects the original PRD and needs reconciliation with this decision. Draft passenger FAQ topics are in the [knowledge library](knowledge/README.md); the local demo may use them for general guidance, but they are not approved airline policy.

**Email demo:** Noor prepares a fixed arrival email that the model cannot alter. The passenger verifies address ownership by code, reviews the recipient, complete content, and time, and confirms scheduling. SQLite stores the job and confirmation; a background worker sends through Resend and tracks provider outcome. Status and cancellation are available after verifying the same address again. Live sending requires a Resend API key and a verified sending address; the repository contains only fill-in examples.

## Prototype status

A passenger-facing visual-novel prototype now lives in [`prototype/`](../prototype/). It places Noor in a stylized airplane aisle and sends general chat messages to Claude through a local server. Noor uses transparent welcoming and thoughtful sprites, with a thinking pose while a reply is pending. The fictional sample flight is Cloudline Air CL 204 from JFK to Tokyo Haneda (HND). A read-only Open-Meteo lookup supplies real public weather near those airports, clearly separated from fictional flight details. Anonymous chat sessions now keep recent history in server memory and can be ended from the screen; persistent profiles and memory are not implemented. Voice input and output are under local development; crew sign-in, announcement drafts, and live airline data tools are not implemented in this demo.

## Product concept

A seat-back assistant for passengers and cabin crew. Users can interact by text or voice. Noor Sultana is a 2D character in a visual-novel style; her facial expression can change to fit the conversation.

## Agreed scope so far

- Serve both passengers and cabin crew.
- Provide airport information, flight details, weather, and relevant calendar or itinerary information.
- Draft announcements.
- Keep crew calendars and announcement drafts behind crew sign-in.
- Route text and speech input through intent, context, and safety handling before model reasoning.
- Return responses as text, or as speech through the response manager.
- Use tools/APIs, memory, and a knowledge source as shown in the supplied architecture sketches.

## Access boundary

The seat-back screen is shared with passengers. Crew-only information must not appear until crew sign-in succeeds. The specific sign-in method and the behavior when crew leaves the screen are not yet decided.

## Architecture from the sketches

1. User enters text or speaks into the microphone.
2. Speech input is converted to text.
3. An input/router step identifies intent, context, and safety constraints.
4. The model reasons over the request and may use approved tools, memory, or knowledge.
5. A response manager returns text or sends it to speech output.
6. The 2D character changes expression when the conversation calls for it.

The sketches mention calendar, weather, and email APIs; SQLite profile/history/tasks memory; and RAG/search over documents and notes. These are candidate components, not confirmed providers or final implementation choices.

## Decisions and open questions

| Topic | Current state |
| --- | --- |
| Users | Passengers and crew |
| Interface | Seat-back screen; text and voice |
| Character | 2D visual-novel style, expressive face |
| Crew data access | Crew sign-in required |
| Crew sign-in method | TBD |
| Passenger access to crew calendars/drafts | Not allowed |
| Data providers | TBD |
| Speech-to-text and speech output providers | TBD |
| Memory privacy, retention, and shared-device reset | TBD |
| Knowledge sources | TBD |
| User research and metric targets | TBD |

## Next design questions

- How does crew sign in securely on a screen passengers can also use?
- How does the screen return to passenger-safe mode after a crew session?
- Which calendar data is a flight attendant's schedule, and which is the flight itinerary?
- Which tools and data may passengers access without crew sign-in?
- What should the assistant do when a tool fails or the flight data is stale?
- What expression changes are appropriate, and how should they remain clear without implying feelings the assistant does not have?
