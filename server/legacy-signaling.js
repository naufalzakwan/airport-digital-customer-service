const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shortId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);

function parseSignal(data, sender, hangup = false) {
  if (!isObject(data) || !shortId(data.to) || data.to === sender || (data.from !== undefined && data.from !== sender)) return null;
  const packet = { from: sender, to: data.to };
  if (hangup) return packet;
  const { type } = data;
  if (type === 'offer' || type === 'answer') {
    const description = data[type];
    if (!isObject(description) || description.type !== type || typeof description.sdp !== 'string' || !description.sdp.trim() || description.sdp.length > 100000) return null;
    return { ...packet, type, [type]: { type, sdp: description.sdp } };
  }
  const candidate = data.candidate;
  if (type !== 'ice-candidate' || !isObject(candidate) || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096) return null;
  const { sdpMid, sdpMLineIndex, usernameFragment } = candidate;
  if (sdpMid != null && (typeof sdpMid !== 'string' || sdpMid.length > 256)) return null;
  if (sdpMLineIndex != null && (!Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 65535)) return null;
  if (usernameFragment != null && (typeof usernameFragment !== 'string' || usernameFragment.length > 256)) return null;
  return { ...packet, type, candidate: { candidate: candidate.candidate, sdpMid, sdpMLineIndex, usernameFragment } };
}

function createLegacy(io) {
  const users = new Map();
  const pairs = new Map();
  const publishUsers = () => io.to('legacy-test').emit('users', [...users.values()]);
  const reply = (ack, ok) => { if (typeof ack === 'function') ack(ok ? { ok } : { ok, error: 'Legacy call is unavailable or invalid.' }); };
  const end = (pair, peer, sender) => {
    clearTimeout(pair.timer);
    pairs.delete(pair.caller);
    pairs.delete(pair.receiver);
    io.to(peer).emit('hangup', { from: sender });
  };
  return (socket, name) => {
    const id = socket.id;
    users.set(id, { id, name });
    socket.join('legacy-test');
    publishUsers();
    socket.on('signal', (data, ack) => {
      const packet = parseSignal(data, id);
      if (!packet || !users.has(packet.to)) return reply(ack, false);
      const pair = pairs.get(id);
      if (packet.type === 'offer') {
        if (pair || pairs.has(packet.to)) return reply(ack, false);
        const reservation = { caller: id, receiver: packet.to, answered: false };
        reservation.timer = setTimeout(() => {
          end(reservation, packet.to, id);
          socket.emit('hangup', { from: packet.to });
        }, 90000);
        reservation.timer.unref?.();
        pairs.set(id, reservation);
        pairs.set(packet.to, reservation);
      } else {
        if (!pair || pair !== pairs.get(packet.to)) return reply(ack, false);
        if (packet.type === 'answer') {
          if (id !== pair.receiver || pair.answered) return reply(ack, false);
          pair.answered = true;
          clearTimeout(pair.timer);
        }
      }
      io.to(packet.to).emit('signal', packet);
      reply(ack, true);
    });
    socket.on('hangup', (data, ack) => {
      const packet = parseSignal(data, id, true);
      const pair = pairs.get(id);
      if (!packet || !pair || pair !== pairs.get(packet.to)) return reply(ack, false);
      end(pair, packet.to, id);
      reply(ack, true);
    });
    socket.on('disconnect', () => {
      const pair = pairs.get(id);
      if (pair) end(pair, id === pair.caller ? pair.receiver : pair.caller, id);
      users.delete(id);
      publishUsers();
    });
  };
}

module.exports = { createLegacy, parseSignal };
