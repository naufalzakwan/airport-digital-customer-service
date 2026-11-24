// Isolated integration test: temporary SQLite database, no real customer data.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { io } = require('socket.io-client');
const accessCode = randomUUID();
const dir = mkdtempSync(path.join(os.tmpdir(), 'echo-history-test-'));
const dbPath = path.join(dir, 'test.sqlite');
const ack = (s,e,d) => new Promise((resolve,reject)=>s.timeout(5000).emit(e,d,(err,result)=>err?reject(err):resolve(result)));
const event = (s,e) => new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`Timeout ${e}`)),5000);s.once(e,v=>{clearTimeout(t);resolve(v)})});
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function start(port){const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ECHO_DB_PATH:dbPath,OFFICER_ACCESS_CODE:accessCode},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Server timeout')),5000);child.stdout.on('data',s=>{if(s.toString().includes('Health check')){clearTimeout(t);resolve()}});child.on('error',reject);child.on('exit',c=>{if(c)reject(new Error(`Server exit ${c}`))})});return child}
async function stop(child){if(child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill();await done}
(async()=>{const port=await freePort();let server=await start(port);const sockets=[];
 const connect=async(role,name,token)=>{const s=io(`http://127.0.0.1:${port}`,{query:{userId:randomUUID()},forceNew:true,reconnection:false});sockets.push(s);await event(s,'connect');const r=await ack(s,'queue:register',{role,name,token,accessCode:role==='petugas'&&!token?accessCode:undefined});assert(r.ok);return {s,token:r.token,recovered:r.recovered,name:r.name}};
 try{
  const officer=await connect('petugas','Test Officer'), passenger=await connect('penumpang','Test Passenger'), other=await connect('penumpang','Other'), stranger=await connect('petugas','Other Officer');
  const empty = (await ack(officer.s, 'history:dashboard', { page: 20 })).dashboard;
  assert.equal(empty.recentTotal, 0);
  assert.equal(empty.recentPage, 1);
  assert.equal(empty.recent.length, 0);
  const joined=await ack(passenger.s,'queue:join',{language:'Indonesia',serviceCategory:'Flight Information'});const accepted=await ack(officer.s,'queue:accept',{requestId:joined.request.requestId});const id=accepted.request.callId;const call={callId:id,generation:accepted.request.callGeneration};
  const reference = accepted.request.referenceCode;
  assert.match(reference, /^CS-\d{6}-\d{3,}$/);
  assert.notEqual(reference, id);
  assert((await ack(officer.s,'history:notes',{callId:id,notes:'Draft',final:false})).ok);
  assert(!(await ack(stranger.s,'history:notes',{callId:id,notes:'Unauthorized',final:false})).ok);
  assert(!(await ack(passenger.s,'history:rating',{callId:id,rating:5})).ok);
  await ack(passenger.s,'call:ready',call);await ack(officer.s,'call:ready',call);await ack(officer.s,'call:connected',call);await ack(passenger.s,'call:connected',call);
  const ended=await ack(passenger.s,'call:end',{...call,reason:'hangup'});assert.equal(ended.request.status,'completed');
  assert.equal(ended.request.referenceCode, reference);
  assert(!(await ack(other.s,'history:rating',{callId:id,rating:5})).ok);
  assert(!(await ack(passenger.s,'history:rating',{callId:id,rating:6})).ok);
  assert((await ack(passenger.s,'history:rating',{callId:id,rating:4})).ok);assert((await ack(passenger.s,'history:rating',{callId:id,rating:4})).ok);assert(!(await ack(passenger.s,'history:rating',{callId:id,rating:3})).ok);
  let dashboard=(await ack(officer.s,'history:dashboard',{})).dashboard;assert.equal(dashboard.pending.length,1);assert.equal(dashboard.pending[0].callNotes,'Draft');assert.equal(dashboard.stats.callToday,1);assert.equal(dashboard.stats.averageRating,4);assert.equal(dashboard.stats.ratingCount,1);
  assert.equal(dashboard.pending[0].referenceCode, reference);
  assert((await ack(officer.s,'history:notes',{callId:id,notes:'Final note',final:true})).ok);assert((await ack(officer.s,'history:notes',{callId:id,notes:'Final note',final:true})).ok);assert(!(await ack(officer.s,'history:notes',{callId:id,notes:'Overwritten',final:false})).ok);
  dashboard=(await ack(officer.s,'history:dashboard',{})).dashboard;assert.equal(dashboard.recent.length,1);assert.equal(dashboard.recent[0].callNotes,'Final note');assert.equal((await ack(passenger.s,'history:call',{callId:id})).call.callNotes,'');
  assert.equal(dashboard.recentTotal, 1);
  const unconnected=await ack(other.s,'queue:join',{language:'English',serviceCategory:'Lost & Found'});const accepted2=await ack(stranger.s,'queue:accept',{requestId:unconnected.request.requestId});const second={callId:accepted2.request.callId,generation:accepted2.request.callGeneration};await ack(stranger.s,'call:end',{...second,reason:'hangup'});assert(!(await ack(other.s,'history:rating',{callId:second.callId,rating:5})).ok);assert(!(await ack(stranger.s,'history:notes',{callId:second.callId,notes:'x',final:true})).ok);assert.equal((await ack(officer.s,'history:dashboard',{})).dashboard.stats.callToday,1);
  for(const s of sockets)s.disconnect();await stop(server);server=await start(port);
  const restored=await connect('petugas','Different display name',officer.token);assert(restored.recovered);assert.equal(restored.name,'Test Officer');dashboard=(await ack(restored.s,'history:dashboard',{})).dashboard;assert.equal(dashboard.recent[0].callId,id);assert.equal(dashboard.recent[0].rating,4);assert.equal(dashboard.stats.callToday,1);
  assert.equal(dashboard.recent[0].referenceCode, reference);
  assert.equal((await ack(restored.s, 'history:call', { callId: id })).call.referenceCode, reference);
  const restoredPassenger=await connect('penumpang','Test Passenger',passenger.token);assert(restoredPassenger.recovered);assert((await ack(restoredPassenger.s,'history:rating',{callId:id,rating:4})).ok);
  const sqlite = new DatabaseSync(dbPath);
  try {
    const page = async (number, recentSnapshot) => (await ack(restored.s, 'history:dashboard', { page: number, recentSnapshot })).dashboard;
    const add = sqlite.prepare(`INSERT INTO calls (call_id, request_id, passenger_hash, officer_hash, passenger_session_id,
      officer_session_id, passenger_name, officer_name, language, service_category, connected_at, ended_at,
      created_at, updated_at, call_status, notes_status, reference_code)
      VALUES (?, ?, 'passenger-hash', ?, 'passenger-session', 'officer-session', 'Fixture Passenger', 'Test Officer', 'English',
      'Flight Information', ?, ?, ?, ?, 'completed', ?, ?)`);
    const officerHash = createHash('sha256').update(restored.token).digest('hex');
    const fixtureEnd = Date.now() + 1000;
    const fixtureId = index => `fixture-${String(index).padStart(4, '0')}`;
    const insert = (callId, endedAt, status, number) => add.run(callId, `request-${callId}`, officerHash,
      endedAt - 1000, endedAt, endedAt - 1000, endedAt, status, `CS-010107-${String(number).padStart(3, '0')}`);
    let inserted = 0;
    for (const total of [5, 6, 10, 11, 26, 111]) {
      while (inserted < total - 1) { ++inserted; insert(fixtureId(inserted), fixtureEnd, 'saved', inserted); }
      const first = await page(1);
      assert.equal(first.recentTotal, total);
      assert.equal(first.recentPageSize, 5);
      assert.equal(first.recent.length, 5);
      assert.equal(first.recent[0].callId, fixtureId(inserted));
      const pageCount = Math.ceil(total / 5);
      const last = await page(pageCount + 1, first.recentSnapshot);
      assert.equal(last.recentPage, pageCount);
      assert.equal(last.recent.length, total - (pageCount - 1) * 5);
    }
    const first = await page(1);
    const seen = first.recent.map(call => call.callId);
    for (let number = 2; number <= Math.ceil(first.recentTotal / 5); ++number) {
      seen.push(...(await page(number, first.recentSnapshot)).recent.map(call => call.callId));
    }
    assert.deepEqual(seen, [...Array.from({ length: inserted }, (_, index) => fixtureId(inserted - index)), id]);

    const fixed = await page(2, first.recentSnapshot);
    for (const [callId, time, number] of [['newest', fixtureEnd + 1, 200], ['fixture-0108-z', fixtureEnd, 201]]) {
      insert(callId, time, 'draft', number);
      assert((await ack(restored.s, 'history:notes', { callId, notes: 'Published', final: true })).ok);
    }
    const refreshed = await page(2, first.recentSnapshot);
    assert.deepEqual(refreshed.recent, fixed.recent);
    assert.equal(refreshed.recentTotal, 111);
    assert.equal(refreshed.recentHasUpdates, true);
    const latest = await page(1, first.recentSnapshot);
    assert.equal(latest.recentTotal, 113);
    assert.equal(latest.recent[0].callId, 'newest');
    assert.equal(latest.recentHasUpdates, false);
    assert(latest.recent.some(call => call.callId === 'fixture-0108-z'));
    sqlite.exec("DELETE FROM calls WHERE call_id GLOB 'fixture-*'");
    const clamped = await page(23, first.recentSnapshot);
    assert.equal(clamped.recentPage, 1);
    assert.deepEqual(clamped.recent.map(call => call.callId), [id]);
  } finally { sqlite.close(); }
  console.log('History integration passed: authorization, drafts, ratings, restart, and stable pagination including 111 calls, late saves and page clamping.');
 }finally{for(const s of sockets)s.disconnect();await stop(server);rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
