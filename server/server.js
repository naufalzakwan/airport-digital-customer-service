const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
require('dotenv').config();

const { allowTransport, allowLegacy } = require('./local-access');
const { createLegacy } = require('./legacy-signaling');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: (request, done) => done(null, { origin: allowTransport(request) && !!request.headers.origin ? request.headers.origin : false }),
  allowRequest: (request, done) => done(null, allowTransport(request)),
});
io.engine.use((request, _response, next) => next(allowTransport(request) ? undefined : new Error('Origin not allowed')));

const attachQueue = require('./queue')(io);
const attachLegacy = createLegacy(io);
io.use((socket, next) => {
  if (socket.handshake.query.mode !== 'legacy') return next();
  const name = socket.handshake.query.userId;
  if (!allowLegacy(socket.request) || typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    return next(new Error('Legacy testing is only available on enabled loopback connections.'));
  }
  socket.data.legacyName = name.trim();
  next();
});

io.on('connection', socket => {
  if (socket.data.legacyName) attachLegacy(socket, socket.data.legacyName);
  else attachQueue(socket);
});

app.get('/health', (_request, response) => response.json({ status: 'ok' }));

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Signaling listening on ${host}:${port}`);
  console.log('Health check: GET /health');
});

const stop = () => io.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
