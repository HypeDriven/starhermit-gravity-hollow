// Gravity Hollow — StarHermit authoritative host (no dependencies).
//   node server.js [port]
//
// Serves the static distribution, exposes GET /api/v1/time for countdown and
// daily-boundary sync, and runs authoritative Realtime Rooms over /ws:
// lobby join, AI backfill, seat assignment, match start, high-frequency binary
// state frames, JSON lifecycle frames, reconnect snapshots, and results.
//
// Protocol (client→server, JSON text frames):
//   { op:"join", room:"name", name:"display" }   join or create a room
//   { op:"move", seq:n, dir:[-100..100,-100..100], boost:bool }
//   { op:"start" }                               host seat starts the match
//   { op:"leave" }
// Server→client:
//   JSON: { op:"joined", seat, room, host:bool }, { op:"roster", seats },
//         { op:"started" }, { op:"ended", rankings }, { op:"error", error }
//   Binary (15 Hz): 'S' | tick u32 | void count u8 | per void:
//         id u8, x f32, y f32, mass f32, flags u8 (bit0 alive)

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Rules from './src/rules.js';
import { dailyStage } from './src/content.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const TICK_MS = 1000 / Rules.TICK_RATE;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.opus': 'audio/ogg; codecs=opus',
};

// ------------------------------------------------------------ HTTP layer

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/v1/time') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ epochMs: Date.now() }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.includes('..')) { res.writeHead(403); res.end(); return; }
    if (path === '/' || path === '\\') path = '/index.html';
    const file = join(ROOT, path);
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const immutable = /\.(js|css|png|svg)$/.test(file) && path.includes('/vendor/');
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
});

// -------------------------------------------------------- WebSocket layer

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAccept(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}
function wsSend(sock, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | (Buffer.isBuffer(data) ? 2 : 1), len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | (Buffer.isBuffer(data) ? 2 : 1); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | (Buffer.isBuffer(data) ? 2 : 1); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  sock.write(Buffer.concat([header, payload]));
}
function wsClose(sock) { try { sock.write(Buffer.from([0x88, 0])); sock.end(); } catch {} }

// returns [messages, rest] — handles masked client text/binary frames
function wsDecode(buf) {
  const msgs = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const fin = (buf[off] & 0x80) !== 0;
    const op = buf[off] & 0x0f;
    const masked = (buf[off + 1] & 0x80) !== 0;
    let len = buf[off + 1] & 0x7f;
    let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const maskLen = masked ? 4 : 0;
    if (p + maskLen + len > buf.length) break;
    let payload = buf.subarray(p + maskLen, p + maskLen + len);
    if (masked) {
      const mask = buf.subarray(p, p + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    if (op === 8) msgs.push({ type: 'close' });
    else if (op === 9) msgs.push({ type: 'ping', payload });
    else if (fin && (op === 1 || op === 2)) msgs.push({ type: op === 1 ? 'text' : 'binary', payload });
    off = p + maskLen + len;
  }
  return [msgs, buf.subarray(off)];
}

// ---------------------------------------------------------------- rooms

const rooms = new Map(); // name -> room

function roomConfig(roomName) {
  // hosted quick matches use a deterministic per-room seed and 8 seats max
  const seed = [...roomName].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const base = dailyStage('2000-01-01'); // reusable, balanced ruleset shape
  return { ...base, id: `hosted-${roomName}`, seed, stageId: `hosted-${roomName}`, durationSec: 150 };
}

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, {
      name, clients: new Map(), state: null, timer: null, started: false,
      nextSeat: 0, hostId: null,
    });
  }
  return rooms.get(name);
}

function roster(room) {
  return [...room.clients.values()].map(c => ({ seat: c.seat, name: c.name, alive: true }));
}

function broadcast(room, fn) { for (const c of room.clients.values()) fn(c); }

function startMatch(room) {
  const seats = [...room.clients.values()];
  const rivals = [];
  // AI backfill to at least 4 voids
  const names = ['Pip', 'Sorrel', 'Bram', 'Nettle', 'Cobb', 'Wren', 'Tansy'];
  const humanCount = seats.length;
  for (let i = 0; i + humanCount < 4 && i < names.length; i++) {
    rivals.push({ name: names[i], skill: 0.5, massScale: 1 });
  }
  // map human seats to void ids 0..n-1, AI follows
  const cfg = roomConfig(room.name);
  const humansAsRivals = seats.slice(1).map(c => ({ name: c.name, skill: -1, massScale: 1 }));
  room.state = Rules.createMatch({
    ...cfg,
    playerName: seats[0]?.name ?? 'Host',
    rivals: [...humansAsRivals, ...rivals].slice(0, 7),
  });
  // mark human voids as non-AI and bind seats
  seats.forEach((c, i) => { c.voidId = i; room.state.voids[i].ai = false; room.state.voids[i].name = c.name; });
  room.started = true;
  broadcast(room, c => c.send({ op: 'started', seat: c.voidId }));
  let lastBin = 0;
  room.timer = setInterval(() => {
    const events = Rules.step(room.state);
    // relay events as JSON control frames (lifecycle) — never as truth source
    const interesting = events.filter(e => ['start', 'eat_void', 'goal', 'end'].includes(e.t));
    if (interesting.length) broadcast(room, c => c.send({ op: 'events', tick: room.state.tick, events: interesting }));
    if (room.state.tick - lastBin >= 2) { // 15 Hz binary state frames
      lastBin = room.state.tick;
      const frame = encodeStateFrame(room.state);
      broadcast(room, c => c.sendBinary(frame));
    }
    if (Rules.isTerminal(room.state)) {
      clearInterval(room.timer); room.timer = null;
      const rankings = Rules.rankings(room.state).map(r => ({ id: r.id, name: r.name, place: r.place, mass: r.massCollected }));
      broadcast(room, c => c.send({ op: 'ended', reason: Rules.terminalReason(room.state), rankings, hash: Rules.hashState(room.state) }));
      room.started = false;
    }
  }, TICK_MS);
}

