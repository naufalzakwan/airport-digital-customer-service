// Offline validation of keys and interpolation tokens across bundled locales.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', '..', 'src', 'locales');
const locales = ['id', 'en', 'fr', 'ja', 'ar', 'zh-CN'];
const read = name => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
const base = read('id');
for (const locale of locales) {
  const data = read(locale);
  assert.deepEqual(Object.keys(data).sort(), Object.keys(base).sort(), `keys: ${locale}`);
  for (const key of Object.keys(base)) {
    assert.equal(typeof data[key], 'string');
    assert(data[key].trim(), `empty: ${locale}.${key}`);
    const args = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(args(data[key]), args(base[key]), `parameters: ${locale}.${key}`);
  }
}
console.log(`Passenger locale dictionaries passed: ${locales.length} locales, ${Object.keys(base).length} keys each.`);
