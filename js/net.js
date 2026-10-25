// 群友杀 - 联机客户端：连接 server.js，用状态快照渲染，把人类决策转发给服务器
// 协议（JSON 文本帧）：
//   客户端→服务器: {t:'join',name} {t:'start',playerCount} {t:'answer',id,value}
//   服务器→客户端: {t:'hello',seat} {t:'lobby',seats,started} {t:'state',snap} {t:'ask',id,method,args}
globalThis.QYS = globalThis.QYS || {};
QYS.net = {};

(function () {
  let ws = null, mySeat = null, splashDone = false, overShown = false, view = null;
  const askQueue = [];
  let busy = false;

  const show = id => { document.getElementById(id).hidden = false; };
  const hide = id => { document.getElementById(id).hidden = true; };
  const lobbyMsg = text => { const el = document.getElementById('lobbyMsg'); if (el) el.textContent = text; };

  function connect(nick, v) {
    view = v;
    show('lobby');
    hide('startScreen');
    // GitHub Pages 只能托管静态页面，联机需要 WebSocket 服务器
    if (location.hostname.endsWith('.github.io')) {
      lobbyMsg('GitHub Pages 版仅支持单机/演示/图鉴。联机请在本地运行 node server.js（见 README「公网联机部署」），或部署到 Node 托管平台。');
      return;
    }
    lobbyMsg('连接中…（需要用 node server.js 启动才能联机）');
    // https 页面必须用 wss，http（本地）用 ws
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { ws = new WebSocket(`${wsProto}//${location.host}`); } catch { return lobbyMsg('无法建立连接'); }
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: String(nick || '') }));
    ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => lobbyMsg('连接已断开。请确认 node server.js 在运行，刷新页面重试。');
    ws.onerror = () => {};
  }

  function handle(msg) {
    if (msg.t === 'hello') { mySeat = msg.seat; }
    else if (msg.t === 'lobby') renderLobby(msg);
    else if (msg.t === 'state') onState(msg.snap);
    else if (msg.t === 'ask') { askQueue.push(msg); drain(); }
  }

  function renderLobby(msg) {
    if (msg.started) { hide('lobby'); return; }
    show('lobby');
    document.getElementById('lobbySeats').innerHTML = msg.seats.map((n, i) =>
      `<div class="lobbySeat${i === mySeat ? ' me' : ''}"><span class="avatar lobbyAv" data-initial="${(n || '机')[0]}"></span>座位 ${i + 1} · ${n || '机器人'}</div>`).join('');
    document.getElementById('lobbyOpts').hidden = mySeat !== 0;
    lobbyMsg(mySeat === 0 ? '你是房主，坐满后即可开局' : '等待房主开局…');
  }

  function onState(snap) {
    const first = !view.game;
    view.attach(snap, true);
    hide('startScreen');
    hide('lobby');
    view.render(); // 状态变化即重绘，非回合玩家也能实时看到牌局
    if (snap.over) {
      if (!overShown) { overShown = true; view.showGameOver(snap); }
      return;
    }
    if (first) {
      if (snap.humanSeat != null) {
        splashDone = false;
        view.showSplash(snap).then(() => { splashDone = true; drain(); });
      } else {
        splashDone = true;
      }
    }
  }

  // 服务器按座位顺序逐个提问，这里排队逐个处理，答完发回服务器
  function drain() {
    if (!splashDone || busy || !askQueue.length) return;
    const msg = askQueue.shift();
    const args = msg.args || {};
    busy = true;
    let p;
    try {
      if (msg.method === 'chooseCard')
        p = view.io.chooseCard(null, { filter: filterFromTag(args.tag), hint: args.hint || '', cancelText: args.cancelText });
      else if (msg.method === 'chooseBool')
        p = view.io.chooseBool(null, { hint: args.hint || '', cancelText: args.cancelText });
      else if (msg.method === 'chooseTargets')
        p = view.io.chooseTargets(null, {
          candidates: (args.candidateSeats || []).map(s => view.game.players[s]).filter(Boolean),
          min: args.min, max: args.max, hint: args.hint || '',
        }).then(v => (v ? v.map(x => x.seat) : null));
      else if (msg.method === 'askPlay')
        p = view.io.askPlay(null, { playable: args.playable || [], canSkill: args.canSkill, skillName: args.skillName, hint: args.hint || '' })
          .then(v => (v && v.type === 'card' ? { type: 'card', card: v.card } : v));
      else p = Promise.resolve(null);
    } catch (err) { console.error(err); p = Promise.resolve(null); }
    p.then(v => sendAnswer(msg, v)).catch(err => {
      (window.__netErrs = window.__netErrs || []).push(String((err && err.stack) || err));
      sendAnswer(msg, null);
    });
  }

  function sendAnswer(msg, v) {
    busy = false;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'answer', id: msg.id, value: v === undefined ? null : v }));
    drain();
  }

  // tag 即卡牌名（杀/闪/桃），弃牌/技能为任意牌
  function filterFromTag(tag) {
    if (!tag || tag === '弃牌' || tag === '技能') return () => true;
    return c => { try { return QYS.def(c).name === tag; } catch { return false; } };
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnOnlineStart')?.addEventListener('click', () => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'start', playerCount: +document.getElementById('onlineCount').value }));
    });
    document.getElementById('btnLobbyBack')?.addEventListener('click', () => {
      if (ws) ws.close();
      hide('lobby');
      show('startScreen');
    });
  });

  QYS.net.connect = connect;
  QYS.net.debug = () => ({ queued: askQueue.length, splashDone, busy, hasWs: !!ws, wsState: ws && ws.readyState, mySeat });
})();
