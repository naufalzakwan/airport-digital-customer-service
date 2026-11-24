const { randomUUID, randomBytes } = require('crypto');
const store = require('./call-store');
const { officerAccessAllowed, officerGrantKey } = require('./local-access');

// Queue sessions and requests are deliberately kept in one server's memory.
module.exports = function createQueue(io) {
  const sessions = new Map();
  const requests = new Map();
  const languages = new Set(['Francis', 'Indonesia', '日本語', 'العربية', 'English', '中文']);
  const categories = new Set(['Flight Information', 'Lost & Found', 'General Assistance', 'Accessibility Services']);
  const graceMs = 30000;
  const officerSessionMs = 8 * 60 * 60 * 1000;
  const active = request => request && (request.status === 'waiting' || request.status === 'accepted');
  const currentSocket = session => session?.socketId && io.sockets.sockets.get(session.socketId);
  const publicRequest = request => {
    const passenger = sessions.get(request.passengerId);
    const officer = sessions.get(request.officerId);
    return {
      requestId: request.requestId, passengerId: passenger?.id, passengerName: request.passengerName,
      language: request.language, serviceCategory: request.serviceCategory, waitingSince: request.waitingSince,
      status: request.status, passengerOnline: !!currentSocket(passenger),
      officerId: officer?.id || null, officerName: request.officerName, officerOnline: !!currentSocket(officer), callId: request.callId, referenceCode: request.referenceCode || null,
      callGeneration: request.callGeneration || 0, callStartedAt: request.callStartedAt || null,
      callEndedAt: request.callEndedAt || null, callEndReason: request.callEndReason || null,
      callFailureCode: request.callFailureCode || null, callFailedRole: request.callFailedRole || null,
      ...(request.status === 'accepted' ? { passengerSignalId: passenger?.signalId, officerSignalId: officer?.signalId } : {}),
    };
  };
  const snapshot = () => [...requests.values()].filter(r => r.status === 'waiting').sort((a, b) => a.waitingSince - b.waitingSince).map(publicRequest);
  const publishQueue = () => io.to('queue:officers').emit('queue:snapshot', { requests: snapshot(), serverNow: Date.now() });
  const sendState = request => {
    for (const id of [request.passengerId, request.officerId]) {
      if (!id) continue;
      currentSocket(sessions.get(id))?.emit('queue:state', { request: publicRequest(request), serverNow: Date.now() });
    }
  };
  const finish = (request, status) => {
    request.status = status;
    clearTimeout(request.callTimer);
    if (request.callId && !request.callEndedAt) request.callEndedAt = Date.now();
    if (request.callId) {
      try { store.finish(request); io.to('queue:officers').emit('history:updated'); }
      catch (error) { console.error('Gagal menyimpan status panggilan:', error.message); }
    }
    const passenger = sessions.get(request.passengerId);
    const officer = sessions.get(request.officerId);
    if (passenger) passenger.lastRequestId = request.requestId;
    if (officer) officer.lastRequestId = request.requestId;
    if (passenger?.activeRequestId === request.requestId) passenger.activeRequestId = null;
    if (officer?.activeRequestId === request.requestId) officer.activeRequestId = null;
    sendState(request);
    publishQueue();
    const timer = setTimeout(() => requests.delete(request.requestId), 5 * 60 * 1000);
    timer.unref?.();
  };
  const reply = (ack, result) => { if (typeof ack === 'function') ack(result); };
  const validSession = socket => {
    const session = sessions.get(socket.data.queueSessionId);
    if (session?.socketId === socket.id && (session.role !== 'petugas' || session.expiresAt > Date.now())) return session;
  };
  const expireOfficer = officer => {
    const socket = currentSocket(officer);
    const request = requests.get(officer.activeRequestId);
    if (active(request)) { request.callEndReason = 'disconnected'; finish(request, 'expired'); }
    clearTimeout(officer.timer);
    sessions.delete(officer.token);
    socket?.emit('queue:auth-expired');
    socket?.disconnect();
  };
  const callSession = (socket, data, ack) => {
    const session = validSession(socket);
    const request = session && requests.get(session.activeRequestId || session.lastRequestId);
    if (!session || session.socketId !== socket.id || !request || !data || data.callId !== request.callId || ![request.passengerId, request.officerId].includes(session.token)) {
      reply(ack, { ok: false, error: 'Panggilan tidak tersedia untuk sesi ini.' });
      return null;
    }
    return { session, request };
  };
  const startCallTimeout = request => {
    clearTimeout(request.callTimer);
    request.callTimer = setTimeout(() => {
      if (request.status === 'accepted' && !request.callConnected) { request.callEndReason = 'timeout'; finish(request, 'failed'); }
    }, 90000);
    request.callTimer.unref?.();
  };
  const requireRole = (socket, role, ack) => {
    const session = validSession(socket);
    if (!session || session.socketId !== socket.id || session.role !== role) {
      reply(ack, { ok: false, error: 'Sesi tidak tersedia. Hubungkan kembali dan coba lagi.' });
      return null;
    }
    return session;
  };

  return function attachQueue(socket) {
    socket.on('queue:register', (data, ack) => {
      if (!data || !['petugas', 'penumpang'].includes(data.role) || typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 80) {
        return reply(ack, { ok: false, error: 'Data sesi tidak valid.' });
      }
      if (socket.data.queueSessionId) return reply(ack, { ok: false, error: 'Sesi sudah terdaftar.' });
      const token = typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token) ? data.token : null;
      let existing = token && sessions.get(token);
      if (existing && existing.role !== data.role) return reply(ack, { ok: false, error: 'Role sesi tidak sesuai.' });
      if (existing?.role === 'petugas' && existing.expiresAt <= Date.now()) existing = null;
      if (!existing && token) {
        try {
          const saved = data.role === 'petugas' ? store.recoverOfficerGrant(officerGrantKey(token)) : store.recoverPassenger(token);
          if (saved) existing = { ...saved, token, role: data.role, activeRequestId: null, socketId: null, timer: null };
        } catch { return reply(ack, { ok: false, error: 'Penyimpanan sesi tidak tersedia.' }); }
      }
      if (!existing && data.role === 'petugas' && !officerAccessAllowed(data.accessCode)) {
        return reply(ack, { ok: false, code: 'OFFICER_AUTH', error: 'Kode akses tidak valid atau sesi berakhir. Masuk kembali sebagai petugas.' });
      }
      const recovered = !!existing;
      const session = existing || { id: randomUUID(), token: randomBytes(32).toString('hex'), role: data.role, name: data.name.trim(), activeRequestId: null, socketId: null, timer: null };
      if (session.role === 'petugas') {
        if (!existing) {
          session.expiresAt = Date.now() + officerSessionMs;
          try { store.saveOfficerGrant(officerGrantKey(session.token), session); }
          catch { return reply(ack, { ok: false, error: 'Penyimpanan sesi tidak tersedia.' }); }
        }
        if (!session.expiryTimer) {
          session.expiryTimer = setTimeout(() => expireOfficer(session), Math.max(0, session.expiresAt - Date.now()));
          session.expiryTimer.unref?.();
        }
      }
      sessions.set(session.token, session);
      clearTimeout(session.timer);
      const oldSocket = currentSocket(session);
      session.socketId = socket.id;
      session.signalId = socket.id;
      socket.data.queueSessionId = session.token;
      if (oldSocket && oldSocket.id !== socket.id) oldSocket.disconnect(true);
      if (session.role === 'petugas') socket.join('queue:officers');
      const request = requests.get(session.activeRequestId || session.lastRequestId);
      // A refreshed/reconnected participant needs a fresh peer negotiation on both ends.
      if (recovered && request?.status === 'accepted' && request.callId) {
        request.callGeneration += 1;
        request.callReady = new Set();
        request.callConnected = false;
        request.callPeersConnected = new Set();
        request.callBegun = false;
        startCallTimeout(request);
      }
      reply(ack, { ok: true, token: session.token, sessionId: session.id, recovered, name: session.name, request: request ? publicRequest(request) : null, requests: session.role === 'petugas' ? snapshot() : [], serverNow: Date.now() });
      if (active(request)) sendState(request);
      publishQueue();
    });

    socket.on('queue:logout', (_data, ack) => {
      if (socket.data.queueOfficerLoggedOut) return reply(ack, { ok: true });
      const officer = requireRole(socket, 'petugas', ack);
      if (!officer) return;
      if (active(requests.get(officer.activeRequestId))) {
        return reply(ack, { ok: false, error: 'Selesaikan panggilan atau persiapannya sebelum logout.' });
      }
      try { store.revokeOfficerGrant(officerGrantKey(officer.token)); }
      catch { return reply(ack, { ok: false, error: 'Sesi belum dapat ditutup. Coba lagi.' }); }
      clearTimeout(officer.timer);
      clearTimeout(officer.expiryTimer);
      sessions.delete(officer.token);
      socket.leave('queue:officers');
      socket.data.queueOfficerLoggedOut = true;
      reply(ack, { ok: true });
    });

    socket.on('queue:join', (data, ack) => {
      const passenger = requireRole(socket, 'penumpang', ack);
      if (!passenger) return;
      const existing = requests.get(passenger.activeRequestId);
      if (active(existing)) return reply(ack, { ok: true, request: publicRequest(existing), serverNow: Date.now() });
      if (!data || !languages.has(data.language) || !categories.has(data.serviceCategory)) return reply(ack, { ok: false, error: 'Bahasa atau kategori tidak valid.' });
      const request = { requestId: randomUUID(), passengerId: passenger.token, passengerName: passenger.name, language: data.language, serviceCategory: data.serviceCategory, waitingSince: Date.now(), status: 'waiting', officerId: null, officerName: null, callId: null };
      requests.set(request.requestId, request);
      passenger.lastRequestId = null;
      passenger.activeRequestId = request.requestId;
      reply(ack, { ok: true, request: publicRequest(request), serverNow: Date.now() });
      publishQueue();
    });

    socket.on('queue:cancel', (data, ack) => {
      const passenger = requireRole(socket, 'penumpang', ack);
      if (!passenger) return;
      const request = requests.get(data?.requestId);
      if (!request || request.passengerId !== passenger.token || request.status !== 'waiting') return reply(ack, { ok: false, error: 'Permintaan tidak lagi menunggu.' });
      finish(request, 'cancelled');
      reply(ack, { ok: true });
    });

    socket.on('queue:accept', (data, ack) => {
      const officer = requireRole(socket, 'petugas', ack);
      if (!officer) return;
      if (active(requests.get(officer.activeRequestId))) return reply(ack, { ok: false, error: 'Petugas masih menangani permintaan lain.' });
      const request = requests.get(data?.requestId);
      if (!request || request.status !== 'waiting') return reply(ack, { ok: false, error: 'Permintaan sudah tidak tersedia.' });
      if (!currentSocket(sessions.get(request.passengerId))) return reply(ack, { ok: false, error: 'Penumpang sedang terputus. Tunggu koneksi kembali.' });
      request.status = 'accepted';
      request.officerId = officer.token;
      request.officerName = officer.name;
      request.callId = randomUUID();
      request.callGeneration = 1;
      request.callReady = new Set();
      request.callPeersConnected = new Set();
      request.callConnected = false;
      request.callBegun = false;
      request.callStartedAt = null;
      request.callEndedAt = null;
      request.callEndReason = null;
      try { request.referenceCode = store.create(request, sessions.get(request.passengerId), officer); }
      catch (error) { request.status = 'waiting'; request.officerId = null; request.officerName = null; request.callId = null; return reply(ack, { ok: false, error: 'Penyimpanan lokal tidak tersedia. Coba lagi.' }); }
      startCallTimeout(request);
      officer.activeRequestId = request.requestId;
      reply(ack, { ok: true, request: publicRequest(request), serverNow: Date.now() });
      sendState(request);
      publishQueue();
    });

    socket.on('queue:reject', (data, ack) => {
      const officer = requireRole(socket, 'petugas', ack);
      if (!officer) return;
      if (active(requests.get(officer.activeRequestId))) return reply(ack, { ok: false, error: 'Petugas masih menangani permintaan lain.' });
      const request = requests.get(data?.requestId);
      if (!request || request.status !== 'waiting') return reply(ack, { ok: false, error: 'Permintaan sudah tidak tersedia.' });
      finish(request, 'rejected');
      reply(ack, { ok: true });
    });

    // Releases the reservation during this stage; no WebRTC call exists yet.
    socket.on('queue:release', (data, ack) => {
      const session = validSession(socket);
      const request = requests.get(data?.requestId);
      if (!session || session.socketId !== socket.id || !request || request.status !== 'accepted' || ![request.passengerId, request.officerId].includes(session.token)) return reply(ack, { ok: false, error: 'Persiapan panggilan tidak tersedia.' });
      finish(request, 'cancelled');
      reply(ack, { ok: true });
    });

    socket.on('call:ready', (data, ack) => {
      const pair = callSession(socket, data, ack);
      if (!pair) return;
      const { session, request } = pair;
      if (request.status !== 'accepted' || data.generation !== request.callGeneration) return reply(ack, { ok: false, error: 'Persiapan panggilan sudah berubah.', code: 'STALE_GENERATION' });
      request.callReady.add(session.token);
      reply(ack, { ok: true });
      if (!request.callBegun && request.callReady.has(request.passengerId) && request.callReady.has(request.officerId)) {
        request.callBegun = true;
        for (const id of [request.passengerId, request.officerId]) currentSocket(sessions.get(id))?.emit('call:begin', { callId: request.callId, generation: request.callGeneration });
      }
    });

    socket.on('call:signal', (data, ack) => {
      const pair = callSession(socket, data, ack);
      if (!pair) return;
      const { session, request } = pair;
      if (request.status !== 'accepted' || data.generation !== request.callGeneration) return reply(ack, { ok: false, error: 'Panggilan sudah berubah.', code: 'STALE_GENERATION' });
      if (!request.callBegun || !['offer', 'answer', 'ice-candidate'].includes(data.type)) return reply(ack, { ok: false, error: 'Sinyal panggilan tidak valid.' });
      if ((data.type === 'offer' && session.token !== request.officerId) || (data.type === 'answer' && session.token !== request.passengerId)) return reply(ack, { ok: false, error: 'Arah sinyal tidak valid.' });
      if (data.type === 'ice-candidate' ? (!data.candidate || typeof data.candidate.candidate !== 'string' || data.candidate.candidate.length > 4096) : (!data.description || data.description.type !== data.type || typeof data.description.sdp !== 'string' || data.description.sdp.length > 100000)) return reply(ack, { ok: false, error: 'Isi sinyal tidak valid.' });
      const recipientId = session.token === request.passengerId ? request.officerId : request.passengerId;
      const recipient = currentSocket(sessions.get(recipientId));
      if (!recipient) return reply(ack, { ok: false, error: 'Lawan bicara sedang terputus.', code: 'PEER_OFFLINE' });
      recipient.emit('call:signal', { callId: request.callId, generation: request.callGeneration, type: data.type, description: data.description, candidate: data.candidate });
      reply(ack, { ok: true });
    });

    socket.on('call:connected', (data, ack) => {
      const pair = callSession(socket, data, ack);
      if (!pair) return;
      const { session, request } = pair;
      if (request.status !== 'accepted' || data.generation !== request.callGeneration) return reply(ack, { ok: false, error: 'Panggilan sudah berubah.', code: 'STALE_GENERATION' });
      if (!request.callBegun) return reply(ack, { ok: false, error: 'Panggilan belum dimulai.' });
      request.callPeersConnected.add(session.token);
      if (request.callPeersConnected.has(request.passengerId) && request.callPeersConnected.has(request.officerId)) {
        request.callConnected = true;
        if (!request.callStartedAt) request.callStartedAt = Date.now();
        try { store.connected(request); } catch (error) { console.error('Gagal menyimpan waktu panggilan:', error.message); }
        clearTimeout(request.callTimer);
        sendState(request);
      }
      reply(ack, { ok: true });
    });

    socket.on('call:end', (data, ack) => {
      const pair = callSession(socket, data, ack);
      if (!pair) return;
      const { request, session } = pair;
      if (['completed', 'failed', 'expired'].includes(request.status)) return reply(ack, { ok: true, request: publicRequest(request), serverNow: Date.now() });
      if (request.status !== 'accepted') return reply(ack, { ok: false, error: 'Panggilan sudah berakhir.' });
      if (data.reason === 'failed' && data.generation !== request.callGeneration) return reply(ack, { ok: false, code: 'STALE_GENERATION', error: 'Panggilan sudah berubah.' });
      request.callEndReason = data.reason === 'failed' ? 'failed' : 'hangup';
      if (data.reason === 'failed') {
        request.callFailureCode = ['permission_denied', 'device_unavailable', 'connection_failed'].includes(data.failureCode) ? data.failureCode : 'connection_failed';
        request.callFailedRole = session.role;
      }
      finish(request, data.reason === 'failed' ? 'failed' : 'completed');
      reply(ack, { ok: true, request: publicRequest(request), serverNow: Date.now() });
    });

    socket.on('queue:dismiss', (data, ack) => {
      const session = validSession(socket);
      if (!session || session.socketId !== socket.id || session.lastRequestId !== data?.requestId) return reply(ack, { ok: false });
      session.lastRequestId = null;
      reply(ack, { ok: true });
    });

    socket.on('history:dashboard', (data, ack) => {
      const session = requireRole(socket, 'petugas', ack); if (!session) return;
      try { reply(ack, { ok: true, dashboard: store.dashboard(session.token, data) }); }
      catch { reply(ack, { ok: false, error: 'Riwayat tidak tersedia.' }); }
    });
    socket.on('history:call', (data, ack) => {
      const session = validSession(socket);
      if (!session || session.socketId !== socket.id) return reply(ack, { ok: false, error: 'Sesi tidak tersedia.' });
      try { const call = store.ownCall(session.token, session.role, data?.callId); if (call && session.role === 'penumpang') call.callNotes = ''; reply(ack, call ? { ok: true, call } : { ok: false, error: 'Panggilan tidak tersedia untuk sesi ini.' }); }
      catch { reply(ack, { ok: false, error: 'Panggilan tidak tersedia.' }); }
    });
    socket.on('history:notes', (data, ack) => {
      const session = requireRole(socket, 'petugas', ack); if (!session) return;
      try { const call = store.notes(session.token, data?.callId, data?.notes, data?.final === true); reply(ack, { ok: true, call }); if (data?.final === true) io.to('queue:officers').emit('history:updated'); }
      catch (error) { reply(ack, { ok: false, error: error.message || 'Gagal menyimpan catatan.' }); }
    });
    socket.on('history:rating', (data, ack) => {
      const session = requireRole(socket, 'penumpang', ack); if (!session) return;
      try { store.rating(session.token, data?.callId, data?.rating); reply(ack, { ok: true }); io.to('queue:officers').emit('history:updated'); }
      catch (error) { reply(ack, { ok: false, error: error.message || 'Gagal menyimpan penilaian.' }); }
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket.data.queueSessionId);
      if (!session || session.socketId !== socket.id) return;
      session.socketId = null;
      const activeRequest = requests.get(session.activeRequestId);
      if (activeRequest?.status === 'accepted') sendState(activeRequest);
      publishQueue();
      session.timer = setTimeout(() => {
        if (session.socketId) return;
        const request = requests.get(session.activeRequestId);
        if (active(request)) { if (request.callId) request.callEndReason = 'disconnected'; finish(request, 'expired'); }
        clearTimeout(session.expiryTimer);
        sessions.delete(session.token);
      }, graceMs);
      session.timer.unref?.();
    });
  };
};
