// 群友杀 - 界面适配器：DOM 渲染 + 人类玩家问答（Promise 化）
// 注意：本文件顶层不触碰 DOM，全部逻辑在 create() 内部，保证 Node 环境也能加载。
globalThis.QYS = globalThis.QYS || {};
QYS.ui = {};

// 头像扩展名回退：png → jpeg → jpg → 首字圆徽（定义在全局供 img.onerror 调用，不在顶层触碰 DOM）
QYS.avatarNext = function (img) {
  const exts = ['png', 'jpeg', 'jpg'];
  const i = Number(img.dataset.ai || 0);
  if (i + 1 < exts.length) {
    img.dataset.ai = String(i + 1);
    img.src = `assets/characters/${img.dataset.cid}.${exts[i + 1]}`;
  } else {
    img.remove();
  }
};

// 通用角色头像 HTML（牌桌/图鉴共用）：图片约定 assets/characters/<id>.<avatar|png>
QYS.charAvatar = function (ch, cls = '') {
  const exts = ['png', 'jpeg', 'jpg'];
  const ext = ch?.avatar && exts.includes(ch.avatar) ? ch.avatar : 'png';
  return `<div class="avatar ${cls}" data-initial="${(ch?.name || '?').slice(0, 1)}"><img src="assets/characters/${ch.id}.${ext}" alt="" data-ai="${exts.indexOf(ext)}" data-cid="${ch.id}" onerror="QYS.avatarNext(this)"></div>`;
};

