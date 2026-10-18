import test from 'node:test';
import assert from 'node:assert/strict';
import { mealServiceIntent, mealServiceReply } from './meals.mjs';
test('recognizes lookups and leaves urgent help and crew requests alone', () => {
 for (const q of ['Are vegetarian meals available?', 'What is the menu?', 'Is Wi-Fi available?', 'What drinks do you have?', 'Are blankets available?']) assert.equal(mealServiceIntent(q), true, q);
 for (const q of ['Please bring a blanket', 'Could I have a pillow?', 'Medical emergency after my meal', 'Where is airport food?', 'Email the menu', '2+2']) assert.equal(mealServiceIntent(q), false, q);
});
test('stock scenarios and landed status are honored without changing inventory', () => {
 assert.match(mealServiceReply('menu', 'available').reply, /pasta: 12/);
 assert.match(mealServiceReply('menu', 'limited').reply, /pasta: 1 portions/);
 assert.match(mealServiceReply('menu', 'unavailable').reply, /pasta: 0/);
 assert.match(mealServiceReply('menu', 'available', 'landed').reply, /service has ended/);
 const before = mealServiceReply('menu', 'limited');
 assert.deepEqual(mealServiceReply('Order vegetarian food', 'limited'), before);
 assert.match(before.reply, /nothing is reserved, ordered/);
 assert.match(mealServiceReply('menu', '__proto__').reply, /Select Available/);
});
test('services and dietary uncertainty are explicit', () => {
 assert.match(mealServiceReply('Wi-Fi').reply, /Wi-Fi is shown as unavailable/);
 assert.match(mealServiceReply('Any pillows?', 'limited').reply, /0 pillows/);
 assert.match(mealServiceReply('drinks', 'unavailable').reply, /drinks service is unavailable/);
 assert.match(mealServiceReply('nut allergy').reply, /cannot confirm dietary safety/);
 assert.match(mealServiceReply('When is the meal?').reply, /one hour after takeoff/);
 assert.match(mealServiceReply('NH110 meals').reply, /another flight/);
});
