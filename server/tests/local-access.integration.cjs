const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');
const { DatabaseSync } = require('node:sqlite');
const { parseSignal } = require('../legacy-signaling');

test('legacy parser validates object, field type, size and sender binding', () => {
  for (const value of [null, [], 'text', 1, {}, { to: ['peer'] }]) {
    assert.equal(parseSignal(value, 'caller'), null);
    assert.equal(parseSignal(value, 'caller', true), null);
  }
  const offer = { type: 'offer', sdp: 'v=0' };
  assert.equal(parseSignal({ to: 'peer', type: 'offer', offer: { ...offer, sdp: 'x'.repeat(100001) } }, 'caller'), null);
  assert.equal(parseSignal({ to: 'peer', from: 'other' }, 'caller', true), null);
  assert.equal(parseSignal({ to: 'peer', type: 'ice-candidate', candidate: { candidate: 'test', sdpMLineIndex: -1 } }, 'caller'), null);
  assert.deepEqual(parseSignal({ to: 'peer', type: 'offer', offer }, 'caller'), { from: 'caller', to: 'peer', type: 'offer', offer });
});

test('local transport, officer grants, and legacy pair cleanup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-access-test-'));
  const database = path.join(directory, 'fixture.sqlite');
  const accessCode = randomBytes(24).toString('hex');
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const sockets = [];
  let server;

  async function start() {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CLIENT_ORIGIN: '', ECHO_DB_PATH: database, OFFICER_ACCESS_CODE: accessCode, ENABLE_LEGACY: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Backend startup timeout')), 5000);
      server.stdout.on('data', chunk => { if (chunk.toString().includes('Health check')) { clearTimeout(timeout); resolve(); } });
      server.once('error', error => { clearTimeout(timeout); reject(error); });
    });
  }
  async function stop() {
    for (const socket of sockets.splice(0)) socket.disconnect();
    if (server?.exitCode === null) { const closed = once(server, 'exit'); server.kill(); await closed; }
  }
  async function connect(options = {}, expected = 'connect') {
    const socket = io(origin, { autoConnect: false, forceNew: true, reconnection: false, timeout: 3000, ...options });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 4000);
      socket.once(expected, () => { clearTimeout(timer); resolve(); });
      socket.connect();
    });
    return socket;
  }
  const ack = (socket, event, data) => socket.timeout(5000).emitWithAck(event, data);
  const register = (socket, data) => ack(socket, 'queue:register', { role: 'petugas', name: 'Fixture Officer', ...data });
  try {
    await start();
    for (const transport of ['polling', 'websocket']) {
      const rejected = await connect({ transports: [transport], extraHeaders: { Origin: 'https://unexpected.test' } }, 'connect_error');
      assert.equal(rejected.connected, false);
      assert.equal((await connect({ transports: [transport], extraHeaders: { Origin: origin } })).connected, true);
    }
    const guest = await connect();
    assert.equal((await register(guest, {})).code, 'OFFICER_AUTH');
    assert.equal((await register(guest, { accessCode: randomBytes(24).toString('hex') })).code, 'OFFICER_AUTH');
    assert((await register(guest, { role: 'penumpang' })).ok);
    assert.equal((await ack(guest, 'history:dashboard', {})).ok, false);
    assert.equal((await ack(guest, 'history:notes', {})).ok, false);
    assert.equal((await ack(guest, 'history:call', {})).ok, false);

    const officer = await connect();
    const first = await register(officer, { accessCode });
    assert(first.ok);
    officer.disconnect();
    const reconnected = await connect();
    const recovered = await register(reconnected, { token: first.token, name: 'Different Display Label' });
    assert(recovered.recovered);
    assert.equal(recovered.name, 'Fixture Officer');
    assert.equal(recovered.sessionId, first.sessionId);
    assert((await ack(reconnected, 'history:dashboard', {})).ok);
    assert((await ack(reconnected, 'queue:logout', {})).ok);
    assert.equal((await ack(reconnected, 'history:dashboard', {})).ok, false);

    const next = await connect();
    const replacement = await register(next, { accessCode, name: 'Replacement Officer' });
    assert(replacement.ok);
    assert.equal(replacement.name, 'Replacement Officer');
    assert.notEqual(replacement.sessionId, first.sessionId);

    const legacy = await connect({ query: { mode: 'legacy', userId: 'Shared Display Label' } });
    const peer = await connect({ query: { mode: 'legacy', userId: 'Shared Display Label' } });
    assert.notEqual(legacy.id, peer.id);
    assert.equal((await ack(peer, 'hangup', { to: legacy.id })).ok, false);
    const forwarded = once(peer, 'signal');
    assert((await ack(legacy, 'signal', { to: peer.id, type: 'offer', offer: { type: 'offer', sdp: 'v=0' } })).ok);
    assert.equal((await forwarded)[0].from, legacy.id);
    const ended = once(peer, 'hangup');
    legacy.disconnect();
    await ended;
    const replacementPeer = await connect({ query: { mode: 'legacy', userId: 'Replacement Peer' } });
    assert((await ack(peer, 'signal', { to: replacementPeer.id, type: 'offer', offer: { type: 'offer', sdp: 'v=0' } })).ok);

    await stop();
    await start();
    const afterRestart = await connect();
    assert.equal((await register(afterRestart, { token: first.token })).code, 'OFFICER_AUTH');
    assert((await register(afterRestart, { token: replacement.token })).recovered);
    await stop();
    const sqlite = new DatabaseSync(database);
    try { sqlite.exec('UPDATE officer_grants SET expires_at = 0'); }
    finally { sqlite.close(); }
    await start();
    assert.equal((await register(await connect(), { token: replacement.token })).code, 'OFFICER_AUTH');
  } finally { await stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
