// Reply-language rules sent to Gemini. Run: npm test
import test from 'node:test';
import assert from 'node:assert';
import { LANGUAGES, languageRule } from '../renderer/languages.js';

test('99 Gemini Live languages, no duplicate codes', () => {
  assert.strictEqual(LANGUAGES.length, 99);
  assert.strictEqual(new Set(LANGUAGES.map(([code]) => code)).size, 99);
});

test('picked languages: only those, and a mis-heard language falls back to the main one', () => {
  const rule = languageRule('ta', 'en');
  assert.match(rule, /speaks Tamil and English/);
  assert.match(rule, /Never reply in any language other than Tamil or English/);
  assert.match(rule, /reply in Tamil\./);
  assert.match(languageRule('hi', ''), /Always reply in natural spoken Hindi only/);
  assert.strictEqual(languageRule('hi', 'hi'), languageRule('hi', '')); // same language twice = one
});

test('auto or unknown codes use the follow-the-conversation rule', () => {
  for (const main of ['auto', 'xx', undefined]) assert.match(languageRule(main), /STAY in it/);
});
