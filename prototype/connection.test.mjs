import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionIntent, connectionReply } from './connection.mjs';
test('routes connection questions before broader status and tracking', () => {
 for (const q of ['Where do I go for my next flight?', 'Will I miss my connection if delayed?', 'When does my connecting flight board?', 'Transfer directions', 'How long is my layover?']) assert.equal(connectionIntent(q), true, q);
 for (const q of ['Where is my flight?', 'Weather for my connection', 'Email my connection', '2+2']) assert.equal(connectionIntent(q), false, q);
});
test('directions are explicitly fictional with the connecting gate', () => {
 const result = connectionReply('Where do I go for my next flight?', 'on-time');
 assert.match(result.reply, /CL 310.*Gate D12/);
 assert.match(result.reply, /transfer desk → transfer screening/);
 assert.match(result.reply, /not a real Haneda map/);
});
test('assesses all scenarios without guaranteeing or changing bookings', () => {
 assert.match(connectionReply('Will I make my connection?', 'on-time').reply, /75 minutes.*does not guarantee/);
 assert.match(connectionReply('Will I make my connection?', 'delayed').reply, /30 minutes.*cannot guarantee.*rebook/);
 assert.match(connectionReply('Will I make my connection?', 'landed').reply, /80 minutes.*Landing does not confirm/);
 assert.match(connectionReply('My connection', 'invalid').reply, /2:40 PM/);
});
test('does not use the fictional itinerary for another flight', () => {
 assert.match(connectionReply('Connection to NH110', 'delayed').reply, /cannot verify another/);
 assert.match(connectionReply('Connection CL310', 'on-time').reply, /4:10 PM/);
});
