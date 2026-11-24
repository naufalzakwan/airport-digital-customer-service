// Run with: node server/tests/queue.integration.cjs
// Uses an isolated server and simulated Socket.IO clients; no browser or internet required.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { io } = require('socket.io-client');
const accessCode = randomUUID();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ack = (socket, event, data) => new Promise((resolve, reject) => socket.timeout(4000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));
const once = (socket, event, predicate = () => true, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timeout: ${event}`)); }, timeout);
  const listener = data => { if (predicate(data)) { clearTimeout(timer); socket.off(event, listener); resolve(data); } };
  socket.on(event, listener);
});
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function start(port) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ECHO_DB_PATH: ':memory:', OFFICER_ACCESS_CODE: accessCode }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timeout')), 5000); child.stdout.on('data', chunk => { if (chunk.toString().includes('Health check')) { clearTimeout(timer); resolve(); } }); child.on('error', reject); child.on('exit', code => { if (code) reject(new Error(`Server exited: ${code}`)); }); });
  return child;
}
async function stop(child) { if (child.exitCode !== null) return; const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }

(async () => {
  const port = await freePort(); let server = await start(port); const sockets = [];
  const connect = async (role, name, token) => {
    const socket = io(`http://127.0.0.1:${port}`, { query: { userId: randomUUID() }, forceNew: true, reconnection: false }); sockets.push(socket);
    await once(socket, 'connect'); const result = await ack(socket, 'queue:register', { role, name, token, accessCode: role === 'petugas' && !token ? accessCode : undefined }); assert.equal(result.ok, true); return { socket, result };
  };
  try {
    const a = await connect('petugas', 'Petugas A'), b = await connect('petugas', 'Petugas B'), p = await connect('penumpang', 'Penumpang');
    const joined = await ack(p.socket, 'queue:join', { language: 'Indonesia', serviceCategory: 'Lost & Found', passengerId: 'ignored' });
    assert.equal(joined.ok, true); assert.notEqual(joined.request.passengerId, 'ignored'); assert.equal(joined.request.passengerId, p.result.sessionId);
    assert.equal('token' in joined.request, false);
    const duplicate = await ack(p.socket, 'queue:join', { language: 'Indonesia', serviceCategory: 'Lost & Found' }); assert.equal(duplicate.request.requestId, joined.request.requestId);
    const attempts = await Promise.all([ack(a.socket, 'queue:accept', { requestId: joined.request.requestId }), ack(b.socket, 'queue:accept', { requestId: joined.request.requestId })]);
    assert.equal(attempts.filter(x => x.ok).length, 1); const winner = attempts[0].ok ? a : b;
    const accepted = attempts.find(x => x.ok).request; assert.equal(accepted.status, 'accepted'); assert.ok(accepted.callId); assert.equal('token' in accepted, false);
    assert.match((await ack(winner.socket, 'queue:logout', {})).error, /Selesaikan panggilan/);
    assert.equal((await ack(p.socket, 'queue:logout', {})).ok, false);
    const p2 = await connect('penumpang', 'Penumpang Kedua'); const j2 = await ack(p2.socket, 'queue:join', { language: 'English', serviceCategory: 'Flight Information' });
    const call = { callId: accepted.callId, generation: accepted.callGeneration };
    assert.equal((await ack(p2.socket, 'call:ready', call)).ok, false);
    assert.equal((await ack(p2.socket, 'call:end', { callId: call.callId, reason: 'hangup' })).ok, false);
    assert.equal((await ack(p.socket, 'call:ready', { ...call, generation: call.generation + 1 })).ok, false);
    assert.equal((await ack(winner.socket, 'call:signal', { ...call, type: 'offer', description: { type: 'offer', sdp: 'too-early' } })).ok, false);
    assert.equal((await ack(p2.socket, 'call:signal', { ...call, type: 'offer', description: { type: 'offer', sdp: 'spoof' }, from: accepted.officerId })).ok, false);
    assert.equal((await ack(p.socket, 'call:ready', call)).ok, true);
    const begin = once(p.socket, 'call:begin', event => event.callId === call.callId);
    assert.equal((await ack(winner.socket, 'call:ready', call)).ok, true); await begin;
    assert.equal((await ack(p.socket, 'call:signal', { ...call, type: 'offer', description: { type: 'offer', sdp: 'invalid-direction' } })).ok, false);
    const offered = once(p.socket, 'call:signal', event => event.callId === call.callId && event.type === 'offer');
    assert.equal((await ack(winner.socket, 'call:signal', { ...call, type: 'offer', description: { type: 'offer', sdp: 'test-sdp' } })).ok, true); await offered;
    assert.equal((await ack(p.socket, 'call:connected', call)).ok, true);
    assert.equal((await ack(winner.socket, 'call:connected', call)).ok, true);
    assert.match((await ack(winner.socket, 'queue:logout', {})).error, /Selesaikan panggilan/);
    assert.equal((await ack(p2.socket, 'queue:accept', { requestId: j2.request.requestId, role: 'petugas' })).ok, false);
    assert.equal((await ack(winner.socket, 'queue:accept', { requestId: j2.request.requestId })).ok, false);
    assert.equal((await ack(p.socket, 'queue:cancel', { requestId: joined.request.requestId })).ok, false);
    const end = await ack(winner.socket, 'call:end', { callId: call.callId, reason: 'hangup' }); assert.equal(end.request.status, 'completed'); assert.ok(end.request.callStartedAt); assert.ok(end.request.callEndedAt);
    const duplicateEnd = await ack(p.socket, 'call:end', { callId: call.callId, reason: 'hangup' }); assert.equal(duplicateEnd.ok, true); assert.equal(duplicateEnd.request.callEndedAt, end.request.callEndedAt);
    assert.equal((await ack(p2.socket, 'queue:cancel', { requestId: j2.request.requestId })).ok, true);
    const racePassenger = await connect('penumpang', 'Race'); const raceRequest = await ack(racePassenger.socket, 'queue:join', { language: 'Indonesia', serviceCategory: 'General Assistance' });
    const race = await Promise.all([ack(racePassenger.socket, 'queue:cancel', { requestId: raceRequest.request.requestId }), ack(a.socket, 'queue:accept', { requestId: raceRequest.request.requestId })]);
    assert.equal(race.filter(x => x.ok).length, 1);
    if (race[1].ok) await ack(a.socket, 'queue:release', { requestId: raceRequest.request.requestId });
    const p3 = await connect('penumpang', 'Reconnect'); const j3 = await ack(p3.socket, 'queue:join', { language: 'Indonesia', serviceCategory: 'General Assistance' });
    p3.socket.disconnect(); await delay(100);
    const p3again = await connect('penumpang', 'Reconnect', p3.result.token); assert.equal(p3again.result.request.requestId, j3.request.requestId);
    p3again.socket.disconnect(); await delay(100);
    assert.equal((await ack(a.socket, 'queue:reject', { requestId: j3.request.requestId })).ok, true);
    const p3last = await connect('penumpang', 'Reconnect', p3.result.token); assert.equal(p3last.result.request.status, 'rejected');
    assert.equal((await ack(p3last.socket, 'queue:dismiss', { requestId: j3.request.requestId })).ok, true);
    const p4 = await connect('penumpang', 'Expiry'); const j4 = await ack(p4.socket, 'queue:join', { language: '中文', serviceCategory: 'Accessibility Services' });
    const expired = once(a.socket, 'queue:snapshot', data => !data.requests.some(r => r.requestId === j4.request.requestId), 35000);
    p4.socket.disconnect(); await expired;
    const p5 = await connect('penumpang', 'Restart'); const j5 = await ack(p5.socket, 'queue:join', { language: 'Indonesia', serviceCategory: 'Lost & Found' }); assert.equal(j5.ok, true);
    assert.equal((await ack(a.socket, 'queue:logout', {})).ok, true);
    assert.equal((await ack(a.socket, 'queue:logout', {})).ok, true);
    assert.equal((await ack(a.socket, 'queue:reject', { requestId: j5.request.requestId })).ok, false);
    a.socket.disconnect();
    const replacement = await connect('petugas', 'Petugas Pengganti');
    assert.notEqual(replacement.result.sessionId, a.result.sessionId);
    assert.notEqual(replacement.result.token, a.result.token);
    assert.equal(replacement.result.requests[0]?.requestId, j5.request.requestId);
    for (const socket of sockets) socket.disconnect(); await stop(server); server = await start(port);
    const afterRestart = await connect('penumpang', 'Restart', p5.result.token); assert.equal(afterRestart.result.recovered, false); assert.equal(afterRestart.result.request, null);
    console.log('Queue integration passed: duplicate, atomic accept, busy, cancellation, reject, reconnect, expiry, officer logout, and restart.');
  } finally { for (const socket of sockets) socket.disconnect(); await stop(server); }
})().catch(error => { console.error(error); process.exitCode = 1; });
