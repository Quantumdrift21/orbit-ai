// Safety rules for the PC actions Gemini can call. Run: npm test
// (Only rejected cases are tested, so nothing is ever launched or opened.)
const test = require('node:test');
const assert = require('node:assert');
const { run, parseStartApps, setInstalledApps, findApp } = require('../actions');

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

// Shape of `Get-StartApps | ConvertTo-Json` output (with the BOM PowerShell may add).
const START_APPS =
  '\uFEFF' +
  JSON.stringify([
    { Name: 'Blender 5.2', AppID: '{6D809377}\\Blender\\blender-launcher.exe' },
    { Name: 'Visual Studio Code', AppID: 'Microsoft.VisualStudioCode' },
    { Name: 'Visual Studio Installer', AppID: '{7C5A40EF}\\Installer\\setup.exe' },
    { Name: 'Registry Editor', AppID: '{1AC14E77}\\regedit.exe' },
    { Name: 'Windows PowerShell', AppID: '{1AC14E77}\\WindowsPowerShell\\v1.0\\powershell.exe' },
    { Name: 'Uninstall Node.js', AppID: '{7C5A40EF}\\nodejs\\uninstall.exe' },
    { Name: '7-Zip Help', AppID: '{6D809377}\\7-Zip\\7-zip.chm' },
    { Name: 'Blender 5.2', AppID: 'duplicate' },
  ]);

test('detected apps: risky tools, help files and duplicates are dropped', () => {
  const names = parseStartApps(START_APPS).map((a) => a.name);
  assert.deepStrictEqual(names, ['Blender 5.2', 'Visual Studio Code', 'Visual Studio Installer']);
  // A single app comes back from PowerShell as an object, not an array.
  assert.strictEqual(parseStartApps(JSON.stringify({ Name: 'Paint', AppID: 'x' })).length, 1);
});

test('detected apps: spoken names match one app, or none', () => {
  setInstalledApps(parseStartApps(START_APPS));
  try {
    assert.strictEqual(findApp('blender').app.name, 'Blender 5.2');
    assert.strictEqual(findApp('Visual Studio Code').app.name, 'Visual Studio Code');
    assert.deepStrictEqual(findApp('visual studio').suggestions, ['Visual Studio Code', 'Visual Studio Installer']);
    for (const app of ['registry editor', 'powershell', 'uninstall node js', 'blender & calc', '']) {
      assert.strictEqual(run('open_app', { app }).ok, false, app);
    }
  } finally {
    setInstalledApps([]);
  }
});
