// 群友杀 - 联机客户端：连接 server.js，用状态快照渲染，把人类决策转发给服务器
// 协议（JSON 文本帧）：
//   客户端→服务器: {t:'create',name} {t:'join',name,code} {t:'start',playerCount} {t:'answer',id,value}
//   服务器→客户端: {t:'hello',seat,code} {t:'error',msg} {t:'lobby',code,seats,hostSeat,started} {t:'state',snap} {t:'ask',id,method,args}
globalThis.QYS = globalThis.QYS || {};
QYS.net = {};

(function () {
  let ws = null, mySeat = null, roomCode = null, splashDone = false, overShown = false, view = null;
  let lastGameId = null;
  let hostSeat = null;          // 最近一次大厅广播的房主座位（终局按钮据此区分房主/成员）
  let leftAfterOver = false;    // 终局后点了"回到主页面"：忽略迟到的旧局快照，避免牌局面板再次弹出
  let onlinePicker = null;      // 联机角色池选择器（房主；只建一次，选择跨大厅广播保留）
  const askQueue = [];
  let busy = false;

  const show = id => { document.getElementById(id).hidden = false; };
  const hide = id => { document.getElementById(id).hidden = true; };
  const lobbyMsg = text => { const el = document.getElementById('lobbyMsg'); if (el) el.textContent = text; };

  // 点「联机」：只打开大厅，等用户创建或加入
  QYS.net.openLobby = function (v) {
    view = v;
    show('lobby');
    hide('startScreen');
    show('lobbyJoinRow');
    hide('lobbyCodeRow');
    hide('lobbyOpts');
    document.getElementById('lobbySeats').innerHTML = '';
    document.getElementById('roomCode').value = '';
    lobbyMsg('创建新房间，或用房主给的 4 位房间码加入（同一房间昵称不能重复）');
  };

  function ensureWs(action) {
    if (location.hostname.endsWith('.github.io')) {
      return lobbyMsg('GitHub Pages 版仅支持单机/演示/图鉴。联机请在本地运行 node server.js（见 README「部署」），或部署到 Node 托管平台。');
    }
    const send = () => ws.send(JSON.stringify(action));
    if (ws && ws.readyState === 1) return send();
    // 连接建立中：把动作排队到同一条连接，避免重复点击开出第二条 WebSocket（会创建出两个房间）
    if (ws && ws.readyState === 0) { ws.addEventListener('open', () => send(), { once: true }); return; }
    lobbyMsg('连接中…（需要用 node server.js 启动才能联机）');
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { ws = new WebSocket(`${wsProto}//${location.host}`); } catch { return lobbyMsg('无法建立连接'); }
    ws.onopen = send;
    ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => lobbyMsg('连接已断开。请确认 node server.js 在运行，刷新页面重试。');
    ws.onerror = () => {};
  }

  function handle(msg) {
    if (msg.t === 'hello') {
      mySeat = msg.seat;
      roomCode = msg.code;
      hide('lobbyJoinRow');
      show('lobbyCodeRow');
      document.getElementById('lobbyCodeText').textContent = roomCode;
    } else if (msg.t === 'error') {
      lobbyMsg(msg.msg || '加入失败');
    } else if (msg.t === 'lobby') {
      renderLobby(msg);
    } else if (msg.t === 'state') {
      onState(msg.snap);
    } else if (msg.t === 'ask') {
      askQueue.push(msg);
      drain();
    }
  }

  function renderLobby(msg) {
    if (msg.started && !view.game) { hide('lobby'); return; } // 对局进行中才加入的观战者，直接看牌局
    hostSeat = msg.hostSeat;
    document.getElementById('lobbyCodeText').textContent = msg.code;
    const rushSeats = msg.rushSeats || [];
    const seats = document.getElementById('lobbySeats');
    seats.innerHTML = msg.seats.map((n, i) => {
      const tag = i === msg.hostSeat ? '（房主）' : '';
      const rush = rushSeats.includes(i) ? '<span class="chip rushChip">抢主公</span>' : '';
      const toggle = i === mySeat && !msg.started
        ? `<label class="rushToggle"><input type="checkbox" data-rush ${rushSeats.includes(i) ? 'checked' : ''}>抢主公</label>` : '';
      return `<div class="lobbySeat${i === mySeat ? ' me' : ''}"><span class="avatar lobbyAv" data-initial="${(n || '机')[0]}"></span>座位 ${i + 1} · ${n || '机器人'}${tag}${rush}${toggle}</div>`;
    }).join('');
    document.getElementById('lobbyOpts').hidden = !(mySeat === msg.hostSeat && !msg.started);
    // 房主开局选项：角色池选择器只建一次，选择跨大厅刷新保留
    const poolEl = document.getElementById('charPoolOnline');
    if (mySeat === msg.hostSeat && !msg.started) {
      if (!onlinePicker && poolEl) onlinePicker = QYS.ui.buildCharPicker(poolEl);
    }
    lobbyMsg(mySeat === msg.hostSeat && !msg.started
      ? '你是房主：勾选「抢主公」、点选本局角色池后开始联机对局（全不选 = 默认全员池）'
      : '等待房主开局…可勾选「抢主公」参与争夺');
  }

  function onState(snap) {
    // 换局识别：gameId 变化 = 新一局开始（重置弹层状态与面板）
    if (snap.gameId !== undefined && snap.gameId !== lastGameId) {
      lastGameId = snap.gameId;
      overShown = false;
      splashDone = false;
      leftAfterOver = false;
      view.game = null;
      if (view.resetPanels) view.resetPanels();
    }
    // 终局后已选择回到主页面：忽略旧局的终局快照，不把牌局弹回来
    if (leftAfterOver && snap.over) return;
    const first = !view.game;
    view.attach(snap, true);
    hide('startScreen');
    hide('lobby');
    view.render(); // 状态变化即重绘，非回合玩家也能实时看到牌局
    if (snap.over) {
      if (!overShown) {
        overShown = true;
        // 联机终局：房主决定继续一局/回到主页面；成员等待
        view.showGameOver(snap, { waiting: mySeat !== hostSeat });
      }
      return;
    }
    if (first) {
      if (snap.humanSeat != null && snap.humanSeat < snap.players.length) {
        splashDone = false;
        view.showSplash(snap).then(() => { splashDone = true; drain(); });
      } else {
        splashDone = true; // 观战
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
        p = view.io.chooseCard(null, { filter: filterFrom(args), hint: args.hint || '', cancelText: args.cancelText });
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

  // 选牌过滤：优先用服务器按引擎 filter 算出的可选牌键（okKeys，与本地单机完全一致）；
  // 旧服务器无 okKeys 时按 tag（卡牌名）回退，弃牌/技能为任意牌
  function filterFrom(args) {
    if (Array.isArray(args.okKeys)) {
      const ok = new Set(args.okKeys);
      return c => ok.has(`${c.defId}|${c.suit}|${c.number}`);
    }
    return filterFromTag(args.tag);
  }

  function filterFromTag(tag) {
    if (!tag || tag === '弃牌' || tag === '技能') return () => true;
    return c => { try { return QYS.def(c).name === tag; } catch { return false; } };
  }

  function leaveRoom() {
    if (ws) { ws.close(); ws = null; }
    mySeat = null; roomCode = null; splashDone = false; overShown = false;
    askQueue.length = 0; busy = false;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnRoomCreate')?.addEventListener('click', () =>
      ensureWs({ t: 'create', name: document.getElementById('nickName').value }));
    document.getElementById('btnRoomJoin')?.addEventListener('click', () => {
      const code = document.getElementById('roomCode').value.trim();
      if (code.length !== 4) return lobbyMsg('请输入 4 位房间码');
      ensureWs({ t: 'join', name: document.getElementById('nickName').value, code });
    });
    document.getElementById('lobbySeats')?.addEventListener('change', e => {
      if (e.target.matches('[data-rush]') && ws && ws.readyState === 1)
        ws.send(JSON.stringify({ t: 'rush', on: e.target.checked }));
    });
    document.getElementById('btnOnlineStart')?.addEventListener('click', () => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'start', playerCount: +document.getElementById('onlineCount').value, chars: onlinePicker ? onlinePicker.getSelected() : null }));
    });
    // 终局双按钮（房主）：继续一局沿用本局人数与角色池；回到主页面返回大厅
    if (view) view.onGameOverAction = act => {
      if (act === 'rematch') {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'rematch' }));
      } else {
        leftAfterOver = true;
        view.game = null;
        if (view.hideGameScreen) view.hideGameScreen();
        show('lobby');
      }
    };
    document.getElementById('btnLobbyBack')?.addEventListener('click', () => {
      leaveRoom();
      hide('lobby');
      show('startScreen');
    });
  });

  QYS.net.debug = () => ({ queued: askQueue.length, splashDone, busy, hasWs: !!ws, wsState: ws && ws.readyState, mySeat, roomCode });
})();
