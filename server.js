// 群友杀 - 联机服务器：静态文件 + WebSocket 房间 + 权威引擎
// 用法：node server.js [端口]   默认 8123
// 房间模型：房主「创建新房间」得 4 位房间码，其他人凭码加入；同一房间昵称唯一。
// 房主离开时房主身份自动转移给剩余座位号最小的玩家；房间空了即解散。
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
const rooms = new Map(); // code -> room
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 去掉易混淆字符

const cleanName = s => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 8);
const cleanCode = s => String(s || '').toUpperCase().replace(/[^2-9A-HJKMNP-Z]/g, '').slice(0, 4);

function genCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  } while (rooms.has(code));
  return code;
}

function newRoom() {
  return {
    code: genCode(),
    conns: new Map(),        // conn -> seat
    nextSeat: 0,             // 仅递增；对局中后加入者座位号 >= playerCount，为观战
    hostSeat: 0,
    playerCount: 5,
    started: false,
    disconnected: new Set(), // 掉线座位，其提问按机器人默认作答
    rush: new Set(),         // 抢主公的座位（每次开局后清空）
    game: null,
    askSeq: 0,
  };
}

const roomOf = conn => (conn.room ? rooms.get(conn.room) || null : null);

function seatNames(room) {
  const n = Math.max(room.conns.size, room.started ? room.playerCount : 0, room.hostSeat + 1);
  const names = [];
  for (let i = 0; i < n; i++) {
    let name = null;
    for (const [conn, seat] of room.conns) if (seat === i) { name = conn.name; break; }
    names.push(name);
  }
  return names;
}

function broadcastLobby(room) {
  for (const conn of room.conns.keys())
    conn.send({
      t: 'lobby', code: room.code, seats: seatNames(room), hostSeat: room.hostSeat,
      rushSeats: [...room.rush],
      started: !!(room.game && !room.game.over),
    });
}

function sendState(conn) {
  const room = roomOf(conn);
  if (!room || !room.game) return;
  conn.send({ t: 'state', snap: QYS.core.snapshot(room.game, room.started ? room.conns.get(conn) : null) });
}
function broadcastStates(room) { for (const conn of room.conns.keys()) sendState(conn); }

function mapCard(p, v) {
  if (!v || !v.defId) return null;
  // 同 defId+花色+点数的牌在游戏中等价，取第一张即可
  return p.hand.find(c => c.defId === v.defId && c.suit === v.suit && c.number === v.number) || null;
}

