const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'call-reference-test-'));
const file = path.join(directory, 'legacy.sqlite');
const store = path.resolve(__dirname, '../call-store.js');
const beforeMidnight = Date.parse('2026-11-24T16:59:59Z');
const afterMidnight = Date.parse('2026-11-24T17:00:00Z');
const tokenHash = createHash('sha256').update('officer-token').digest('hex');

const worker = `
  const [storePath, time, id] = process.argv.slice(1);
  Date.now = () => Number(time);
  const store = require(storePath);
  const result = id ? store.create({ callId: id, requestId: id, passengerName: 'Passenger', officerName: 'Officer', language: 'Indonesia', serviceCategory: 'Lost & Found' },
    { token: 'passenger-token', id: 'passenger-session' }, { token: 'officer-token', id: 'officer-session' }) : store.ownCall('officer-token', 'petugas', 'legacy-a');
  process.stdout.write(JSON.stringify(result));
`;

function run(time, id = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', worker, store, String(time), id], {
      env: { ...process.env, ECHO_DB_PATH: file, TZ: 'UTC' },
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(errors));
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
}

async function verify() {
  const legacy = new DatabaseSync(file);
  try {
    legacy.exec(`CREATE TABLE calls (
      call_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, passenger_hash TEXT NOT NULL, officer_hash TEXT NOT NULL,
      passenger_session_id TEXT NOT NULL, officer_session_id TEXT NOT NULL,
      passenger_name TEXT NOT NULL, officer_name TEXT NOT NULL, language TEXT NOT NULL, service_category TEXT NOT NULL,
      connected_at INTEGER, ended_at INTEGER, duration_seconds INTEGER, notes TEXT NOT NULL DEFAULT '',
      notes_status TEXT NOT NULL DEFAULT 'draft', rating INTEGER CHECK(rating BETWEEN 1 AND 5),
      call_status TEXT NOT NULL DEFAULT 'accepted', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    const insert = legacy.prepare(`INSERT INTO calls VALUES
      (?, ?, 'passenger-hash', ?, 'passenger-session', 'officer-session', 'Passenger', 'Officer', 'Indonesia', 'Lost & Found',
       ?, ?, 12, 'Historical note', 'saved', 5, 'completed', ?, ?)`);
    for (const id of ['legacy-b', 'legacy-a']) {
      insert.run(id, `request-${id}`, tokenHash, beforeMidnight - 12000, beforeMidnight, beforeMidnight - 20000, beforeMidnight);
    }
  } finally { legacy.close(); }

  const record = await run(beforeMidnight);
  assert.equal(record.referenceCode, 'CS-241126-001');
  assert.equal(record.callId, 'legacy-a');
  assert.equal(record.requestId, 'request-legacy-a');
  assert.equal(record.callNotes, 'Historical note');
  assert.equal(record.notesStatus, 'saved');
  assert.equal(record.rating, 5);
  assert.equal(record.durationSeconds, 12);
  assert.equal(record.createdAt, beforeMidnight - 20000);
  assert.equal(record.updatedAt, beforeMidnight);
  assert.equal(record.officerName, 'Officer');

  const files = fs.readdirSync(directory).filter(name => name.includes('.before-reference-'));
  assert.equal(files.length, 1);
  const backup = new DatabaseSync(path.join(directory, files[0]), { readOnly: true });
  try {
    assert(!backup.prepare('PRAGMA table_info(calls)').all().some(column => column.name === 'reference_code'));
    assert.equal(backup.prepare('SELECT COUNT(*) AS total FROM calls').get().total, 2);
  } finally { backup.close(); }

  const firstId = randomUUID();
  const secondId = randomUUID();
  const concurrent = await Promise.all([run(beforeMidnight, firstId), run(beforeMidnight, secondId)]);
  assert.deepEqual([...concurrent].sort(), ['CS-241126-003', 'CS-241126-004']);
  assert.equal(await run(beforeMidnight, firstId), concurrent[0]);
  assert.equal(await run(beforeMidnight, randomUUID()), 'CS-241126-005');
  assert.equal(await run(afterMidnight, randomUUID()), 'CS-251126-001');

  const migrated = new DatabaseSync(file);
  try {
    assert.equal(migrated.prepare('SELECT reference_code FROM calls WHERE call_id = ?').get('legacy-b').reference_code, 'CS-241126-002');
    assert.throws(() => migrated.prepare('UPDATE calls SET reference_code = ? WHERE call_id = ?').run(record.referenceCode, 'legacy-b'), /UNIQUE/);
    migrated.prepare('UPDATE call_reference_sequences SET last_number = 999 WHERE day = ?').run('251126');
  } finally { migrated.close(); }
  assert.equal(await run(afterMidnight, randomUUID()), 'CS-251126-1000');
  assert.deepEqual(await run(afterMidnight), record);
  assert.equal(fs.readdirSync(directory).filter(name => name.includes('.before-reference-')).length, 1);
  console.log('Call reference integration passed: backup, stable backfill, Jakarta midnight, concurrent writes, restart, uniqueness, and suffix above 999.');
}

verify().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
