// Browser control safety rules. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const br = require('../browser-rules');

test('never types into passwords, codes or payment fields', () => {
  assert.ok(br.isSecretField({ type: 'password' }));
  assert.ok(br.isSecretField({ autocomplete: 'cc-number' }));
  assert.ok(br.isSecretField({ name: 'cvv' }));
  assert.ok(br.isSecretField({ label: 'One-time code' }));
  assert.ok(br.isSecretField({ placeholder: 'Card number' }));
  assert.ok(!br.isSecretField({ type: 'text', name: 'q', label: 'Search' }));
  assert.ok(!br.isSecretField({ type: 'email', name: 'email' }));
});

test('clicks that buy, sign in, post or delete need the user first; ordinary ones do not', () => {
  assert.ok(br.clickRisk({ tag: 'button', text: 'Place order' }));
  assert.ok(br.clickRisk({ tag: 'a', text: 'Sign in' }));
  assert.ok(br.clickRisk({ tag: 'button', text: 'Delete repository' }));
  assert.ok(br.clickRisk({ tag: 'button', text: 'Next', inForm: true, formHasPassword: true }));
  assert.ok(br.clickRisk({ tag: 'button', text: 'Go', inForm: true })); // submits a form
  assert.strictEqual(br.clickRisk({ tag: 'a', text: 'Lo-fi hip hop radio' }), '');
  assert.strictEqual(br.clickRisk({ tag: 'button', text: 'Show more' }), '');
});

test('Enter in a search box is fine; in another form it needs the user', () => {
  assert.strictEqual(br.submitRisk({ type: 'search', inForm: true }), '');
  assert.strictEqual(br.submitRisk({ name: 'search_query', inForm: true }), '');
  assert.ok(br.submitRisk({ name: 'comment', inForm: true }));
  assert.ok(br.submitRisk({ name: 'username', inForm: true, formHasPassword: true }));
});

test('only http(s) URLs and known roles', () => {
  assert.strictEqual(br.safeUrl('https://www.youtube.com'), 'https://www.youtube.com/');
  assert.strictEqual(br.safeUrl('file:///C:/Windows/win.ini'), null);
  assert.strictEqual(br.safeUrl('javascript:alert(1)'), null);
  assert.strictEqual(br.safeUrl('not a url'), null);
  assert.strictEqual(br.validRole('button'), 'button');
  assert.strictEqual(br.validRole('script'), null);
});
