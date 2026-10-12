import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findKnowledge, knowledgeDocumentId, knowledgeRoute, knowledgeSystemContext, readKnowledgeDocument,
} from './knowledge.mjs';

test('routes representative passenger questions to all seven draft pages', async () => {
  const cases = [
    ['How do I check in?', 'before-travel'],
    ['What is my carry-on bag allowance?', 'baggage'],
    ['Can I use the lounge?', 'at-the-airport'],
    ['Is Wi-Fi available?', 'on-board'],
    ['My flight is delayed; what happens?', 'changes-and-disruptions'],
    ['Can I bring my service dog?', 'passenger-needs'],
    ['Where is baggage claim?', 'after-arrival'],
  ];
  for (const [message, id] of cases) {
    const result = await findKnowledge(message);
    assert.equal(result?.source.id, id, message);
    assert.ok(result.excerpt.length > 50, message);
    assert.equal(result.source.status, 'Draft guidance');
    assert.equal(result.source.review, 'Not yet reviewed');
    assert.equal(result.source.url, `/knowledge/${id}.md`);
    assert.match(knowledgeSystemContext(result), /not verified Cloudline Air policy/i);
  }
});

test('specific topics win over broader terms', async () => {
  assert.equal(knowledgeRoute('I missed my connection').question, 'What happens if I miss a connection?');
  assert.equal(knowledgeRoute('Can I bring my medication?').id, 'passenger-needs');
  assert.equal(knowledgeRoute('Where is my missing bag?').question, 'My bag has not arrived. What should I do?');
  assert.equal(knowledgeRoute('Can I request a special meal?').question, 'Can I request a special meal?');
  assert.equal(await findKnowledge('Tell me a joke'), null);
});

test('source documents are allowlisted and cannot escape the knowledge folder', async () => {
  assert.equal(knowledgeDocumentId('/knowledge/baggage.md'), 'baggage');
  assert.equal(knowledgeDocumentId('/knowledge/../README.md'), null);
  assert.equal(knowledgeDocumentId('/knowledge/.env.local'), null);
  assert.equal(await readKnowledgeDocument('../README'), null);
  assert.match(await readKnowledgeDocument('baggage'), /^# Baggage/m);
});
