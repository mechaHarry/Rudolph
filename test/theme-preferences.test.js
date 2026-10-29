const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('React theme preferences preserve saved appearance migrations and tolerate unavailable storage', () => {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/theme/preferences.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: module.exports,
    localStorage: { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('storage unavailable'); } },
  });
  const preferences = module.exports;
  for (const [family, appearance, expectedFamily, expectedAppearance] of [
    ['glass', 'dark', 'glass', 'dark'],
    ['carbon', 'auto', 'carbon', 'auto'],
    ['light', null, 'oneui', 'light'],
    ['dark', null, 'oneui', 'dark'],
    ['system', null, 'oneui', 'auto'],
    ['material', 'system', 'material', 'auto'],
    ['invalid', 'invalid', 'oneui', 'auto'],
    ['dark', 'invalid', 'oneui', 'auto'],
  ]) {
    const actual = preferences.normalizePreferences(family, appearance);
    assert.equal(actual.family, expectedFamily);
    assert.equal(actual.appearance, expectedAppearance);
  }
  assert.equal(preferences.readPreferences().family, 'oneui');
  assert.equal(preferences.readPreferences().appearance, 'auto');
  assert.doesNotThrow(() => preferences.savePreferences({ family: 'glass', appearance: 'dark' }));
});