function encodeStateFrame(state) {
  const n = state.voids.length;
  const buf = Buffer.alloc(1 + 4 + 1 + n * 14);
  let o = 0;
  buf.writeUInt8(0x53, o); o += 1;               // 'S'
  buf.writeUInt32BE(state.tick >>> 0, o); o += 4;
  buf.writeUInt8(n, o); o += 1;
  for (const v of state.voids) {
    buf.writeUInt8(v.id, o); o += 1;
    buf.writeFloatBE(v.x, o); o += 4;
    buf.writeFloatBE(v.y, o); o += 4;
    buf.writeFloatBE(v.mass, o); o += 4;
    buf.writeUInt8(v.alive ? 1 : 0, o); o += 1;
  }
  return buf;
}

server.on('upgrade', (req, sock) => {
  if (!req.url.startsWith('/ws')) { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`);
  sock.setNoDelay(true);

  const client = {
    sock, room: null, seat: -1, voidId: -1, name: 'guest', buf: Buffer.alloc(0),
    rate: [], // sliding window for rate limiting
    send(msg) { wsSend(sock, JSON.stringify(msg)); },
    sendBinary(buf) { if (sock.writable) wsSend(sock, buf); },
  };

  sock.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk]);
    if (client.buf.length > 65536) { wsClose(sock); return; } // payload size bound
    const [msgs, rest] = wsDecode(client.buf);
    client.buf = rest;
    for (const m of msgs) {
      if (m.type === 'close') { cleanup(client); wsClose(sock); return; }
      if (m.type === 'ping') { wsSend(sock, Buffer.concat([Buffer.from([0x8A, m.payload.length]), m.payload])); continue; }
      if (m.type !== 'text') continue;
      let msg;
      try { msg = JSON.parse(m.payload.toString()); } catch { client.send({ op: 'error', error: 'bad_json' }); continue; }
      handleMessage(client, msg);
    }
  });
  sock.on('error', () => cleanup(client));
  sock.on('close', () => cleanup(client));
});

function handleMessage(client, msg) {
  // rate limit: 120 messages per 10s
  const now = Date.now();
  client.rate = client.rate.filter(t => now - t < 10000);
  if (client.rate.length > 120) { client.send({ op: 'error', error: 'rate_limited' }); return; }
  client.rate.push(now);

  switch (msg.op) {
    case 'join': {
      if (typeof msg.room !== 'string' || msg.room.length > 32) { client.send({ op: 'error', error: 'bad_room' }); return; }
      const room = getRoom(msg.room);
      if (room.started) { client.send({ op: 'error', error: 'match_in_progress' }); return; }
      if (room.clients.size >= 8) { client.send({ op: 'error', error: 'room_full' }); return; }
      client.room = room;
      client.name = String(msg.name ?? 'guest').slice(0, 20);
      client.seat = room.nextSeat++;
      if (room.hostId == null) room.hostId = client.seat;
      room.clients.set(client.seat, client);
      client.send({ op: 'joined', seat: client.seat, room: room.name, host: room.hostId === client.seat });
      broadcast(room, c => c.send({ op: 'roster', seats: roster(room) }));
      break;
    }
    case 'start': {
      const room = client.room;
      if (!room || room.started) return;
      if (room.hostId !== client.seat) { client.send({ op: 'error', error: 'not_host' }); return; }
      startMatch(room);
      break;
    }
    case 'move': {
      const room = client.room;
      if (!room?.started || client.voidId < 0) return;
      const d = msg.dir;
      if (!Array.isArray(d) || d.length !== 2) return;
      // authoritative validation happens inside the rules engine
      Rules.applyCommand(room.state, {
        id: `ws-${client.seat}-${msg.seq}`, voidId: client.voidId, seq: msg.seq | 0,
        type: 'move', dir: [Number(d[0]) || 0, Number(d[1]) || 0], boost: !!msg.boost,
      });
      break;
    }
    case 'leave': cleanup(client); break;
    default: client.send({ op: 'error', error: 'unknown_op' });
  }
}

function cleanup(client) {
  const room = client.room;
  if (!room) return;
  room.clients.delete(client.seat);
  client.room = null;
  if (room.clients.size === 0) {
    if (room.timer) clearInterval(room.timer);
    rooms.delete(room.name);
  } else {
    if (room.hostId === client.seat) room.hostId = room.clients.keys().next().value;
    // the void stays in the match as an AI seat (abandonment policy)
    if (room.state && client.voidId >= 0) room.state.voids[client.voidId].ai = true;
    broadcast(room, c => c.send({ op: 'roster', seats: roster(room) }));
  }
}

server.listen(PORT, () => {
  console.log(`Gravity Hollow host on http://localhost:${PORT}`);
});
