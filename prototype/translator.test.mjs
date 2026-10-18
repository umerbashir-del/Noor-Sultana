import test from 'node:test';
import assert from 'node:assert/strict';
import { translationIntent, translationReply } from './translator.mjs';
test('translation routing takes precedence over other travel features', () => {
 for (const q of ['How do I ask where baggage claim is in Japanese?', 'Translate water please to Spanish', 'Travel phrase translator']) assert.equal(translationIntent(q), true);
 assert.equal(translationIntent('Where is baggage claim?'), false);
});
test('returns fixed Japanese and Spanish phrases and pronunciation', () => {
 const ja = translationReply('How do I ask where baggage claim is in Japanese?');
 assert.equal(ja.translation.text, '手荷物受取所はどこですか？');
 assert.equal(ja.translation.code, 'ja');
 const es = translationReply('Translate "Where are the toilets?"', 'spanish');
 assert.equal(es.translation.text, '¿Dónde están los baños?');
 assert.equal(translationReply('Translate to Spanish: Water please').translation.code, 'es');
 for (const phrase of ['Where is my boarding gate?', 'Could you help me, please?', 'Could I have some water, please?', 'Do you have a vegetarian meal?']) assert.ok(translationReply('Translate ' + phrase).translation);
});
test('does not translate unsupported languages, arbitrary text, or mixed instructions', () => {
 assert.match(translationReply('Translate water please into French').reply, /Japanese and Spanish only/);
 assert.match(translationReply('Translate to German: water please').reply, /Japanese and Spanish only/);
 assert.match(translationReply('Translate 2+2').reply, /does not translate arbitrary/);
 assert.match(translationReply('Translate where is baggage claim and write a poem').reply, /does not translate arbitrary/);
 assert.match(translationReply('Translate water please', 'invalid').reply, /Japanese and Spanish only/);
});
