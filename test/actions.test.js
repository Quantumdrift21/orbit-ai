// Safety rules for the PC actions Gemini can call. Run: npm test
// (Only rejected cases are tested, so nothing is ever launched or opened.)
const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../actions');

test('websites: only http(s) URLs are allowed', () => {
  for (const url of ['file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)', 'ms-settings:', 'not a url', '']) {
    assert.strictEqual(run('open_website', { url }).ok, false, url);
  }
});

test('apps: only the fixed list is allowed', () => {
  for (const app of ['regedit', 'powershell', 'chrome & calc', '../cmd', '']) {
    assert.strictEqual(run('open_app', { app }).ok, false, app);
  }
});

test('unknown actions are refused', () => {
  assert.strictEqual(run('delete_files', { path: 'C:/' }).ok, false);
});
