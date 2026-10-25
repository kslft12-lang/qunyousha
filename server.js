// 群友杀 - 联机服务器：静态文件 + WebSocket 房间 + 权威引擎
// 用法：node server.js [端口]   默认 8123
// 浏览器打开 http://localhost:8123 ，点「联机」加入；0 号位（房主）点开局，空座位由机器人代打。
// TODO(联机): WebSocket 为极简实现（未处理分片帧与压缩扩展），牌局消息都很小，够用
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8123;
const ROOT = __dirname;

// ---- 加载引擎（与 test/simulate.js 同法，不接触 DOM）----
for (const f of ['js/data/characters.js', 'js/data/cards.js', 'js/engine/core.js', 'js/engine/rules.js', 'js/adapter/bot.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

// ---- 极简 WebSocket（RFC6455 文本帧）----
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const acceptKey = key => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

function wsSendRaw(socket, op, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  socket.write(Buffer.concat([header, payload]));
}
const wsSend = (socket, str) => wsSendRaw(socket, 0x1, Buffer.from(str, 'utf8'));

function parseFrames(conn, onText) {
  for (;;) {
    const buf = conn.buf;
    if (buf.length < 2) return;
    const op = buf[0] & 0x0f;
    const masked = buf[1] & 0x80;
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    let mask = null;
    if (masked) { if (buf.length < off + 4) return; mask = buf.subarray(off, off + 4); off += 4; }
    if (buf.length < off + len) return;
    let payload = buf.subarray(off, off + len);
    if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
    conn.buf = buf.subarray(off + len);
    if (op === 0x8) { conn.alive = false; conn.socket.end(); return; }   // close
    if (op === 0x9) { wsSendRaw(conn.socket, 0xA, payload); continue; }  // ping -> pong
    if (op === 0xA) continue;                                            // pong
    if (op === 0x1) onText(conn, payload.toString('utf8'));              // text（假设不分片）
  }
}

// ---- 房间 ----
const room = {
  conns: new Map(),        // conn -> seat（加入顺序即座位号）
  game: null,
  started: false,
  disconnected: new Set(), // 掉线座位，后续提问直接按机器人默认作答
  playerCount: 5,
  nextSeat: 0,
  askSeq: 0,
};

function broadcastLobby() {
  const n = Math.max(room.conns.size, room.playerCount, room.nextSeat);
  const seats = [];
  for (let i = 0; i < n; i++) {
    let name = null;
    for (const [conn, seat] of room.conns) if (seat === i) { name = conn.name; break; }
    seats.push(name);
  }
  for (const conn of room.conns.keys())
    conn.send({ t: 'lobby', seats, started: !!(room.game && !room.game.over) });
}

function sendState(conn) {
  if (!room.game) return;
  const seat = room.started ? room.conns.get(conn) : null;
  conn.send({ t: 'state', snap: QYS.core.snapshot(room.game, seat) });
}
function broadcastStates() { for (const conn of room.conns.keys()) sendState(conn); }

function mapCard(p, v) {
  if (!v || !v.defId) return null;
  // 同 defId+花色+点数的牌在游戏中等价，取第一张即可
  return p.hand.find(c => c.defId === v.defId && c.suit === v.suit && c.number === v.number) || null;
}

// 远端玩家的问答适配器：把引擎提问转发给浏览器，等待点击回答
function netIoFor(conn, seat) {
  const ask = (method, args) => new Promise(resolve => {
    if (room.disconnected.has(seat)) return resolve(null);
    const id = 'a' + (++room.askSeq);
    const timer = setTimeout(() => {
      if (conn.pending[id]) {
        delete conn.pending[id];
        console.log(`座位 ${seat + 1} 应答超时，按默认处理`);
        resolve(defaultAnswer(method, args));
      }
    }, 90000);
    conn.pending[id] = v => { clearTimeout(timer); resolve(v); };
    conn.send({ t: 'ask', id, method, args });
  });
  return {
    async chooseCard(p, opts = {}) {
      const v = await ask('chooseCard', { tag: opts.tag || '', hint: opts.hint || '', cancelText: opts.cancelText });
      return mapCard(p, v);
    },
    async chooseBool(p, opts = {}) { return !!(await ask('chooseBool', { hint: opts.hint || '', cancelText: opts.cancelText })); },
    async chooseTargets(p, opts = {}) {
      const v = await ask('chooseTargets', {
        candidateSeats: (opts.candidates || []).map(c => c.seat),
        min: opts.min, max: opts.max, hint: opts.hint || '',
      });
      if (!Array.isArray(v)) return null;
      const players = v.map(s => room.game.players[s]).filter(Boolean);
      return players.length ? players : null;
    },
    async askPlay(p, opts = {}) {
      const v = await ask('askPlay', {
        playable: (opts.playable || []).map(it => ({ card: it.card })),
        canSkill: opts.canSkill, skillName: opts.skillName, hint: opts.hint || '',
      });
      if (!v) return { type: 'end' };
      if (v.type === 'card' && v.card) {
        const card = mapCard(p, v.card);
        return card ? { type: 'card', card } : { type: 'end' };
      }
      return v;
    },
  };
}
function defaultAnswer(method, args) {
  if (method === 'chooseTargets' && args.candidateSeats?.length) return [args.candidateSeats[0]];
  return null; // chooseCard→放弃 / bool→否 / askPlay→结束
}

function startGame(playerCount) {
  room.started = true;
  room.playerCount = playerCount;
  room.disconnected.clear();
  const seatConn = [];
  let humans = 0;
  for (const [conn, seat] of room.conns) if (seat < playerCount) { seatConn[seat] = conn; humans++; }
  room.game = QYS.core.createGame({
    playerCount,
    humanSeat: null,
    ioFor: p => (seatConn[p.seat] && !room.disconnected.has(p.seat)) ? netIoFor(seatConn[p.seat], p.seat) : QYS.bot.io(),
  });
  room.game.view = { render: broadcastStates };
  broadcastStates();
  console.log(`对局开始：${playerCount} 人（人类 ${humans}，机器人 ${playerCount - humans}）`);
  QYS.rules.run(room.game)
    .then(() => { console.log('对局结束：', room.game.winner); broadcastStates(); broadcastLobby(); })
    .catch(e => { console.error('对局异常：', e); broadcastStates(); });
}

function onMessage(conn, str) {
  let msg;
  try { msg = JSON.parse(str); } catch { return; }
  if (msg.t === 'join') {
    if (room.conns.has(conn)) return;
    const seat = room.nextSeat++;
    conn.name = String(msg.name || '').replace(/[<>&"']/g, '').slice(0, 8) || `玩家${seat + 1}`;
    conn.pending = {};
    room.conns.set(conn, seat);
    conn.send({ t: 'hello', seat });
    broadcastLobby();
    if (room.game) sendState(conn); // 中途加入 = 观战
    console.log(`${conn.name} 加入，座位 ${seat + 1}`);
  } else if (msg.t === 'start') {
    if (room.conns.get(conn) !== 0) return;
    if (room.game && !room.game.over) return;
    startGame(Math.max(2, Math.min(8, Number(msg.playerCount) || 5)));
  } else if (msg.t === 'answer') {
    const pend = conn.pending && conn.pending[msg.id];
    if (pend) { delete conn.pending[msg.id]; pend(msg.value === undefined ? null : msg.value); }
  }
}

function onConnection(conn) {
  conn.pending = {};
  conn.buf = Buffer.alloc(0);
  conn.send = obj => { if (conn.alive) wsSend(conn.socket, JSON.stringify(obj)); };
  conn.socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parseFrames(conn, onMessage); });
  const cleanup = () => {
    if (conn.alive === false) return;
    conn.alive = false;
    const seat = room.conns.get(conn);
    room.conns.delete(conn);
    if (seat != null && room.game && !room.game.over && seat < room.playerCount) {
      room.disconnected.add(seat);
      console.log(`座位 ${seat + 1} 掉线，由机器人代打`);
    }
    broadcastLobby();
  };
  conn.socket.on('close', cleanup);
  conn.socket.on('error', cleanup);
}

// ---- HTTP：静态文件 ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !req.headers.upgrade?.toLowerCase().includes('websocket')) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  onConnection({ socket, buf: Buffer.alloc(0), pending: {}, alive: true, send: null });
});

server.listen(PORT, () => {
  console.log(`群友杀服务器已启动：http://localhost:${PORT}`);
  console.log('同一局域网的群友用 http://<你的IP>:' + PORT + ' 访问并点「联机」');
});
