const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('package version follows semantic VERSION', () => {
  const version = read('VERSION').trim();
  assert.match(version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(JSON.parse(read('package.json')).version, version);
});

test('packaging includes only generated extension assets and rejects inconsistent builds', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rudolph-package-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.writeFileSync(path.join(fixture, file), value);
  };
  write('package.sh', read('package.sh'));
  write('VERSION', '1.2.3\n');
  write('package.json', JSON.stringify({ version: '1.2.3' }));
  write('src/private-not-for-distribution.txt', 'source file');
  // The fixture stands in for WXT so this packaging regression stays offline.
  write('bin/npm', '#!/bin/sh\n[ "$1" = run ] && [ "$2" = build ] || exit 1\n');
  fs.chmodSync(path.join(fixture, 'bin/npm'), 0o755);
  const manifest = { version: '1.2.3', chrome_url_overrides: { newtab: 'newtab.html' } };
  write('build/chrome-mv3/manifest.json', JSON.stringify(manifest));
  write('build/chrome-mv3/newtab.html', '<script src="chunks/app.js"></script>');
  write('build/chrome-mv3/chunks/app.js', 'console.log("fixture");');
  const env = { ...process.env, PATH: `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH}` };
  const run = () => spawnSync('bash', ['package.sh'], { cwd: fixture, env, encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  const zip = path.join(fixture, 'dist/Rudolph-1.2.3-chrome-extension.zip');
  const entries = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', zip], { encoding: 'utf8' }));
  assert.deepEqual(entries.sort(), ['chunks/app.js', 'manifest.json', 'newtab.html']);
  const original = fs.readFileSync(zip);
  write('build/chrome-mv3/manifest.json', JSON.stringify({ ...manifest, version: '1.2.2' }));
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated manifest version does not match VERSION/);
  assert.deepEqual(fs.readFileSync(zip), original);
  write('build/chrome-mv3/manifest.json', JSON.stringify(manifest));
  fs.symlinkSync(path.join(fixture, 'src/private-not-for-distribution.txt'), path.join(fixture, 'build/chrome-mv3/source-link'));
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not contain symbolic links/);
  assert.deepEqual(fs.readFileSync(zip), original);
});

test('release retains signed semver tags and a single package asset', () => {
  const script = read('release.sh');
  assert.match(script, /package\.json version.*does not match VERSION/);
  assert.match(script, /TAG_NAME="v\$\{VERSION\}"/);
  assert.match(script, /git tag -s "\$\{TAG_NAME\}"/);
  assert.match(script, /git tag -v "\$\{TAG_NAME\}"/);
  assert.match(script, /generate_release_notes/);
  assert.match(script, /upload_asset "\$\{ZIP_PATH\}" "application\/zip"/);
  assert.doesNotMatch(script, /SHA_PATH/);
});
