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

// 通用角色池选择器：往 container 里渲染除路人群友外的全部角色芯片（点击切换选中态）。
// 返回 { getSelected() }；一个都没选时 getSelected() 返回 null（= 不限制，全员池）。
QYS.ui.buildCharPicker = function (container) {
  const chars = QYS.data.characters.filter(c => c.id !== 'luren');
  const picked = new Set(chars.map(c => c.id)); // 默认全选
  container.classList.add('charPick');
  container.innerHTML = `<div class="cpHead"><span class="cpTitle">本局角色池</span><span class="cpTip">点击头像加入/移出；全不选 = 不限制（默认全员）</span><button class="btn cpAll" type="button">全选</button><button class="btn cpNone" type="button">全不选</button></div>`
    + `<div class="cpGrid">${chars.map(c => `
      <div class="cp${picked.has(c.id) ? ' on' : ''}" data-cid="${c.id}" title="${c.name} · ${c.title}">
        <span class="avatar cpAv" data-initial="${c.name.slice(0, 1)}"><img src="assets/characters/${c.id}.${c.avatar || 'png'}" alt="" data-ai="0" data-cid="${c.id}" onerror="QYS.avatarNext(this)"></span>
        <span class="cpName">${c.name}</span>
      </div>`).join('')}</div>`;
  container.addEventListener('click', e => {
    const all = e.target.closest('.cpAll'), none = e.target.closest('.cpNone'), chip = e.target.closest('.cp[data-cid]');
    if (all) { chars.forEach(c => picked.add(c.id)); }
    else if (none) { picked.clear(); }
    else if (chip) { const id = chip.dataset.cid; picked.has(id) ? picked.delete(id) : picked.add(id); }
    else return;
    container.querySelectorAll('.cp[data-cid]').forEach(el => el.classList.toggle('on', picked.has(el.dataset.cid)));
  });
  return { getSelected: () => picked.size ? [...picked] : null };
};