QYS.ui.create = function (root) {
  const { colorOf, numStr } = QYS.util;
  const ID_NAME = QYS.core.ID_NAME;
  const TYPE_NAME = { basic: '基本牌', trick: '锦囊牌', delayed: '延迟锦囊', equip: '装备牌' };
  const SLOT_NAME = { weapon: '武器', armor: '防具', horsePlus: '+1马', horseMinus: '-1马' };
  const ID_CLS = { 主: 'lord', 忠: 'loyal', 反: 'rebel', 内: 'spy' };
  const ID_SHORT = { 主: '主', 忠: '忠', 反: '反', 内: '内' };

  const view = { game: null, state: null, splashResolve: null, pinnedKey: null, discExpanded: false };

  root.innerHTML = `
    <div id="gameScreen" hidden>
      <div id="tableArea">
        <div id="idStats"></div>
        <div id="fallenRow"></div>
        <div id="seal"></div>
        <div id="ring"></div>
        <div id="centerBar"><div id="turnInfo"></div><div id="prompt"></div></div>
        <div id="discardCorner"></div>
        <div id="selfArea"></div>
      </div>
      <div id="logPanel"><div class="logTitle">战 报</div><div id="logList"></div></div>
      <div id="actionBar"></div>
      <div id="cardDetail" hidden></div>
      <div id="overlay" hidden></div>
    </div>`;

  const $ = s => root.querySelector(s);
  const gameScreen = $('#gameScreen'), ring = $('#ring'), seal = $('#seal'),
    turnInfo = $('#turnInfo'), promptEl = $('#prompt'), idStats = $('#idStats'),
    fallenRow = $('#fallenRow'), discardCorner = $('#discardCorner'),
    selfArea = $('#selfArea'), logList = $('#logList'), actionBar = $('#actionBar'),
    cardDetail = $('#cardDetail'), overlay = $('#overlay');

  const dn = c => QYS.def(c).name;
  const cardKey = c => `${c.defId}|${c.suit}|${c.number}`;
  const charOf = p => QYS.data.characters.find(c => c.id === p.charId);
  // 弃牌记录统一出口：本地引擎用 Map，联机快照直接带 discardEntries
  function discardEntries(g) {
    if (g.discardEntries) return g.discardEntries;
    return [...(g.discard || [])].reverse().map(c => ({ card: c, ...(g.discardInfo?.get(c) || {}) }));
  }

  // ---- 渲染 ----
  function avatarHtml(p) {
    return QYS.charAvatar(charOf(p));
  }

  function badgeHtml(p) {
    const mine = p.seat === view.game.humanSeat;
    if (!(p.revealed || view.game.over || mine)) return `<span class="badge unknown">？</span>`;
    return `<span class="badge ${ID_CLS[p.identity]}">${ID_SHORT[p.identity]}</span>`;
  }

  function tagChips(p) {
    const chips = [];
    const eq = p.equips;
    if (eq.weapon) chips.push('武·' + dn(eq.weapon));
    if (eq.armor) chips.push('防·' + dn(eq.armor));
    if (eq.horsePlus) chips.push('+1马');
    if (eq.horseMinus) chips.push('-1马');
    p.judges.forEach(c => chips.push('判·' + dn(c)));
    return chips.map(c => `<span class="chip">${c}</span>`).join('');
  }

  function hpHtml(p) {
    const hp = Math.max(p.hp, 0);
    return `<span class="hpFull">${'♥'.repeat(hp)}</span><span class="hpEmpty">${'♡'.repeat(p.maxHp - hp)}</span><span class="hptext">${hp}/${p.maxHp}</span>`;
  }

  // 悬于角色下方的牌：装备与判定区（延迟锦囊）
  function hangFaces(p) {
    const eq = p.equips;
    const cards = [eq.weapon, eq.armor, eq.horsePlus, eq.horseMinus, ...p.judges].filter(Boolean);
    return cards.map(c => faceHtml(c, '', 'hang')).join('');
  }

  function playerHtml(p, ringPos) {
    const g = view.game;
    const cur = !g.over && g.players[g.currentIdx] === p;
    const st = view.state;
    const selectable = st?.mode === 'targets' && st.candidates.includes(p);
    const selected = st?.mode === 'targets' && st.selected.includes(p);
    const skChips = (p.skillIds || []).map(id => ({ id, s: QYS.data.skills[id] })).filter(x => x.s)
      .map(x => `<span class="chip skChip" data-skill="${x.id}">${x.s.name}</span>`).join('');
    const hang = hangFaces(p);
    // 编号 = 从主公（1号）起按行动顺序
    const n = g.players.length;
    const num = ((p.seat - (g.lordSeat ?? 0)) % n + n) % n + 1;
    const ch = charOf(p);
    const locked = g.isLocked ? g.isLocked(p) : !!p.locked;
    const inToilet = g.toilet ? (g.toilet.a === p || g.toilet.b === p) : !!p.toilet;
    const laddered = !!p.ladderFail || !!p.ladder;
    const ringCls = ringPos ? ' ringP' : '';
    const styleAttr = ringPos ? ` style="left:${ringPos.x}%;top:${ringPos.y}%"` : '';
    // orange 计数（秋秋人）：头像下方橙色徽标；太刀（花生酱酱酱）：头像右上角刃色图标
    const showOrg = (p.skillIds || []).includes('sk_orange');
    const orgBadge = showOrg ? `<span class="orgBadge" title="orange：出牌阶段可使用，1个回复1点体力">${p.oranges ?? 0}</span>` : '';
    const BLADE_NAME = ['', '攻击范围+1', '每回合两张杀', '杀伤害+1'];
    const bladeLv = p.blade ?? 0;
    const bladeIcon = bladeLv > 0 && (p.skillIds || []).includes('sk_taidao')
      ? `<span class="bladeIcon b${bladeLv}" title="太刀·${['', '白刃', '黄刃', '红刃'][bladeLv]}：${BLADE_NAME[bladeLv]}">刀</span>` : '';
    return `<div class="player${ringCls} ${cur ? 'current' : ''} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''} ${p.alive ? '' : 'dead'}" data-seat="${p.seat}"${styleAttr}>
      <div class="avWrap">${avatarHtml(p)}${orgBadge}${bladeIcon}</div>
      <div class="pinfo">
        <div class="pname"><span class="pnum">${num}号</span>${p.name}${badgeHtml(p)}${p.seat === g.humanSeat ? '<span class="badge self">你</span>' : ''}</div>
        <div class="ptitle">${ch ? `${ch.name} · ${ch.title}` : p.title}</div>
        <div class="hp">${hpHtml(p)}</div>
        <div class="handcount">手牌 ${p.handCount ?? p.hand.length}</div>
        <div class="chips">${tagChips(p)}${locked ? '<span class="chip warChip">小学生战争</span>' : ''}${inToilet ? '<span class="chip toiletChip">一起上厕所</span>' : ''}${laddered ? '<span class="chip ladderChip">梯子专家</span>' : ''}</div>
        <div class="skRow"><span class="lbl">技能</span>${skChips || '<span class="lbl">无</span>'}</div>
      </div>
      ${hang ? `<div class="hangRow">${hang}</div>` : ''}
    </div>`;
  }

  // 统一的卡面渲染：data-defid/suit/num 供悬浮详情，attrs 附加 data-card-idx / data-by 等
  function faceHtml(card, attrs = '', extra = '') {
    const d = QYS.def(card);
    const red = colorOf(card.suit) === 'red';
    return `<div class="card mini ${red ? 'redSuit' : 'blackSuit'} ${extra}" data-defid="${card.defId}" data-suit="${card.suit}" data-num="${card.number}" ${attrs}>
      <div class="corner">${numStr(card.number)}<br>${card.suit}</div>
      <div class="cname">${d.name}</div>
    </div>`;
  }

  function cardHtml(card, idx, extra = '') {
    return faceHtml(card, `data-card-idx="${idx}"`, extra);
  }

  function handCardHtml(me, card, i) {
    const st = view.state;
    let extra = '';
    if (st?.mode === 'play' && st.playableKeys.has(cardKey(card))) extra = 'playable';
    if ((st?.mode === 'chooseCard') && st.filter(card)) extra = 'playable';
    return cardHtml(card, i, extra);
  }

  function actionBarHtml() {
    const st = view.state;
    if (!st) return '';
    if (st.mode === 'play') {
      // 主动技（可用时）给按钮；触发技常驻展示为"被动"标签（悬浮看说明），条件满足时会自动询问
      const g = view.game;
      const me = g && g.humanSeat != null ? g.players[g.humanSeat] : null;
      const passives = (me?.skillIds || [])
        .map(id => QYS.data.skills[id]).filter(s => s && s.type !== 'active');
      return `${st.canSkill ? `<button class="btn skill" data-act="skill">发动【${st.skillName}】</button>` : ''}${passives.map(s => `<span class="chip skChip passiveChip">被动·${s.name}</span>`).join('')}<button class="btn primary" data-act="end">结束出牌</button>`;
    }
    if (st.mode === 'targets')
      return `<button class="btn primary" data-act="confirm" ${st.selected.length >= st.min ? '' : 'disabled'}>确定</button><button class="btn" data-act="cancel">取消</button>`;
    if (st.mode === 'chooseCard')
      return `<button class="btn" data-act="cancel">${st.cancelText || '放弃'}</button>`;
    if (st.mode === 'bool')
      return `<button class="btn primary" data-act="yes">确定</button><button class="btn" data-act="no">${st.cancelText || '放弃'}</button>`;
    return '';
  }

  function render() {
    const g = view.game;
    if (!g) return;

    // 座位围成一圈：观察者永远在 6 点位，下家（seat+1）在右手侧，沿逆时针依次排开。
    // 阵亡者离场：环只由存活玩家组成（与距离规则一致），阵亡者在顶部名单展示。
    const alivePs = g.players.filter(p => p.alive);
    const anchorSeat = g.humanSeat ?? 0;
    const anchor = alivePs.find(p => p.seat === anchorSeat) || alivePs[0] || g.players[0];
    const n = Math.max(alivePs.length, 1);
    const idx = new Map(alivePs.map((p, i) => [p, i]));
    const anchorIdx = idx.has(anchor) ? idx.get(anchor) : 0;
    const pos = p => {
      const rel = ((idx.get(p) ?? anchorIdx) - anchorIdx + n) % n;
      const a = (90 - rel * 360 / n) * Math.PI / 180;
      return { x: 50 + 40 * Math.cos(a), y: 46 + 33 * Math.sin(a) };
    };
    ring.innerHTML = alivePs.map(p => playerHtml(p, pos(p))).join('');
    fallenRow.innerHTML = g.players.filter(p => !p.alive)
      .map(p => `<span class="chip fallenChip">${p.name}·${ID_NAME[p.identity] || ''} 阵亡</span>`).join('');

    const cur = g.players[g.currentIdx];
    const entries = discardEntries(g);
    turnInfo.innerHTML = g.over
      ? `终局 · ${g.winner || ''}获胜`
      : `<b>${cur ? cur.name : ''}</b> 的回合${cur && cur.seat === g.humanSeat ? '（你）' : ''} · 牌堆 ${g.deckCount ?? g.deck.length} · 弃牌 ${entries.length}`;
    seal.innerHTML = g.over ? `<div class="seal over">终</div>` : `<div class="seal">${g.phase || '歇'}</div>`;
    promptEl.textContent = view.state?.hint || '';

    // 右上角：本局身份配置（人人可知的公共信息）
    const ic = g.identityCounts;
    idStats.innerHTML = !g.over && ic
      ? ['忠', '反', '内'].map(k => `<span class="chip statChip">${QYS.core.ID_NAME[k]}×${ic[k] || 0}</span>`).join('')
      : '';
    // 右下角：统一弃牌堆（默认折叠，点标题展开），展开后点卡固定查看详情
    discardCorner.innerHTML = view.discExpanded
      ? `<div class="dcTitle dcToggle">弃牌堆 ${entries.length} <span class="dcArrow">▾ 收起</span></div><div class="dcRow">${entries.map(e => faceHtml(e.card, `data-by="${e.by}" data-via="${e.via}"`, 'disc')).join('') || '<span class="dcEmpty">暂无弃牌</span>'}</div>`
      : `<div class="dcTitle dcToggle">弃牌堆 <span class="dcCount">${entries.length}</span> <span class="dcArrow">▸ 展开</span></div>`;

    const me = g.humanSeat != null ? g.players[g.humanSeat] : null;
    if (me) {
      const hand = me.alive
        ? me.hand.map((c, i) => handCardHtml(me, c, i)).join('')
        : '<div class="spectate">你已阵亡，观战中</div>';
      selfArea.innerHTML = `<div id="handRow">${hand}</div>`;
    } else {
      selfArea.innerHTML = `<div id="handRow"><div class="spectate">全机器人演示 · 观战中</div></div>`;
    }

    actionBar.innerHTML = actionBarHtml();
    logList.innerHTML = g.logs.map(l => `<div class="logline ${l.type}">${l.text}</div>`).join('');
  }

  // ---- 问答（Promise 化的人类玩家接口）----
  function ask(mode, state) {
    view.state = { mode, ...state };
    render();
    return new Promise(res => { view.state.resolve = res; });
  }
  function resolveSt(v) {
    const r = view.state.resolve;
    view.state = null;
    render();
    r(v);
  }

  view.io = {
    async chooseCard(p, opts) {
      return ask('chooseCard', { filter: opts.filter || (() => true), hint: opts.hint || '', cancelText: opts.cancelText });
    },
    async askPlay(p, opts) {
      return ask('play', {
        playableKeys: new Set(opts.playable.map(it => cardKey(it.card))),
        canSkill: opts.canSkill, skillName: opts.skillName, hint: opts.hint || '',
      });
    },
    async chooseTargets(p, opts) {
      return ask('targets', {
        candidates: opts.candidates, selected: [],
        min: opts.min ?? 1, max: opts.max ?? 1, hint: opts.hint || '',
      });
    },
    async chooseBool(p, opts) {
      return ask('bool', { hint: opts.hint || '', cancelText: opts.cancelText });
    },
  };

  // ---- 事件 ----
  function handleAction(act) {
    if (act === 'continue' && view.splashResolve) {
      const r = view.splashResolve;
      view.splashResolve = null;
      overlay.hidden = true;
      r();
      return;
    }
    if (act === 'restart') { location.reload(); return; }
    const st = view.state;
    if (!st) return;
    if (st.mode === 'play') {
      if (act === 'end') resolveSt({ type: 'end' });
      else if (act === 'skill') resolveSt({ type: 'skill' });
    } else if (st.mode === 'targets') {
      if (act === 'confirm' && st.selected.length >= st.min) resolveSt(st.selected.slice());
      else if (act === 'cancel') resolveSt(null);
    } else if (st.mode === 'chooseCard') {
      if (act === 'cancel') resolveSt(null);
    } else if (st.mode === 'bool') {
      if (act === 'yes') resolveSt(true);
      else if (act === 'no') resolveSt(false);
    }
  }

  function handleCardClick(i) {
    const g = view.game;
    if (g.humanSeat == null) return;
    const card = g.players[g.humanSeat].hand[i];
    const st = view.state;
    if (!card || !st) return;
    if (st.mode === 'play' && st.playableKeys.has(cardKey(card))) resolveSt({ type: 'card', card });
    else if (st.mode === 'chooseCard' && st.filter(card)) resolveSt(card);
  }

  function handleSeatClick(seat) {
    const st = view.state;
    if (!st || st.mode !== 'targets') return;
    const p = view.game.players[seat];
    if (!st.candidates.includes(p)) return;
    const at = st.selected.indexOf(p);
    if (at >= 0) st.selected.splice(at, 1);
    else {
      if (st.selected.length >= st.max) st.selected.shift();
      st.selected.push(p);
    }
    render();
  }

  root.addEventListener('click', e => {
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) { handleAction(actBtn.dataset.act); return; }
    // 弃牌堆标题：展开/收起
    if (e.target.closest('.dcToggle')) { view.discExpanded = !view.discExpanded; render(); return; }
    // 弃牌堆卡牌：点击固定详情（再点同一张取消），点其他位置取消固定
    const discCard = e.target.closest('#discardCorner [data-defid]');
    if (discCard) {
      const key = detailKey(discCard);
      if (view.pinnedKey === key) {
        view.pinnedKey = null;
        cardDetail.hidden = true;
      } else {
        view.pinnedKey = key;
        const html = detailHtml(discCard);
        if (html) { cardDetail.innerHTML = html + '<div class="pinNote">已固定 · 点其他位置取消</div>'; cardDetail.hidden = false; }
      }
      return;
    }
    if (view.pinnedKey) { view.pinnedKey = null; cardDetail.hidden = true; }
    const cardEl = e.target.closest('[data-card-idx]');
    if (cardEl) { handleCardClick(+cardEl.dataset.cardIdx); return; }
    const plEl = e.target.closest('.player[data-seat]');
    if (plEl) { handleSeatClick(+plEl.dataset.seat); return; }
  });

  // 悬浮/点击详情：卡牌（手牌/弃牌/悬挂牌）与技能通用，内容来自 data-* 属性
  function detailHtml(el) {
    if (el.dataset.skill) {
      const s = QYS.data.skills[el.dataset.skill];
      if (!s) return null;
      return `<div class="dTitle skillTitle">${s.name}</div>
        <div class="dType">${s.type === 'active' ? '主动技' : '触发技'}</div>
        <div class="dDesc">${s.desc || ''}</div>`;
    }
    const d = QYS.data.cards.find(c => c.id === el.dataset.defid);
    if (!d) return null;
    const suit = el.dataset.suit || '';
    const red = suit && colorOf(suit) === 'red';
    const by = el.dataset.by ? `<div class="dBy">${el.dataset.by}${el.dataset.via ? ' · ' + el.dataset.via : ''}</div>` : '';
    return `<img src="assets/cards/${d.id}.png" alt="" onerror="this.remove()">
      <div class="dTitle ${red ? 'redSuit' : 'blackSuit'}">${d.name} ${suit ? `<small>${numStr(+el.dataset.num)}${suit}</small>` : ''}</div>
      <div class="dType">${TYPE_NAME[d.type]}${d.slot ? ' · ' + SLOT_NAME[d.slot] : ''}</div>
      ${by}
      <div class="dDesc">${d.desc || ''}</div>`;
  }
  const detailKey = el => [el.dataset.defid, el.dataset.suit, el.dataset.num, el.dataset.by, el.dataset.via, el.dataset.skill].join('|');

  root.addEventListener('mouseover', e => {
    if (view.pinnedKey) return; // 已固定详情时忽略悬浮
    const el = e.target.closest('[data-defid],[data-skill]');
    if (!el) { cardDetail.hidden = true; return; }
    const html = detailHtml(el);
    if (!html) { cardDetail.hidden = true; return; }
    cardDetail.innerHTML = html;
    cardDetail.hidden = false;
  });

  // ---- 流程弹层 ----
  view.attach = (g, remote = false) => {
    view.game = g;
    view.pinnedKey = null;
    view.discExpanded = false;
    cardDetail.hidden = true;
    if (!remote) g.view = view;
    gameScreen.hidden = false;
  };

  view.showSplash = g => {
    const me = g.players[g.humanSeat];
    const ch = charOf(me) || {};
    const sk = me.skillIds.map(id => {
      const s = QYS.data.skills[id];
      return `<div class="sk"><b>【${s.name}】</b>（${s.type === 'active' ? '主动技' : '触发技'}）${s.desc}</div>`;
    }).join('');
    overlay.innerHTML = `<div class="panel">
      <h2>你的身份</h2>
      <div class="bigId ${ID_CLS[me.identity]}">${ID_NAME[me.identity]}</div>
      <h2>你的昵称 / 武将</h2>
      <div class="bigChar">${me.name} · ${ch.name || ''}（${ch.title || ''}）　体力 ${me.maxHp}</div>
      ${sk}
      <button class="btn primary" data-act="continue">进入游戏</button>
    </div>`;
    overlay.hidden = false;
    return new Promise(res => { view.splashResolve = res; });
  };

  view.showGameOver = g => {
    const rows = g.players.map(p =>
      `<tr><td>${p.name}</td><td>${ID_NAME[p.identity]}</td><td>${p.alive ? '存活' : '阵亡'}</td><td>${p.seat === g.humanSeat ? '你' : ''}</td></tr>`).join('');
    overlay.innerHTML = `<div class="panel">
      <h1 class="winTitle">${g.winner} 获胜</h1>
      <table class="idTable"><tr><th>武将</th><th>身份</th><th>状态</th><th></th></tr>${rows}</table>
      <button class="btn primary" data-act="restart">再来一局</button>
    </div>`;
    overlay.hidden = false;
  };

  view.fatal = err => {
    overlay.innerHTML = `<div class="panel"><h2>出错了</h2><pre>${String((err && err.stack) || err)}</pre><button class="btn" data-act="restart">重新开始</button></div>`;
    overlay.hidden = false;
  };

  view.render = render;
  return view;
};
