const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const loopback = host => ['127.0.0.1', '::1', '::ffff:127.0.0.1', '[::1]', 'localhost'].includes(host);
const officerCode = process.env.OFFICER_ACCESS_CODE;
const digest = value => createHash('sha256').update(value).digest();
const codeHash = officerCode?.length >= 16 && officerCode.length <= 128 ? digest(officerCode) : null;
const allowedOrigins = new Set((process.env.CLIENT_ORIGIN || '').split(',').map(value => value.trim()));
let failures = 0;
let failureWindow = 0;

function officerAccessAllowed(code) {
  if (!codeHash || typeof code !== 'string' || code.length < 16 || code.length > 128) return false;
  const now = Date.now();
  if (now >= failureWindow) { failureWindow = now + 60000; failures = 0; }
  if (failures >= 12) return false;
  if (timingSafeEqual(codeHash, digest(code))) return true;
  failures++;
  return false;
}

function allowTransport(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const { origin, host } = request.headers;
  const local = loopback(request.socket.remoteAddress);
  const proxyProtocol = local && request.headers['x-airport-proxy-protocol'];
  if (proxyProtocol === 'http' && request.headers['x-airport-loopback-client'] !== 'yes') return false;
  if (!origin) return local;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname)))) return false;
    return allowedOrigins.has(origin) || (local && url.host === host && (!proxyProtocol || url.protocol === `${proxyProtocol}:`));
  } catch { return false; }
}

function allowLegacy(request) {
  if (process.env.ENABLE_LEGACY !== 'true' || !loopback(request.socket.remoteAddress)) return false;
  const proxyProtocol = request.headers['x-airport-proxy-protocol'];
  if (proxyProtocol && (proxyProtocol !== 'http' || request.headers['x-airport-loopback-client'] !== 'yes')) return false;
  try {
    return loopback(new URL(`http://${request.headers.host}`).hostname)
      && (!request.headers.origin || loopback(new URL(request.headers.origin).hostname));
  }
  catch { return false; }
}

const officerGrantKey = token => codeHash && createHmac('sha256', codeHash).update(token).digest('hex');

module.exports = { allowTransport, allowLegacy, officerAccessAllowed, officerGrantKey };