QYS.ui.create = function (root) {
  const { colorOf, numStr } = QYS.util;
  const ID_NAME = QYS.core.ID_NAME;
  const TYPE_NAME = { basic: '基本牌', trick: '锦囊牌', delayed: '延迟锦囊', equip: '装备牌', curse: '诅咒牌' };
  const SLOT_NAME = { weapon: '武器', armor: '防具', horsePlus: '+1马', horseMinus: '-1马' };
  const ID_CLS = { 主: 'lord', 忠: 'loyal', 反: 'rebel', 内: 'spy' };
  const ID_SHORT = { 主: '主', 忠: '忠', 反: '反', 内: '内' };

  const view = { game: null, state: null, splashResolve: null, pinnedKey: null, hoverKey: null, discExpanded: false, nailongSeen: null };
  // 武将牌实测尺寸（含间距余量），供椭圆布局用；首帧用估算值，之后按实际渲染结果更新
  let cw = 180, ch = 188;

  // 奶龙大笑音效：优先播放 assets/audio/nailongdaxiao.mp3（用户可自行放置）；
  // 文件缺失时用 Web Audio 合成一段卡通"哈哈哈"回退
  function synthLaugh() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let t = ctx.currentTime + 0.05;
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator(), gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(300 - i * 30, t);           // "哈"起音
          osc.frequency.exponentialRampToValueAtTime(150 - i * 15, t + 0.16); // 下滑
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t); osc.stop(t + 0.2);
          t += 0.22;                                               // 哈…哈…哈
        }
        t += 0.15;                                                 // 停顿后再来一轮
      }
    } catch { /* 无声环境（Node/无音频设备）：忽略 */ }
  }
  function playNailong() {
    try {
      const a = new Audio('assets/audio/nailongdaxiao.mp3');
      a.volume = 0.75;
      a.play().catch(() => synthLaugh()); // 文件缺失/解码失败 → 合成回退
    } catch { synthLaugh(); }
  }
  // 触屏（无悬浮）：浏览器点按会先合成 mouseover——若照常弹卡牌详情，抽屉会盖住操作区/目标，点按被吞。
  // 触屏改为"点按固定查看"：不可用/未选中态点手牌、点技能标签 → 固定详情；再点其他位置取消。
  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches);

  root.innerHTML = `
    <div id="gameScreen" hidden>
      <div id="tableArea">
        <div id="idStats"></div>
        <div id="fallenRow"></div>
        <div id="seal"></div>
        <div id="ring"></div>
        <div id="centerBar"><div id="turnInfo"></div><div id="playClock" hidden></div><div id="prompt"></div></div>
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
    turnInfo = $('#turnInfo'), playClockEl = $('#playClock'), promptEl = $('#prompt'), idStats = $('#idStats'),
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
    if (eq.horseExtra) chips.push('马·' + dn(eq.horseExtra)); // 凑凑的：第二坐骑栏
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
    const cards = [eq.weapon, eq.armor, eq.horsePlus, eq.horseMinus, eq.horseExtra, ...p.judges].filter(Boolean);
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
    const inLiugou = g.liugou ? (g.liugou.a === p || g.liugou.b === p) : !!p.liugou;
    const distGuarded = p.distGuardTurn === g.turnCount || !!p.distGuard;
    const charmed = !!p.charmFrom || !!p.charmed;
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
    // 真蓄斩（斯坦尊尊）：头像旁 ⚡ 蓄力徽标，常驻展示（满3格变红 = 下一次杀无法被闪避或无效）
    const charge = p.charge ?? 0;
    const chargeBadge = (p.skillIds || []).includes('sk_zhenxuzhan')
      ? `<span class="chargeBadge${charge >= 3 ? ' full' : ''}" title="【真蓄斩】蓄力 ${charge} 格：下一次【杀】威力+${charge}${charge >= 3 ? '，无法被闪避或无效' : ''}">⚡${charge}</span>` : '';
    return `<div class="player${ringCls} ${cur ? 'current' : ''} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''} ${p.alive ? '' : 'dead'}" data-seat="${p.seat}"${styleAttr}>
      <div class="avWrap">${avatarHtml(p)}${orgBadge}${bladeIcon}${chargeBadge}</div>
      <div class="pinfo">
        <div class="pname"><span class="pnum">${num}号</span><span class="pnm">${p.name}</span></div>
        <div class="ptitle"><span class="ptt">${ch ? `${ch.name} · ${ch.title}` : p.title}</span>${badgeHtml(p)}${p.seat === g.humanSeat ? '<span class="badge self">你</span>' : ''}</div>
        <div class="hp">${hpHtml(p)}</div>
        <div class="handcount">手牌 ${p.handCount ?? p.hand.length}</div>
        <div class="chips">${tagChips(p)}${locked ? '<span class="chip warChip">小学生战争</span>' : ''}${inToilet ? '<span class="chip toiletChip">一起上厕所</span>' : ''}${inLiugou ? '<span class="chip liugouChip">遛狗去咯</span>' : ''}${distGuarded ? '<span class="chip guardChip">保卫胡萝卜</span>' : ''}${charmed ? '<span class="chip charmChip">魅惑菇</span>' : ''}${laddered ? '<span class="chip ladderChip">梯子专家</span>' : ''}</div>
        <div class="skRow"><span class="lbl">技能</span>${skChips || '<span class="lbl">无</span>'}</div>
      </div>
      ${hang ? `<div class="hangRow">${hang}</div>` : ''}
    </div>`;
  }

  // 统一的卡面渲染：data-defid/suit/num 供悬浮详情，attrs 附加 data-card-idx / data-by 等
  // 贴图类：cards 数据里 art 字段（curse 诅咒牌黑紫渐变边框 / shroom 蘑菇牌环绕特效边框）
  // img 字段：assets/cards/<id>.png 作为卡面底图（牌名/花色叠加其上）
  function faceHtml(card, attrs = '', extra = '') {
    const d = QYS.def(card);
    const red = colorOf(card.suit) === 'red';
    const artCls = d.art ? ` art${d.art}` : '';
    // onerror 移除自己：卡面图缺失时退回纯文字卡面，不留破图图标
    const face = d.img ? `<img class="face" src="assets/cards/${d.id}.png" alt="" onerror="this.remove()">` : '';
    return `<div class="card mini${artCls} ${red ? 'redSuit' : 'blackSuit'} ${extra}" data-defid="${card.defId}" data-suit="${card.suit}" data-num="${card.number}" ${attrs}>
      ${face}<div class="corner">${numStr(card.number)}<br>${card.suit}</div>
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

  // 出牌倒计时：所有人可见（中心栏显示剩余秒数，最后 10 秒红色警示）
  function renderClock() {
    const g = view.game;
    const dl = g && !g.over ? g.playDeadline : null;
    if (!dl) { playClockEl.hidden = true; return; }
    const secs = Math.max(0, Math.ceil((dl - Date.now()) / 1000));
    playClockEl.hidden = false;
    playClockEl.textContent = `⏱ 出牌倒计时 ${secs} 秒`;
    playClockEl.classList.toggle('urgent', secs <= 10);
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
    // 椭圆半径按容器实测尺寸自适应（每张武将牌按实际宽高占位，大屏放大后自动跟着变大）：
    // 保证顶部/左右边缘的武将牌完整显示不被裁切；cy=46% 让视觉重心略偏上，给底部手牌区让位
    const box = ring.getBoundingClientRect();
    const probe = ring.querySelector('.player');
    if (probe) { // 用上一帧渲染出的武将牌实测尺寸，避免硬编码在缩放断点下失准
      const r = probe.getBoundingClientRect();
      if (r.width > 0) { cw = r.width + 12; ch = r.height + 10; }
    }
    const CY = 46;
    let rx = 40, ry = 33;
    if (box.width > 120 && box.height > 120) {
      rx = Math.max(30, Math.min(46, (box.width - cw - 16) / (2 * box.width) * 100));
      ry = Math.max(22, Math.min(46, Math.min(
        (CY / 100 * box.height - ch / 2 - 8) / box.height,
        ((100 - CY) / 100 * box.height - ch / 2 - 8) / box.height) * 100));
    }
    const pos = p => {
      const rel = ((idx.get(p) ?? anchorIdx) - anchorIdx + n) % n;
      const a = (90 - rel * 360 / n) * Math.PI / 180;
      return { x: 50 + rx * Math.cos(a), y: CY + ry * Math.sin(a) };
    };
    // 7~8 人局：环上加 crowd 紧凑样式（见 css），缓解拥挤
    ring.classList.toggle('crowd', g.players.length >= 7);
    ring.innerHTML = alivePs.map(p => playerHtml(p, pos(p))).join('');
    fallenRow.innerHTML = g.players.filter(p => !p.alive)
      .map(p => `<span class="chip fallenChip">${p.name}·${ID_NAME[p.identity] || ''} 阵亡</span>`).join('');

    const cur = g.players[g.currentIdx];
    const entries = discardEntries(g);
    turnInfo.innerHTML = g.over
      ? `终局 · ${g.winner === '平局' || !g.winner ? '平局' : g.winner + '获胜'}`
      : `<b>${cur ? cur.name : ''}</b> 的回合${cur && cur.seat === g.humanSeat ? '（你）' : ''} · 牌堆 ${g.deckCount ?? g.deck.length} · 弃牌 ${entries.length}`;
    renderClock();
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
        ? `<div class="handFan">${me.hand.map((c, i) => handCardHtml(me, c, i)).join('')}</div>`
        : '<div class="spectate">你已阵亡，观战中</div>';
      selfArea.innerHTML = `<div id="handRow">${hand}</div>`;
    } else {
      selfArea.innerHTML = `<div id="handRow"><div class="spectate">全机器人演示 · 观战中</div></div>`;
    }

    actionBar.innerHTML = actionBarHtml();
    // 奶龙大笑音效：日志里出现新的 nailong 条目 → 播放（本地与联机快照同源）
    const nlCount = g.logs.reduce((n, l) => n + (l.type === 'nailong' ? 1 : 0), 0);
    if (view.nailongSeen == null) view.nailongSeen = nlCount; // 首帧基线：不重放历史
    else if (nlCount > view.nailongSeen) { view.nailongSeen = nlCount; playNailong(); }
    // 战报：只在原本贴顶时跟随新消息；玩家往下翻看历史时保留滚动位置，不被重渲染拉回顶部
    const logAtTop = logList.scrollTop <= 2;
    const logScroll = logList.scrollTop;
    logList.innerHTML = g.logs.map(l => `<div class="logline ${l.type}">${l.text}</div>`).join('');
    logList.scrollTop = logAtTop ? 0 : logScroll;
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

  // 出牌倒计时只约束"轮到人类自己的出牌阶段"；别人回合里被问的问题（万人迷/无懈等）不带死线
  function humanPlayDeadline() {
    const g = view.game;
    if (!g || g.humanSeat == null || g.phase !== '出牌') return null;
    return g.currentIdx === g.humanSeat ? (g.playDeadline ?? null) : null;
  }

  view.io = {
    async chooseCard(p, opts) {
      return ask('chooseCard', { filter: opts.filter || (() => true), hint: opts.hint || '', cancelText: opts.cancelText });
    },
    async askPlay(p, opts) {
      return ask('play', {
        playableKeys: new Set(opts.playable.map(it => cardKey(it.card))),
        canSkill: opts.canSkill, skillName: opts.skillName, hint: opts.hint || '',
        deadline: humanPlayDeadline(), // 出牌倒计时到期时自动"结束出牌"
      });
    },
    async chooseTargets(p, opts) {
      return ask('targets', {
        candidates: opts.candidates, selected: [],
        min: opts.min ?? 1, max: opts.max ?? 1, hint: opts.hint || '',
        deadline: humanPlayDeadline(), // 自己出牌阶段内选目标同样受倒计时约束
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
    // 终局双按钮：继续一局 / 回到主页面——交给宿主（main 本地 / net 联机）处理
    if (act === 'rematch' || act === 'home') {
      if (view.onGameOverAction) view.onGameOverAction(act);
      return;
    }
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

  function handleCardClick(i, el) {
    const g = view.game;
    if (g.humanSeat == null) return;
    const card = g.players[g.humanSeat].hand[i];
    const st = view.state;
    if (!card || !st) return;
    if (st.mode === 'play' && st.playableKeys.has(cardKey(card))) resolveSt({ type: 'card', card });
    else if ((st?.mode === 'chooseCard') && st.filter(card)) resolveSt(card);
    else if (isTouch) pinCardDetail(card, el); // 触屏点了当前不可用的手牌：固定查看这张牌的说明
  }

  // 详情浮层定位：桌面端跟随悬停的卡牌/技能标签，贴其右侧（空间不足翻到左侧），并夹在视口内；
  // 触屏走 CSS 顶部固定抽屉，不设内联定位（内联样式会盖掉媒体查询）
  function showDetail(el, html, pinned = false) {
    cardDetail.innerHTML = html + (pinned ? '<div class="pinNote">已固定 · 点其他位置取消</div>' : '');
    cardDetail.hidden = false;
    cardDetail.style.left = cardDetail.style.top = cardDetail.style.bottom = 'auto';
    if (isTouch) { cardDetail.style.left = cardDetail.style.top = cardDetail.style.bottom = ''; return; }
    const r = el.getBoundingClientRect();
    const w = cardDetail.offsetWidth, h = cardDetail.offsetHeight;
    if (el.closest('#handRow')) {
      // 手牌：详情浮在手牌正上方（贴边时夹进视口），不去遮挡邻近手牌
      let x = r.left + r.width / 2 - w / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
      let y = r.top - h - 10;
      if (y < 8) y = Math.min(window.innerHeight - h - 8, r.bottom + 10); // 上方空间不足 → 放下面
      cardDetail.style.left = `${x}px`;
      cardDetail.style.top = `${Math.max(8, y)}px`;
      return;
    }
    let x = r.right + 12;
    if (x + w > window.innerWidth - 8) x = r.left - 12 - w;   // 右侧放不下 → 放左边
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));  // 两边都放不下 → 夹进视口
    let y = r.top + r.height / 2 - h / 2;
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    cardDetail.style.left = `${x}px`;
    cardDetail.style.top = `${y}px`;
  }

  // 固定展示一张手牌的详情（触屏信息入口 / 弃牌堆点按）；el 用真实元素以便定位
  function pinCardDetail(card, el) {
    const tmp = document.createElement('div');
    tmp.dataset.defid = card.defId; tmp.dataset.suit = card.suit; tmp.dataset.num = card.number;
    const html = detailHtml(tmp);
    if (!html) return;
    view.pinnedKey = 'hand:' + cardKey(card);
    showDetail(el || tmp, html, true);
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
        if (html) showDetail(discCard, html, true);
      }
      return;
    }
    // 技能标签：触屏点按固定查看说明（桌面悬浮已有）；点击标签不应冒泡成选人
    const skEl = e.target.closest('.chip.skChip');
    if (skEl) {
      if (isTouch && skEl.dataset.skill) {
        const html = detailHtml(skEl);
        if (html) {
          view.pinnedKey = detailKey(skEl);
          showDetail(skEl, html, true);
        }
      }
      return;
    }
    if (view.pinnedKey) { view.pinnedKey = null; view.hoverKey = null; cardDetail.hidden = true; }
    const cardEl = e.target.closest('[data-card-idx]');
    if (cardEl) { handleCardClick(+cardEl.dataset.cardIdx, cardEl); return; }
    // 触屏：点装备/判定区悬挂牌 → 固定查看其效果（桌面用悬浮；不再冒泡成选人）
    const hangEl = e.target.closest('.card.hang');
    if (hangEl && isTouch) {
      const html = detailHtml(hangEl);
      if (html) {
        view.pinnedKey = detailKey(hangEl);
        showDetail(hangEl, html, true);
      }
      return;
    }
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
    return `${d.img ? `<img src="assets/cards/${d.id}.png" alt="">` : ''}
      <div class="dTitle ${red ? 'redSuit' : 'blackSuit'}">${d.name} ${suit ? `<small>${numStr(+el.dataset.num)}${suit}</small>` : ''}</div>
      <div class="dType">${TYPE_NAME[d.type]}${d.slot ? ' · ' + SLOT_NAME[d.slot] : ''}</div>
      ${by}
      <div class="dDesc">${d.desc || ''}</div>`;
  }
  const detailKey = el => [el.dataset.defid, el.dataset.suit, el.dataset.num, el.dataset.by, el.dataset.via, el.dataset.skill].join('|');

  root.addEventListener('mouseover', e => {
    if (isTouch) return; // 触屏无悬浮：详情走点按固定，合成 mouseover 一律忽略
    if (view.pinnedKey) return; // 已固定详情时忽略悬浮
    const el = e.target.closest('[data-defid],[data-skill]');
    if (!el) { cardDetail.hidden = true; view.hoverKey = null; return; }
    const key = detailKey(el);
    if (key === view.hoverKey) return; // 同一张牌内移动：不重设内容，避免图片闪烁/滚动丢失
    const html = detailHtml(el);
    if (!html) { cardDetail.hidden = true; view.hoverKey = null; return; }
    view.hoverKey = key;
    showDetail(el, html);
  });

  // 窗口尺寸变化后重算椭圆布局；只看宽度变化——手机浏览器地址栏伸缩只改高度，
  // 若跟着重渲染会吞掉进行中的点按（innerHTML 重建后 click 丢失）
  let rsTimer = null, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastW) < 1) return;
      lastW = window.innerWidth;
      if (view.game) render();
    }, 120);
  });

  // 出牌倒计时心跳：只刷时钟文本（整页 render 会重建 DOM 吞掉 hover）。
  // 出牌阶段的问答（askPlay / 选目标）在创建时带上 playDeadline 标记，
  // 到期自动替人类玩家"结束出牌"；其他阶段的问答不受影响。
  setInterval(() => {
    renderClock();
    const st = view.state;
    const g = view.game;
    if (!st || !g) return;
    if (st.mode === 'play') {
      const expired = st.deadline ? Date.now() >= st.deadline : g.phase !== '出牌';
      if (expired) resolveSt({ type: 'end' });
    } else if (st.mode === 'targets' && st.deadline && Date.now() >= st.deadline) {
      resolveSt(null);
    }
  }, 500);

  // ---- 流程弹层 ----
  view.attach = (g, remote = false) => {
    view.game = g;
    if (!remote) g.view = view;
    // 联机快照里的 playDeadline 是服务器时钟；换算成本地死线，避免两端时钟偏差导致倒计时错乱
    if (remote && g.playRemainMs != null) g.playDeadline = Date.now() + g.playRemainMs;
    // 联机（remote）状态快照会频繁到达，弃牌堆展开/详情固定不在此重置（换局时由 net 层调 resetPanels）
    if (!remote) view.resetPanels();
    gameScreen.hidden = false;
  };
  view.resetPanels = () => {
    view.pinnedKey = null;
    view.hoverKey = null;
    view.discExpanded = false;
    cardDetail.hidden = true;
  };
  // 终局"回到主页面"用：隐藏整块牌局（overlay 含于 gameScreen 内一并隐藏）
  view.hideGameScreen = () => { gameScreen.hidden = true; };

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

  view.showGameOver = (g, opts = {}) => {
    const rows = g.players.map(p =>
      `<tr><td>${p.name}</td><td>${ID_NAME[p.identity]}</td><td>${p.alive ? '存活' : '阵亡'}</td><td>${p.seat === g.humanSeat ? '你' : ''}</td></tr>`).join('');
    // 终局操作：本地/联机房主 → 继续一局 + 回到主页面；联机成员 → 可自行回到主页面（等待房主重开）
    const actions = opts.member
      ? '<div class="waitTip">本局已结束 · 等待房主选择继续一局…</div><div class="overBtns"><button class="btn" data-act="home">回到主页面</button></div>'
      : '<div class="overBtns"><button class="btn primary" data-act="rematch">继续一局</button><button class="btn" data-act="home">回到主页面</button></div>';
    overlay.innerHTML = `<div class="panel">
      <h1 class="winTitle">${g.winner === '平局' || !g.winner ? '平局' : g.winner + ' 获胜'}</h1>
      <table class="idTable"><tr><th>武将</th><th>身份</th><th>状态</th><th></th></tr>${rows}</table>
      ${actions}
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
