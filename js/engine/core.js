// 群友杀 - 引擎核心：游戏状态、牌堆、交互问答、距离范围、伤害治疗、濒死死亡、胜负
// 约束：js/engine/ 下所有代码不得接触 DOM，便于 Node 模拟测试（test/simulate.js）。
globalThis.QYS = globalThis.QYS || {};
QYS.core = QYS.core || {};

(function () {
  const SUITS = ['♠', '♥', '♣', '♦'];
  const colorOf = s => (s === '♥' || s === '♦') ? 'red' : 'black';
  const numStr = n => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[n] || String(n);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  Object.assign(QYS, {
    def: c => QYS.data.cards.find(d => d.id === c.defId),
    cardLabel: c => `【${QYS.def(c).name}】`,
    util: { colorOf, numStr, shuffle, sleep },
  });

  const ID_NAME = { 主: '主公', 忠: '忠臣', 反: '反贼', 内: '内奸' };
  // 各人数的身份配置（2 人局即单挑）
  const ID_TABLE = {
    2: ['主', '反'],
    3: ['主', '忠', '反'],
    4: ['主', '忠', '反', '反'],
    5: ['主', '忠', '反', '反', '内'],
    6: ['主', '忠', '忠', '反', '反', '内'],
    7: ['主', '忠', '忠', '反', '反', '反', '内'],
    8: ['主', '忠', '忠', '反', '反', '反', '反', '内'],
  };

  function buildDeck() {
    const deck = [];
    for (const d of QYS.data.cards)
      for (let i = 0; i < (d.deckCount || 0); i++)
        deck.push({ defId: d.id, suit: SUITS[(Math.random() * 4) | 0], number: 1 + ((Math.random() * 13) | 0) });
    return shuffle(deck);
  }

  QYS.core.createGame = function ({ playerCount = 5, humanSeat = 0, lordSeat = 0, names, ioFor } = {}) {
    const game = {};
    // 主公坐 lordSeat（抢主公的结算结果），其余身份随机分配
    lordSeat = ((lordSeat % playerCount) + playerCount) % playerCount;
    const ids = [...ID_TABLE[playerCount]];
    const lordId = ids.splice(ids.indexOf('主'), 1)[0];
    const rest = shuffle(ids);
    const finalIds = Array.from({ length: playerCount }, (_, i) => (i === lordSeat ? lordId : null));
    let k = 0;
    for (let i = 0; i < playerCount; i++) if (finalIds[i] === null) finalIds[i] = rest[k++];
    game.lordSeat = lordSeat;
    game.identityCounts = { 主: 0, 忠: 0, 反: 0, 内: 0 };
    finalIds.forEach(id => { game.identityCounts[id]++; });
    // 角色分配：除路人群友外每局不重复；人数超出角色池时以路人群友补位
    const uniqueChars = shuffle(QYS.data.characters.filter(c => c.id !== 'luren'));
    const luren = QYS.data.characters.find(c => c.id === 'luren');
    const chars = Array.from({ length: playerCount }, (_, s) => uniqueChars[s] || luren);

    game.players = finalIds.map((identity, seat) => {
      const ch = chars[seat % chars.length];
      const maxHp = ch.hp + (identity === '主' && playerCount > 2 ? 1 : 0);
      const p = {
        seat, identity, charId: ch.id, charName: ch.name, name: (names && names[seat]) || ch.name,
        title: ch.title, skillIds: ch.skills,
        maxHp, hp: maxHp,
        hand: [], equips: { weapon: null, armor: null, horsePlus: null, horseMinus: null }, judges: [],
        oranges: 0,          // orange 计数（秋秋人）
        alive: true, revealed: identity === '主', turn: null, io: null,
      };
      p.io = ioFor ? ioFor(p) : null;
      return p;
    });

    game.deck = buildDeck();
    game.discard = [];
    game.discardInfo = new Map(); // card -> {by, via}：弃牌区悬浮提示用
    game.logs = [];
    game.humanSeat = humanSeat;
    game.turnCount = 0;
    game.currentIdx = 0;
    game.phase = null;
    game.over = false;
    game.winner = null;
    game.warLock = null; // 小学生战争：{a, b} 被锁的双方
    game.toilet = null;  // 一起上厕所：{a, b} 距离强制为1的双方（a 为发动者）
    game.view = null; // 由界面层注入 { render() }

    // 小学生战争生效中：p 是被锁的一方（只能用/打出【杀】【闪】）
    game.isLocked = p => !!(game.warLock && (game.warLock.a === p || game.warLock.b === p));
    game.hasSkill = (p, id) => (p.skillIds || []).includes(id);

    // ---- 日志 / 刷新 ----
    game.log = (text, type = 'system') => {
      game.logs.unshift({ text, type });
      if (game.logs.length > 200) game.logs.pop();
    };
    game.update = () => { if (game.view) game.view.render(); };

    // ---- 座位 / 玩家查询 ----
    game.alive = () => game.players.filter(p => p.alive);
    game.othersAlive = p => game.players.filter(q => q.alive && q !== p);
    game.nextAliveIdx = i => {
      const n = game.players.length;
      for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (game.players[j].alive) return j; }
      return i;
    };
    game.nextAliveOf = p => game.players[game.nextAliveIdx(p.seat)];
    game.orderFrom = p => {
      const n = game.players.length, out = [];
      for (let k = 0; k < n; k++) { const q = game.players[(p.seat + k) % n]; if (q.alive) out.push(q); }
      return out;
    };
    game.aoeOrder = p => game.orderFrom(p).filter(q => q !== p);

    // ---- 区域操作 ----
    game.anyCards = p => p.hand.length > 0 || p.judges.length > 0 || Object.values(p.equips).some(Boolean);
    game.randomZoneCard = p => {
      const zones = [];
      if (p.hand.length) zones.push({ zone: 'hand' });
      for (const [slot, c] of Object.entries(p.equips)) if (c) zones.push({ zone: 'equip', slot });
      p.judges.forEach((c, i) => zones.push({ zone: 'judge', index: i }));
      const z = zones[(Math.random() * zones.length) | 0];
      if (z.zone === 'hand') return { zone: 'hand', card: p.hand[(Math.random() * p.hand.length) | 0] };
      if (z.zone === 'equip') return { zone: 'equip', slot: z.slot, card: p.equips[z.slot] };
      return { zone: 'judge', index: z.index, card: p.judges[z.index] };
    };
    game.removeZoneCard = (p, pick) => {
      if (pick.zone === 'hand') { const i = p.hand.indexOf(pick.card); if (i >= 0) p.hand.splice(i, 1); }
      else if (pick.zone === 'equip') p.equips[pick.slot] = null;
      else p.judges.splice(pick.index, 1);
    };
    // 统一弃牌入口：记录来源（谁、因何）供弃牌堆悬浮提示
    game.toDiscard = (card, by, via = '') => {
      game.discard.push(card);
      game.discardInfo.set(card, { by: by ? by.name : '未知', seat: by ? by.seat : null, via });
    };
    game.discardFromHand = (p, card, via = '弃置') => {
      const i = p.hand.indexOf(card);
      if (i >= 0) { p.hand.splice(i, 1); game.toDiscard(card, p, via); }
    };

    // ---- 牌堆 ----
    game.drawCard = () => {
      if (!game.deck.length) {
        if (!game.discard.length) return null; // TODO(规则): 极端情况（所有牌都在场上）
        const cards = game.discard.splice(0);
        cards.forEach(c => game.discardInfo.delete(c)); // 洗回牌堆后来源作废
        game.deck = shuffle(cards);
        game.log('牌堆已抽空，弃牌堆洗回牌堆', 'system');
      }
      return game.deck.pop();
    };
    game.drawCards = async (p, n) => {
      const got = [];
      for (let i = 0; i < n; i++) {
        const c = game.drawCard();
        if (!c) continue;
        // 【亚撒西】抽到杀 → 弃置并改为摸两张（每回合限一次，替换抽到的牌继续走本规则的其他转化）
        if (game.hasSkill(p, 'sk_yasaxi') && c.defId === 'sha' && p.yasaxiTurn !== game.turnCount) {
          p.yasaxiTurn = game.turnCount;
          game.toDiscard(c, p, '弃置');
          game.log(`${p.name} 的【亚撒西】触发：弃置${QYS.cardLabel(c)}，改为摸两张牌`, 'skill');
          await game.drawCards(p, 2);
          continue;
        }
        // 【orange】抽到桃 → 自动弃置并转化为 2 个 orange
        if (game.hasSkill(p, 'sk_orange') && c.defId === 'tao') {
          p.oranges = (p.oranges || 0) + 2;
          game.toDiscard(c, p, '转化');
          game.log(`${p.name} 的【orange】触发：弃置${QYS.cardLabel(c)}，获得 2 个 orange（共 ${p.oranges}）`, 'skill');
          continue;
        }
        p.hand.push(c); got.push(c);
      }
      if (got.length) { game.log(`${p.name} 摸了 ${got.length} 张牌`, 'system'); game.update(); }
      return got;
    };
    game.judge = (p, reason) => {
      const card = game.drawCard();
      if (card) game.toDiscard(card, p, '判定');
      game.log(`${p.name} 的【${reason}】判定：${card ? numStr(card.number) + card.suit : '无牌可判'}`, 'system');
      game.update();
      return { card, suit: card?.suit, number: card?.number, color: card ? colorOf(card.suit) : null };
    };

    // ---- 距离与范围 ----
    // 环距离在"存活玩家环"上计算：阵亡者离场、座位收拢（三国杀规则）
    game.distance = (a, b) => {
      // 一起上厕所：双方距离互相强制为 1（无视实际环距与坐骑）
      if (game.toilet && ((game.toilet.a === a && game.toilet.b === b) || (game.toilet.a === b && game.toilet.b === a))) return 1;
      const alive = game.players.filter(p => p.alive);
      const n = alive.length;
      const ia = alive.indexOf(a), ib = alive.indexOf(b);
      let d = n > 1 ? Math.min(Math.abs(ia - ib), n - Math.abs(ia - ib)) : 1;
      if (b.equips.horsePlus) d += 1;
      if (a.equips.horseMinus) d -= 1;
      return Math.max(1, d);
    };
    game.inShaRange = (a, b) => {
      // 武器射程在卡牌定义上（QYS.def），实例只有 defId/suit/number；狼牙棒主公技攻击范围+1
      const w = a.equips.weapon ? QYS.def(a.equips.weapon) : null;
      const langya = a.identity === '主' && game.hasSkill(a, 'sk_langyabang') ? 1 : 0;
      return game.distance(a, b) <= (w?.range ?? 1) + langya;
    };

    // ---- 问答（引擎与决策者之间的唯一通道，人类/机器人同一接口）----
    game.askCard = async (p, opts) => {
      if (!p.alive || !p.io) return null;
      // 小学生战争：被锁玩家无法使用/打出【杀】【闪】以外的牌（弃牌等非使用操作不受影响）
      if (game.isLocked(p) && opts.tag && opts.tag !== '弃牌' && opts.tag !== '技能') {
        const asked = QYS.data.cards.find(c => c.name === opts.tag);
        if (asked && asked.id !== 'sha' && asked.id !== 'shan') return null;
      }
      const card = await p.io.chooseCard(p, opts);
      // 梯子专家：本回合被盯上的角色使用任意卡牌有一半概率失败（弃牌不受影响）
      if (card && p.ladderFail && opts.tag !== '弃牌' && Math.random() < 0.5) {
        game.log(`${p.name} 的卡牌因【梯子专家】造成的网络波动而使用失败`, 'skill');
        game.update();
        return null;
      }
      return card;
    };
    game.askBool = async (p, hint, extra = {}) => {
      if (!p.alive || !p.io) return false;
      if (game.isLocked(p) && extra.tag === '无懈') return false; // 被锁玩家不能无懈
      return p.io.chooseBool(p, { hint, ...extra });
    };
    game.askTargets = async (p, opts) => {
      opts.candidates = opts.candidates.filter(q => q.alive);
      if (!opts.candidates.length || !p.io) return null;
      return p.io.chooseTargets(p, opts);
    };
    game.askResponse = (p, name, hint) => game.askCard(p, {
      filter: c => QYS.def(c).name === name, tag: name,
      hint: hint || `请打出【${name}】`, cancelText: '放弃',
    });

    // 无懈可击抵消链：依次询问持有者，链长上限 3 防死循环
    // TODO(规则): 原版可无限嵌套，且无懈也可针对"无懈"本身；这里用次数奇偶近似
    game.askWuxie = async ({ user, card, target }) => {
      let count = 0, last = user;
      const label = QYS.cardLabel(card);
      while (count < 3) {
        let used = false;
        for (const p of game.alive()) {
          if (p === last) continue;
          if (!p.hand.some(c => QYS.def(c).id === 'wuxie')) continue;
          const hint = `${user.name} 的${label}${target ? `（目标 ${target.name}）` : ''}即将生效，是否使用【无懈可击】？`;
          if (await game.askBool(p, hint, { tag: '无懈' })) {
            game.discardFromHand(p, p.hand.find(c => QYS.def(c).id === 'wuxie'));
            game.log(`${p.name} 打出了【无懈可击】`, 'use');
            count++; last = p; used = true;
            break;
          }
        }
        if (!used) break;
      }
      if (count % 2 === 1) { game.log(`${label}被抵消`, 'system'); return true; }
      return false;
    };

    // ---- 战斗结算 ----
    // 闪避判定：八卦阵 → 【闪】 → 被动技能（一几一几仅被杀指定、万人迷任意场合）。被【杀】与【万箭齐发】共用。
    // cause: 'sha' 被杀指定为目标 | 'wanjian' 万箭齐发
    game.dodgeCheck = async (target, cause = 'sha') => {
      const armorDef = target.equips.armor ? QYS.def(target.equips.armor) : null;
      if (armorDef?.id === 'bagua' && await game.askBool(target, '是否发动【八卦阵】？', { tag: '八卦' })) {
        const j = game.judge(target, '八卦阵');
        if (j.color === 'red') { game.log(`八卦阵判定为红色，视为打出【闪】`, 'use'); game.update(); return true; }
      }
      const shan = await game.askResponse(target, '闪');
      if (shan) { game.discardFromHand(target, shan, '打出'); game.log(`${target.name} 打出了【闪】`, 'use'); game.update(); return true; }

      // 【一几一几】：仅被【杀】指定为目标时可把任意手牌当【闪】（万箭齐发、被万人迷选中代打均不触发）
      if (game.hasSkill(target, 'sk_yijiyiji') && cause === 'sha' && target.hand.length) {
        if (await game.askBool(target, '是否发动【一几一几】？将任意一张手牌当作【闪】打出', { tag: '技能' })) {
          const card = await game.askCard(target, { filter: () => true, tag: '技能', hint: '【一几一几】：选择一张手牌当作【闪】打出' });
          if (card && target.hand.includes(card)) {
            game.discardFromHand(target, card, '打出');
            game.log(`${target.name} 发动【一几一几】，将${QYS.cardLabel(card)}当作【闪】打出`, 'skill');
            game.update();
            return true;
          }
        }
      }

      // 【万人迷】：场上任一其他角色替打【闪】；其无闪则失去1点体力（且本次仍视为未闪避）
      if (game.hasSkill(target, 'sk_wanrenmi')) {
        const cands = game.alive().filter(q => q !== target);
        if (cands.length && await game.askBool(target, '是否发动【万人迷】？选择一名角色替你打出【闪】，若其没有【闪】则其失去1点体力', { tag: '技能' })) {
          const sel = await game.askTargets(target, { candidates: cands, min: 1, max: 1, hint: '【万人迷】：选择替你打出【闪】的角色' });
          const helper = sel && sel[0];
          if (helper) {
            game.log(`${target.name} 发动【万人迷】，指定 ${helper.name} 替其打出【闪】`, 'skill');
            game.update();
            // 直接询问【闪】：helper 自己的一几一几在此场合不触发
            const helperShan = await game.askResponse(helper, '闪', `替 ${target.name} 打出【闪】？（【万人迷】）`);
            if (helperShan && helper.hand.includes(helperShan)) {
              game.discardFromHand(helper, helperShan, '打出');
              game.log(`${helper.name} 替 ${target.name} 打出了【闪】`, 'use');
              game.update();
              return true;
            }
            game.log(`${helper.name} 没有【闪】可打出`, 'system');
            await game.loseHp(helper, 1, '万人迷');
          }
        }
      }
      return false;
    };
    // 结算一次【杀】：目标闪避成功返回 false；未闪避（造成伤害）返回 true（灌汤包等技能依此判定）
    game.shaResolve = async (source, target, bonus = 0) => {
      if (!target.alive) return false;
      // 新疆网络：对你使用的【杀】一半概率因"网络波动"自动失效（无需闪避）
      if (game.hasSkill(target, 'sk_xinjiangwang') && Math.random() < 0.5) {
        game.log(`${target.name} 的【新疆网络】波动，${source ? source.name + ' 的' : ''}【杀】自动失效`, 'skill');
        game.update();
        return false;
      }
      if (!(await game.dodgeCheck(target, 'sha'))) {
        await game.damage({ source, target, amount: 1 + bonus, tag: '杀' });
        return true;
      }
      return false;
    };

    game.damage = async ({ source, target, amount = 1, tag }) => {
      if (game.over || !target || !target.alive || amount <= 0) return;
      const payload = { source, target, amount, tag };
      await game.emit('beforeDamaged', payload);
      amount = payload.amount;
      if (amount <= 0) return;
      target.hp -= amount;
      game.log(`${target.name} 受到 ${amount} 点${tag ? `【${tag}】` : ''}伤害${source ? `（来自 ${source.name}）` : ''}`, 'damage');
      game.update();
      await game.emit('afterDamaged', payload);
      if (target.alive && target.hp <= 0) await game.dying(target, source);
    };

    game.heal = async (t, n = 1, source) => {
      if (!t.alive || t.hp >= t.maxHp) return;
      t.hp = Math.min(t.hp + n, t.maxHp);
      game.log(`${t.name} 回复了 ${n} 点体力${source && source !== t ? `（来自 ${source.name}）` : ''}`, 'heal');
      game.update();
    };

    // 体力流失（非伤害，不触发受伤相关技能）：万人迷罚体力等场合使用
    game.loseHp = async (t, n = 1, reason = '') => {
      if (game.over || !t || !t.alive || n <= 0) return;
      t.hp -= n;
      game.log(`${t.name} 失去了 ${n} 点体力${reason ? `（${reason}）` : ''}`, 'damage');
      game.update();
      if (t.hp <= 0) await game.dying(t, null);
    };

    game.dying = async (t, source) => {
      game.log(`${t.name} 濒死！`, 'damage');
      game.update();
      await game.emit('onDying', { target: t, source });
      for (const p of game.orderFrom(t)) {
        while (t.alive && t.hp <= 0) {
          const tao = await game.askCard(p, {
            filter: c => QYS.def(c).id === 'tao', tag: '桃',
            hint: `${t.name} 濒死，是否使用【桃】？`, cancelText: '不救',
          });
          if (!tao || QYS.def(tao).id !== 'tao') break;
          game.discardFromHand(p, tao, '使用');
          await game.heal(t, 1, p);
        }
        if (t.hp > 0) break;
      }
      if (t.alive && t.hp <= 0) await game.die(t, source);
    };

    const dropAll = p => {
      for (const c of p.hand.splice(0)) game.toDiscard(c, p, '弃置');
      for (const [slot, c] of Object.entries(p.equips)) { if (c) { game.toDiscard(c, p, '弃置'); p.equips[slot] = null; } }
      for (const c of p.judges.splice(0)) game.toDiscard(c, p, '弃置');
    };

    game.die = async (t, source) => {
      t.alive = false;
      t.revealed = true;
      if (game.warLock && game.warLock.a === t) game.warLock = null; // 发动者死亡，小学生战争提前结束
      if (game.toilet && (game.toilet.a === t || game.toilet.b === t)) game.toilet = null; // 任一方死亡，一起上厕所结束
      dropAll(t);
      game.log(`${t.name} 阵亡，身份是【${ID_NAME[t.identity]}】`, 'system');
      if (t.seat === game.humanSeat) game.log('你已阵亡，进入观战模式', 'system');
      game.update();
      await game.emit('onDeath', { target: t, source });
      if (source && source.alive) {
        if (t.identity === '反') {
          game.log(`${source.name} 击杀反贼，摸三张牌`, 'system');
          await game.drawCards(source, 3);
        } else if (t.identity === '忠' && source.identity === '主') {
          game.log('主公误杀忠臣，弃置所有牌', 'system');
          dropAll(source);
        }
      }
      game.checkVictory();
    };

    game.checkVictory = () => {
      if (game.over) return;
      const lordAlive = game.players.some(p => p.alive && p.identity === '主');
      if (!lordAlive) {
        const alive = game.players.filter(p => p.alive);
        if (alive.length === 1 && alive[0].identity === '内') return game.win('内奸');
        return game.win('反贼');
      }
      if (!game.players.some(p => p.alive && (p.identity === '反' || p.identity === '内'))) return game.win('主公方');
    };
    game.win = w => {
      game.over = true;
      game.winner = w;
      game.log(`—— 【${w}】获胜 ——`, 'turn');
      game.update();
    };

    // ---- 触发技钩子分发（hooks 存在即触发，不限技能类型——主动技也可带触发钩子）----
    game.emit = async (name, payload) => {
      for (const p of game.alive()) {
        for (const skId of p.skillIds) {
          const sk = QYS.data.skills[skId];
          if (sk && sk.hooks && sk.hooks[name]) await sk.hooks[name](game, p, payload);
        }
      }
    };

    // 起始手牌
    for (const p of game.players)
      for (let i = 0; i < 4; i++) { const c = game.drawCard(); if (c) p.hand.push(c); }

    return game;
  };

  QYS.core.ID_NAME = ID_NAME;

  const cardKey = c => `${c.defId}|${c.suit}|${c.number}`;
  QYS.core.cardKey = cardKey;

  // 按座位生成可见信息快照（联机客户端的渲染数据源，保证手牌/身份隐私）
  QYS.core.snapshot = function (game, seat) {
    return {
      humanSeat: seat,
      lordSeat: game.lordSeat,
      identityCounts: { ...game.identityCounts },
      over: game.over, winner: game.winner, phase: game.phase,
      currentIdx: game.currentIdx, turnCount: game.turnCount,
      deckCount: game.deck.length,
      logs: game.logs.slice(0, 60),
      discardEntries: game.discard.slice().reverse().map(c => {
        const i = game.discardInfo.get(c) || {};
        return { card: { ...c }, by: i.by || '未知', seat: i.seat ?? null, via: i.via || '' };
      }),
      players: game.players.map(p => ({
        seat: p.seat, name: p.name, title: p.title, charId: p.charId, charName: p.charName,
        hp: p.hp, maxHp: p.maxHp, alive: p.alive, revealed: p.revealed,
        identity: (p.revealed || game.over || p.seat === seat) ? p.identity : null,
        skillIds: p.skillIds,
        oranges: p.oranges || 0,
        toilet: !!(game.toilet && (game.toilet.a === p || game.toilet.b === p)),
        ladder: !!p.ladderFail,
        locked: game.isLocked(p),
        handCount: p.hand.length,
        hand: p.seat === seat ? p.hand.map(c => ({ ...c })) : undefined,
        equips: Object.fromEntries(Object.entries(p.equips).map(([k, c]) => [k, c ? { ...c } : null])),
        judges: p.judges.map(c => ({ ...c })),
      })),
    };
  };
})();
