// 群友杀 - 联机服务器冒烟测试：起真实 server.js，用 WebSocket 客户端走完整流程
// 用法：node test/smoke-server.js
// 覆盖：建房/加入/错误码、开局快照隐私、观战座位分配（不得占到玩家位）、
//       chooseCard 附带 okKeys、断线后询问立即结算且座位转机器人代打
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = 18234;
const URL = `ws://localhost:${PORT}`;
let server = null;

function makeClient(tag) {
  const ws = new WebSocket(URL);
  const q = [];
  const waiters = [];
  let msgCount = 0;
  const opened = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = e => rej(new Error('ws error: ' + (e.message || e.type)));
    setTimeout(() => rej(new Error('ws 连接超时')), 5000);
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    msgCount++;
    if (process.env.SMOKE_VERBOSE) console.log(`[client ${tag}] ← ${m.t}${m.id ? ' ' + m.id : ''}`);
    const i = waiters.findIndex(w => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else q.push(m);
  };
  return {
    ws,
    opened,
    send: o => ws.send(JSON.stringify(o)),
    wait: (pred, ms = 15000) => new Promise((res, rej) => {
      const i = q.findIndex(pred);
      if (i >= 0) return res(q.splice(i, 1)[0]);
      const entry = { pred, res: m => { clearTimeout(t); res(m); } };
      const t = setTimeout(() => {
        const k = waiters.indexOf(entry);
        if (k >= 0) waiters.splice(k, 1); // 超时必须摘除，否则僵尸 waiter 会偷走后续消息
        rej(new Error('等待消息超时'));
      }, ms);
      waiters.push(entry);
    }),
    dbg: () => ({ queued: q.length, waiters: waiters.length, ws: ws.readyState, msgs: ++msgCount }),
    close: () => ws.close(),
  };
}

async function waitHttpReady() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('服务器未在 5 秒内就绪');
}

const diag = { step: '启动服务器', clients: {} };

