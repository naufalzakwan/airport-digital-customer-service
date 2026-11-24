const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const file = process.env.ECHO_DB_PATH || path.join(__dirname, 'data', 'echo-call.sqlite');
if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL');

const referenceDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: '2-digit',
});

function transaction(work, begin = 'BEGIN IMMEDIATE') {
  db.exec(begin);
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function allocateReference(timestamp) {
  const { day, month, year } = Object.fromEntries(referenceDate.formatToParts(timestamp).map(part => [part.type, part.value]));
  const date = `${day}${month}${year}`;
  const prefix = `CS-${date}-`;
  const next = db.prepare('UPDATE call_reference_sequences SET last_number = last_number + 1 WHERE day = ? RETURNING last_number').get(date)
    ?? db.prepare(`INSERT INTO call_reference_sequences (day, last_number)
      SELECT ?, COALESCE(MAX(CAST(substr(reference_code, 11) AS INTEGER)), 0) + 1 FROM calls WHERE reference_code GLOB ?
      RETURNING last_number`).get(date, `${prefix}*`);
  return `${prefix}${String(next.last_number).padStart(3, '0')}`;
}

const hasReferenceColumn = () => db.prepare('PRAGMA table_info(calls)').all().some(column => column.name === 'reference_code');
if (file !== ':memory:' && db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'calls'").get() && !hasReferenceColumn()) {
  const backupFile = path.resolve(`${file}.before-reference-${randomUUID()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backupFile);
}

transaction(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS calls (
    call_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, passenger_hash TEXT NOT NULL, officer_hash TEXT NOT NULL,
    passenger_session_id TEXT NOT NULL, officer_session_id TEXT NOT NULL,
    passenger_name TEXT NOT NULL, officer_name TEXT NOT NULL, language TEXT NOT NULL, service_category TEXT NOT NULL,
    connected_at INTEGER, ended_at INTEGER, duration_seconds INTEGER, notes TEXT NOT NULL DEFAULT '',
    notes_status TEXT NOT NULL DEFAULT 'draft', rating INTEGER CHECK(rating BETWEEN 1 AND 5),
    call_status TEXT NOT NULL DEFAULT 'accepted', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    reference_code TEXT
  );
  CREATE INDEX IF NOT EXISTS calls_officer ON calls(officer_hash, ended_at);
  CREATE INDEX IF NOT EXISTS calls_passenger ON calls(passenger_hash, ended_at);`);
  if (!hasReferenceColumn()) db.exec('ALTER TABLE calls ADD COLUMN reference_code TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS calls_reference_code ON calls(reference_code);
    CREATE TABLE IF NOT EXISTS call_reference_sequences (day TEXT PRIMARY KEY, last_number INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS calls_recent_page ON calls(ended_at DESC, call_id DESC)
      WHERE call_status = 'completed' AND connected_at IS NOT NULL AND notes_status = 'saved';
    CREATE TABLE IF NOT EXISTS recent_call_publications (
      revision INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS officer_grants (
      grant_key TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, expires_at INTEGER NOT NULL
    );`);
  const assign = db.prepare('UPDATE calls SET reference_code = ? WHERE call_id = ?');
  const historical = db.prepare('SELECT call_id, created_at FROM calls WHERE reference_code IS NULL ORDER BY created_at, call_id').all();
  for (const row of historical) assign.run(allocateReference(row.created_at), row.call_id);
});
const hash = token => createHash('sha256').update(token).digest('hex');
const get = id => db.prepare('SELECT * FROM calls WHERE call_id = ?').get(id);
const publicCall = row => row && ({ callId: row.call_id, referenceCode: row.reference_code, requestId: row.request_id, passengerName: row.passenger_name, officerName: row.officer_name, language: row.language, serviceCategory: row.service_category, connectedAt: row.connected_at, endedAt: row.ended_at, durationSeconds: row.duration_seconds, callNotes: row.notes, notesStatus: row.notes_status, rating: row.rating, callStatus: row.call_status, createdAt: row.created_at, updatedAt: row.updated_at });
const recentPageSize = 5;
const recentScope = `FROM calls AS c LEFT JOIN recent_call_publications AS p ON p.call_id = c.call_id
  WHERE c.call_status = 'completed' AND c.connected_at IS NOT NULL AND c.notes_status = 'saved'
  AND (p.revision IS NULL OR p.revision <= ?)`;
module.exports = {
  saveOfficerGrant(key, { id, name, expiresAt }) {
    transaction(() => {
      db.prepare('DELETE FROM officer_grants WHERE expires_at <= ?').run(Date.now());
      db.prepare('INSERT INTO officer_grants (grant_key,id,name,expires_at) VALUES (?,?,?,?)').run(key, id, name, expiresAt);
    });
  },
  recoverOfficerGrant(key) {
    return db.prepare('SELECT id,name,expires_at AS expiresAt FROM officer_grants WHERE grant_key = ? AND expires_at > ?').get(key, Date.now());
  },
  revokeOfficerGrant(key) { db.prepare('DELETE FROM officer_grants WHERE grant_key = ?').run(key); },
  create(request, passenger, officer) {
    return transaction(() => {
      const existing = get(request.callId);
      if (existing) return existing.reference_code;
      const now = Date.now();
      const reference = allocateReference(now);
      db.prepare(`INSERT INTO calls(call_id,request_id,passenger_hash,officer_hash,passenger_session_id,officer_session_id,passenger_name,officer_name,language,service_category,created_at,updated_at,reference_code)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(request.callId, request.requestId, hash(passenger.token), hash(officer.token), passenger.id, officer.id, request.passengerName, request.officerName, request.language, request.serviceCategory, now, now, reference);
      return reference;
    });
  },
  connected(request) { db.prepare('UPDATE calls SET connected_at=COALESCE(connected_at,?), updated_at=? WHERE call_id=?').run(request.callStartedAt, Date.now(), request.callId); },
  finish(request) {
    const duration = request.callStartedAt ? Math.max(0, Math.floor((request.callEndedAt - request.callStartedAt) / 1000)) : null;
    db.prepare('UPDATE calls SET connected_at=?, ended_at=?, duration_seconds=?, call_status=?, updated_at=? WHERE call_id=? AND ended_at IS NULL').run(request.callStartedAt || null, request.callEndedAt, duration, request.status, Date.now(), request.callId);
  },
  recoverPassenger(token) {
    const h = hash(token);
    const row = db.prepare('SELECT passenger_session_id, passenger_name FROM calls WHERE passenger_hash=? ORDER BY updated_at DESC LIMIT 1').get(h);
    if (!row) return null;
    return { id: row.passenger_session_id, name: row.passenger_name };
  },
  notes(token, id, notes, final) {
    return transaction(() => {
      const row = get(id);
      if (!row || row.officer_hash !== hash(token)) throw new Error('Catatan tidak tersedia untuk sesi ini.');
      if (typeof notes !== 'string' || notes.length > 4000) throw new Error('Catatan tidak valid.');
      if (row.notes_status === 'saved') { if (final && row.notes === notes) return publicCall(row); throw new Error('Catatan final sudah disimpan.'); }
      if (final && (!row.connected_at || row.call_status !== 'completed')) throw new Error('Panggilan belum selesai dengan sukses.');
      db.prepare('UPDATE calls SET notes=?, notes_status=?, updated_at=? WHERE call_id=?').run(notes, final ? 'saved' : 'draft', Date.now(), id);
      if (final) db.prepare('INSERT INTO recent_call_publications (call_id) VALUES (?)').run(id);
      return publicCall(get(id));
    });
  },
  rating(token, id, rating) {
    const row = get(id);
    if (!row || row.passenger_hash !== hash(token)) throw new Error('Penilaian tidak tersedia untuk sesi ini.');
    if (!row.connected_at || row.call_status !== 'completed') throw new Error('Panggilan belum selesai dengan sukses.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Penilaian harus antara 1 dan 5.');
    if (row.rating !== null && row.rating !== rating) throw new Error('Penilaian sudah dikirim.');
    if (row.rating === null) db.prepare('UPDATE calls SET rating=?, updated_at=? WHERE call_id=?').run(rating, Date.now(), id);
    return publicCall(get(id));
  },
  ownCall(token, role, id) {
    const row = get(id);
    if (!row || row[role === 'petugas' ? 'officer_hash' : 'passenger_hash'] !== hash(token)) return null;
    return publicCall(row);
  },
  dashboard(token, data) {
    const page = Number.isSafeInteger(data?.page) && data.page > 0 ? data.page : 1;
    return transaction(() => {
      const latest = db.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM recent_call_publications').get().revision;
      const snapshot = page > 1 && Number.isSafeInteger(data?.recentSnapshot) && data.recentSnapshot >= 0
        ? Math.min(data.recentSnapshot, latest) : latest;
      const recentTotal = db.prepare(`SELECT COUNT(*) AS total ${recentScope}`).get(snapshot).total;
      const recentPage = Math.min(page, Math.max(1, Math.ceil(recentTotal / recentPageSize)));
      const recent = db.prepare(`SELECT c.* ${recentScope}
        ORDER BY c.ended_at DESC, c.call_id DESC LIMIT ? OFFSET ?`)
        .all(snapshot, recentPageSize, (recentPage - 1) * recentPageSize).map(publicCall);

      const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      const today = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(duration_seconds),0) AS total, COALESCE(AVG(duration_seconds),0) AS average FROM calls WHERE call_status='completed' AND connected_at IS NOT NULL AND ended_at>=? AND ended_at<?").get(start,end);
      const ratings = db.prepare("SELECT AVG(rating) AS average, COUNT(rating) AS count FROM calls WHERE call_status='completed' AND connected_at IS NOT NULL AND rating IS NOT NULL").get();
      const pending = db.prepare("SELECT * FROM calls WHERE officer_hash=? AND call_status='completed' AND connected_at IS NOT NULL AND notes_status='draft' ORDER BY ended_at DESC").all(hash(token));
      return { recent, recentTotal, recentPage, recentPageSize, recentSnapshot: snapshot, recentHasUpdates: latest > snapshot, pending: pending.map(publicCall), stats: { callToday: today.count, averageDurationSeconds: today.average, totalSecondsToday: today.total, averageRating: ratings.average, ratingCount: ratings.count } };
    }, 'BEGIN');
  },
};
