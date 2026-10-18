export const toolDescriptions = {
 flight_status: 'Read scenario-aware CL 204 flight times/status. The server supplies the scenario.',
 flight_tracking: 'Read the fixed FR24 sandbox tracking sample, separate from CL 204; not flight status.',
 connection_assistant: 'Read ALL CL 204/CL 310 connection facts in one call: arrival, onward gate/times, transfer assessment and directions. Do not repeat or separately check status just for this connection.',
 baggage_allowance: 'Read all bag allowances for the server-selected demo fare. No purchases.',
 airport_guide: 'Read invented HND directions for a named facility, not a real airport map.',
 meals_and_services: 'Read fictional CL 204 menu, stock and amenities. No ordering or dietary certification.',
 prepare_crew_request: 'Prepare the review form only. Passenger must confirm submission. Never dispatch real crew.',
 prepare_reminder: 'Prepare an in-app travel reminder review only. Passenger confirms saving; no email/texts.',
 translate_travel_phrase: 'Translate one supported English travel phrase into Japanese or Spanish.',
 weather: 'Read checked weather for a city or JFK/Haneda. Only Haneda supports the demo arrival forecast.',
 passenger_guidance: 'Search existing passenger guidance sections for a specific air-travel question. Returns up to three unreviewed draft passages with section/line references; not approved policy, live facts, or action permission.',
 arrival_note: 'Read the fixed arrival note.',
 prepare_arrival_email: 'Prepare the fixed email review form only; never send or schedule.',
};
const text=(maxLength=200)=>({type:'string',minLength:1,maxLength});
const choice=(...values)=>({type:'string',enum:values});
const flight={...text(8),pattern:'^[A-Z]{2,3} ?[0-9]{1,4}$'};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export const toolSchemas = {
 flight_status: object({flightId:flight}),
 flight_tracking: object({}),
 connection_assistant: object({inboundFlight:flight,onwardFlight:flight}),
 baggage_allowance: object({flightId:flight,bagType:choice('all','checked','cabin','personal','fees')}),
 airport_guide: object({airport:{...text(4),pattern:'^[A-Z]{3,4}$'},destination:choice('baggage_claim','toilets','accessibility','ground_transport','information')}),
 meals_and_services: object({flightId:flight,category:choice('all','menu','drinks','comfort','amenities','dietary','service_times')}),
 prepare_crew_request: object({category:choice('seat','comfort','general'),details:text(200)}),
 prepare_reminder: object({kind:choice('boarding','connection','belongings','comfort'),delayMinutes:{type:'integer',minimum:1,maximum:120}},['kind']),
 translate_travel_phrase: object({phrase:text(200),language:choice('japanese','spanish')}),
 weather: object({location:text(70),when:choice('current','arrival')}),
 passenger_guidance: object({question:text(300)}),
 arrival_note: object({}),
 prepare_arrival_email: object({}),
};
export const passengerTools = Object.entries(toolDescriptions).map(([name,description])=>({name,description,input_schema:toolSchemas[name]}));
export function validateToolInput(name,input) {
 if(!Object.hasOwn(toolSchemas,name))throw Object.assign(new Error('Unknown tool'),{code:'unknown_tool'});
 const schema=toolSchemas[name],errors=[];
 if(!input||typeof input!=='object'||Array.isArray(input))errors.push({field:'input',expected:'object'});
 else{
  for(const key of Object.keys(input))if(!Object.hasOwn(schema.properties,key))errors.push({field:'input',expected:'only documented fields'});
  for(const key of schema.required)if(!Object.hasOwn(input,key))errors.push({field:key,expected:'required'});
  for(const [key,rule]of Object.entries(schema.properties)){
   if(!Object.hasOwn(input,key))continue;
   const value=input[key];
   if(rule.type==='string'&&(typeof value!=='string'||value.trim().length<(rule.minLength||0)||value.length>(rule.maxLength||Infinity)||(rule.pattern&&!new RegExp(rule.pattern).test(value))))errors.push({field:key,expected:rule.pattern||'nonempty string within length limit'});
   else if(rule.type==='integer'&&(!Number.isInteger(value)||value<rule.minimum||value>rule.maximum))errors.push({field:key,expected:'integer '+rule.minimum+'–'+rule.maximum});
   else if(rule.enum&&!rule.enum.includes(value))errors.push({field:key,expected:rule.enum.join(' | ')});
  }
 }
 if(errors.length)throw Object.assign(new Error('Invalid tool arguments'),{code:'invalid_arguments',fieldErrors:errors});
 return input;
}
export const canonicalFlight = value=>value.replace(/ /g,'');


export function validateToolResult(record,name) {
 const statuses=['ok','unsupported','unavailable','needs_confirmation'];
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const valid=object(record)&&record.tool===name&&statuses.includes(record.status)
  && /^[a-f0-9-]{36}$/i.test(record.id||'')&&Number.isFinite(Date.parse(record.observedAt))
  && object(record.scope)&&typeof record.simulated==='boolean'&&typeof record.confirmationRequired==='boolean'
  && record.confirmationRequired===(record.status==='needs_confirmation')
  && typeof record.source==='string'&&typeof record.reply==='string'
  && Array.isArray(record.limitations)&&record.limitations.every(value=>typeof value==='string')
  && (record.status!=='ok'||object(record.facts));
 if(!valid)throw Object.assign(new Error('Invalid structured tool result'),{code:'invalid_result'});
 return record;
}