// 远端玩家的问答适配器：把引擎提问转发给浏览器，等待点击回答
function netIoFor(room, conn, seat) {
  const ask = (method, args) => new Promise(resolve => {
    if (room.disconnected.has(seat)) return resolve(null);
    const id = 'a' + (++room.askSeq);
    const timer = setTimeout(() => {
      if (conn.pending[id]) {
        delete conn.pending[id];
        console.log(`[${room.code}] 座位 ${seat + 1} 应答超时，按默认处理`);
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

function startGame(room, playerCount) {
  room.started = true;
  room.playerCount = playerCount;
  room.disconnected.clear();
  // 抢主公结算：抢者中随机定主公；没人抢则全员随机
  const live = new Set(room.conns.values());
  const rushSeats = [...room.rush].filter(s => s < playerCount && live.has(s));
  const lordSeat = rushSeats.length
    ? rushSeats[(Math.random() * rushSeats.length) | 0]
    : (Math.random() * playerCount) | 0;
  room.rush.clear();
  const seatConn = [];
  let humans = 0;
  for (const [conn, seat] of room.conns) if (seat < playerCount) { seatConn[seat] = conn; humans++; }
  // 昵称：真人用加入时的昵称，机器人按座位顺序编号
  const names = [];
  let botSeq = 0;
  for (let s = 0; s < playerCount; s++) names[s] = seatConn[s] ? seatConn[s].name : `机器人${++botSeq}`;
  room.game = QYS.core.createGame({
    playerCount,
    humanSeat: null,
    lordSeat,
    names,
    ioFor: p => (seatConn[p.seat] && !room.disconnected.has(p.seat)) ? netIoFor(room, seatConn[p.seat], p.seat) : QYS.bot.io(),
  });
  room.game.view = { render: () => broadcastStates(room) };
  broadcastStates(room);
  console.log(`[${room.code}] 对局开始：${playerCount} 人（人类 ${humans}，机器人 ${playerCount - humans}）`);
  QYS.rules.run(room.game)
    .then(() => { console.log(`[${room.code}] 对局结束：`, room.game.winner); broadcastStates(room); broadcastLobby(room); })
    .catch(e => { console.error(`[${room.code}] 对局异常：`, e); broadcastStates(room); });
}

// 加入房间：对局中后加入为观战（座位号 >= playerCount）
function joinRoom(conn, room, name) {
  const seat = room.nextSeat++;
  conn.room = room.code;
  conn.name = name;
  conn.pending = {};
  room.conns.set(conn, seat);
  conn.send({ t: 'hello', seat, code: room.code });
  broadcastLobby(room);
  if (room.game) sendState(conn);
  console.log(`[${room.code}] ${name} 加入，座位 ${seat + 1}${room.game && !room.game.over ? '（观战）' : ''}`);
}

function onMessage(conn, str) {
  let msg;
  try { msg = JSON.parse(str); } catch { return; }

  if (msg.t === 'create') {
    if (roomOf(conn)) return;
    const name = cleanName(msg.name) || '玩家';
    const room = newRoom();
    rooms.set(room.code, room);
    joinRoom(conn, room, name);
    console.log(`[${room.code}] 房间创建，房主 ${name}`);
  } else if (msg.t === 'join') {
    if (roomOf(conn)) return;
    const name = cleanName(msg.name) || '玩家';
    const code = cleanCode(msg.code);
    const room = rooms.get(code);
    if (!room) return conn.send({ t: 'error', msg: '房间不存在或已解散，请核对房间码' });
    // 同一房间内昵称唯一（不区分大小写）
    for (const [c] of room.conns)
      if (c.name.toLowerCase() === name.toLowerCase())
        return conn.send({ t: 'error', msg: `房间内已有「${c.name}」，请换一个昵称` });
    joinRoom(conn, room, name);
  } else if (msg.t === 'start') {
    const room = roomOf(conn);
    if (!room) return;
    if (room.conns.get(conn) !== room.hostSeat) return;
    if (room.game && !room.game.over) return;
    startGame(room, Math.max(2, Math.min(8, Number(msg.playerCount) || 5)));
  } else if (msg.t === 'rush') {
    const room = roomOf(conn);
    if (!room) return;
    if (room.game && !room.game.over) return; // 对局进行中不改抢主公
    const seat = room.conns.get(conn);
    if (seat == null) return;
    if (msg.on) room.rush.add(seat); else room.rush.delete(seat);
    broadcastLobby(room);
  } else if (msg.t === 'answer') {
    const pend = conn.pending && conn.pending[msg.id];
    if (pend) { delete conn.pending[msg.id]; pend(msg.value === undefined ? null : msg.value); }
  }
}

function onConnection(conn) {
  conn.pending = {};
  conn.buf = Buffer.alloc(0);
  conn.alive = true;
  conn.send = obj => { if (conn.alive) wsSend(conn.socket, JSON.stringify(obj)); };
  conn.socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parseFrames(conn, onMessage); });
  const cleanup = () => {
    if (conn.alive === false && conn.socket.destroyed) return;
    conn.alive = false;
    const room = roomOf(conn);
    if (!room) return;
    const seat = room.conns.get(conn);
    room.conns.delete(conn);
    if (seat == null) return;
    if (room.game && !room.game.over && seat < room.playerCount) {
      room.disconnected.add(seat);
      console.log(`[${room.code}] 座位 ${seat + 1} 掉线，由机器人代打`);
    }
    if (room.conns.size === 0) {
      rooms.delete(room.code);
      console.log(`[${room.code}] 房间已空，解散`);
    } else {
      if (seat === room.hostSeat) {
        room.hostSeat = Math.min(...room.conns.values());
        console.log(`[${room.code}] 房主离开，房主转移给座位 ${room.hostSeat + 1}`);
      }
      broadcastLobby(room);
    }
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
    // 协商缓存：带 Last-Modified + no-cache，保证改完代码刷新页面即拿到新文件
    fs.stat(file, (e2, stat) => {
      const mtime = e2 ? null : stat.mtime.toUTCString();
      if (mtime && req.headers['if-modified-since'] === mtime) { res.writeHead(304); return res.end(); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Last-Modified': mtime || '',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
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