(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SMOKE_FAST: '1' } });
  server.serverLogs = [];
  const grab = tag => d => { const s = d.toString(); server.serverLogs.push(s); if (process.env.SMOKE_VERBOSE) process.stderr.write('[server] ' + s); };
  server.stdout.on('data', grab('out'));
  server.stderr.on('data', grab('err'));
  const kill = () => { try { server.kill(); } catch {} };
  process.on('exit', kill); // 测试进程无论正常/异常退出都带走子服务器
  await waitHttpReady();

  // ---- 1. 建房 / 加入 / 错误处理 ----
  const A = makeClient('A'); await A.opened;
  diag.clients.A = A; diag.step = '1.建房加入';
  A.send({ t: 'create', name: '甲' });
  const helloA = await A.wait(m => m.t === 'hello');
  const code = helloA.code;
  if (helloA.seat !== 0 || !/^[2-9A-HJKMNP-Z]{4}$/.test(code)) throw new Error('建房应得 0 号位与 4 位房间码: ' + JSON.stringify(helloA));

  const B0 = makeClient('B0'); await B0.opened;
  B0.send({ t: 'join', name: '乙', code: 'XXXX' });
  const err1 = await B0.wait(m => m.t === 'error');
  if (!/房间不存在/.test(err1.msg)) throw new Error('错误房间码应报错: ' + err1.msg);
  B0.send({ t: 'join', name: '甲', code });
  const err2 = await B0.wait(m => m.t === 'error');
  if (!/昵称/.test(err2.msg)) throw new Error('重复昵称应报错: ' + err2.msg);
  B0.close();

  const B = makeClient('B'); await B.opened;
  diag.clients.B = B; diag.step = '2.开局隐私';
  B.send({ t: 'join', name: '乙', code });
  const helloB = await B.wait(m => m.t === 'hello');
  if (helloB.seat !== 1) throw new Error('第二位加入者应为 1 号位');
  console.log('建房/加入/错误处理 ✓');

  // ---- 2. 开局：快照隐私 + 角色池（只给花生酱酱酱 → 另一玩家补路人群友） ----
  A.send({ t: 'start', playerCount: 2, chars: ['hsjjj'] });
  const stA = await A.wait(m => m.t === 'state' && m.snap.gameId === 1 && m.snap.players.length === 2);
  const stB = await B.wait(m => m.t === 'state' && m.snap.gameId === 1);
  const charIds = stA.snap.players.map(p => p.charId);
  if (!charIds.every(id => id === 'hsjjj' || id === 'luren')) throw new Error('角色池未生效: ' + charIds.join(','));
  if (!charIds.includes('luren')) throw new Error('池中唯一角色不足时应以路人群友补位');
  if (new Set(charIds.filter(id => id !== 'luren')).size !== charIds.filter(id => id !== 'luren').length) throw new Error('唯一性角色不应重复');
  if (!Array.isArray(stA.snap.players[0].hand) || stA.snap.players[0].hand.length !== 4) throw new Error('甲应看到自己 4 张起手牌');
  if (stA.snap.players[1].hand !== undefined) throw new Error('甲不应看到乙的手牌');
  if (stB.snap.players[0].hand !== undefined) throw new Error('乙不应看到甲的手牌');
  const lordSeat = stA.snap.lordSeat, nonLordSeat = 1 - lordSeat;
  if (stA.snap.players[lordSeat].identity !== '主') throw new Error('主公身份应公开');
  // 非主公位：是自己则可见（'反'），是对方则必须隐藏（null）
  const nonLordExpect = nonLordSeat === stA.snap.humanSeat ? '反' : null;
  if (stA.snap.players[nonLordSeat].identity !== nonLordExpect) {
    throw new Error('身份可见性错误: 座位' + nonLordSeat + ' 应为 ' + nonLordExpect + '，实际 ' + stA.snap.players[nonLordSeat].identity);
  }
  console.log('开局快照隐私 ✓（自己手牌可见，对方手牌/暗置身份不可见）');

  // ---- 3. 对局中加入：必须是观战座位（>= playerCount），快照无手牌 ----
  diag.step = '3.观战加入';
  const C = makeClient('C'); await C.opened;
  C.send({ t: 'join', name: '丙', code });
  const helloC = await C.wait(m => m.t === 'hello');
  if (helloC.seat < 2) throw new Error(`对局中加入者分到玩家座位 ${helloC.seat}，会泄漏该座位手牌/身份`);
  const stC = await C.wait(m => m.t === 'state');
  if (stC.snap.players.some(p => p.hand !== undefined)) throw new Error('观战者不应看到任何手牌');
  console.log('观战座位分配 ✓（加入者座位 ' + (helloC.seat + 1) + '，无手牌泄漏）');

  diag.clients.C = C;
  // ---- 4. 双端持续应答直到对局推进到第 4 回合（引擎对两端的提问次数不均，不能按固定次数泵）----
  diag.step = '4.问答推进';
  const seenOk = { value: false };
  const pumpOnce = async (cli, ms) => {
    const m = await cli.wait(x => x.t === 'ask', ms);
    cli.send({ t: 'answer', id: m.id, value: m.method === 'askPlay' ? { type: 'end' } : null });
    if (m.method === 'chooseCard' && Array.isArray(m.args.okKeys)) seenOk.value = true;
  };
  const goal = { state: null };
  const goalWatch = A.wait(m => m.t === 'state' && (m.snap.turnCount >= 4 || m.snap.over), 45000)
    .then(m => { goal.state = m.snap; });
  const pumpFor = async cli => {
    const end = Date.now() + 45000;
    while (!goal.state && Date.now() < end) {
      try { await pumpOnce(cli, 2500); } catch { break; }
    }
  };
  await Promise.all([goalWatch, pumpFor(A), pumpFor(B)]);
  if (!goal.state || (goal.state.turnCount < 4 && !goal.state.over)) throw new Error('对局未推进');
  if (!seenOk.value) throw new Error('chooseCard 询问应附带 okKeys');
  console.log('问答/推进/okKeys ✓（turnCount=' + goal.state.turnCount + '）');

  // ---- 5. 断线：pending 询问立即结算（不等 90 秒），座位转机器人代打 ----
  diag.step = '5.断线接管';
  // A 后台持续应答（否则轮到 A 出牌时对局会停在等待应答）
  let pumping = true;
  const bgPump = (async () => { while (pumping) { try { await pumpOnce(A, 2500); } catch { break; } } })();
  bgPump.catch(() => {});
  const bAsk = await B.wait(m => m.t === 'ask', 45000); // B 拿到询问后立即断开（此刻服务器有未决询问）
  const before = (await A.wait(m => m.t === 'state')).snap.turnCount;
  B.close();
  const t0 = Date.now();
  let advanced = null;
  while (Date.now() - t0 < 15000) {
    const st = await A.wait(m => m.t === 'state', 3000).catch(() => null);
    if (st && (st.snap.turnCount > before || st.snap.over)) { advanced = st.snap; break; }
  }
  if (!advanced) throw new Error('断线后 15 秒内对局未恢复推进（pending 未即时结算）');
  console.log('断线即时接管 ✓（turnCount ' + before + ' → ' + (advanced.over ? '终局' : advanced.turnCount) + '，耗时 ' + (Date.now() - t0) + 'ms）');

  pumping = false;
  A.close(); bgPump.catch(() => {});

  // ---- 6. 终局 rematch：房主（A 断开后转移给 C）一键再开一局，沿用人数与角色池 ----
  diag.step = '6.终局rematch';
  const stOver = await C.wait(m => m.t === 'state' && m.snap.over, 120000);
  const beforeGameId = stOver.snap.gameId;
  // 旧房主 A 已离场，房主应已转移给剩余最小座位（C）
  const lobbyAfter = await C.wait(m => m.t === 'lobby' && !m.started, 5000);
  C.send({ t: 'rematch' });
  const st2 = await C.wait(m => m.t === 'state' && m.snap.gameId > beforeGameId && !m.snap.over, 10000)
    .catch(() => null);
  if (!st2) throw new Error('房主 rematch 应重开一局');
  const ids2 = st2.snap.players.map(p => p.charId);
  if (!ids2.every(id => id === 'hsjjj' || id === 'luren')) throw new Error('rematch 应沿用本局角色池: ' + ids2.join(','));
  console.log('终局 rematch + 角色池沿用 ✓（房主已转移至原观战者）');
  C.close();
  console.log('\n冒烟测试全部通过 ✓');
})().catch(e => {
  console.error('冒烟测试失败：', e);
  console.error('失败步骤：' + diag.step);
  try { console.error('客户端诊断 A=', diag.clients.A?.dbg(), 'B=', diag.clients.B?.dbg(), 'C=', diag.clients.C?.dbg()); } catch (e2) { console.error('诊断不可用:', e2.message); }
  if (server && server.serverLogs.length) {
    console.error('---- 子服务器日志（末 40 行）----');
    console.error(server.serverLogs.join('').split('\n').slice(-40).join('\n'));
  }
  process.exitCode = 1;
}).finally(() => { if (server) { try { server.kill(); } catch {} } });
