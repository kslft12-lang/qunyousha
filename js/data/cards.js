// 群友杀 - 卡牌数据（占位文案，可直接修改）
// 添加新卡牌：往 QYS.data.cards 里加一条即可，牌堆按 deckCount 自动展开。
// 卡面图约定：assets/cards/<id>.png（悬停详情里展示，缺图自动隐藏）。
//
// 卡牌字段：
// id        唯一标识（同时是图片文件名）
// name      显示名
// type      basic 基本牌 | trick 锦囊 | delayed 延迟锦囊 | equip 装备
// slot      equip 专用：weapon|armor|horsePlus|horseMinus
// range     weapon 专用：攻击范围
// unlimitedSha  weapon 专用：出牌阶段【杀】不限次数
// deckCount 牌堆数量
// desc      规则描述（悬停详情展示）
// noPlay    true = 只能被动打出（如闪/无懈可击），不进入出牌阶段
// canUse(game, user)      出牌阶段能否使用（不填默认可以）
// target    { count, candidates(game, user) => Player[] }
// effect(game, ctx)       使用结算，ctx = { user, targets, card }
// onJudge(game, player, judge, card)  延迟锦囊判定结算，返回 'pass' 表示移至下家判定区
globalThis.QYS = globalThis.QYS || {};
QYS.data = QYS.data || {};

QYS.data.cards = [
  // ---- 基本牌 ----
  {
    id: 'sha', name: '杀', type: 'basic', deckCount: 30,
    desc: '出牌阶段，对你攻击范围内的一名其他角色使用。目标需打出【闪】，否则受到1点伤害。每回合限使用一次（【诸葛连弩】与【灌汤包】除外）。',
    target: {
      count: 1,
      candidates: (g, u) => {
        const base = g.othersAlive(u).filter(t => g.inShaRange(u, t));
        if (!g.hasSkill(u, 'sk_guantangbao')) return base;
        // 灌汤包：场上 1 血角色无视距离均可作为目标
        const extra = g.othersAlive(u).filter(t => t.hp === 1 && !base.includes(t));
        return [...base, ...extra];
      },
    },
    canUse: (g, u) => {
      const w = u.equips.weapon ? QYS.def(u.equips.weapon) : null;
      // 狼牙棒（主公技）：诸葛连弩对其无效
      const langyaLord = u.identity === '主' && g.hasSkill(u, 'sk_langyabang');
      if (w && w.unlimitedSha && !langyaLord) return true;
      // 每回合杀上限：灌汤包 2 张；太刀黄刃（等级≥2）2 张
      const limit = Math.max(g.hasSkill(u, 'sk_guantangbao') ? 2 : 1, g.hasSkill(u, 'sk_taidao') && (u.blade || 0) >= 2 ? 2 : 1);
      return u.turn.shaUsed < limit;
    },
    async effect(g, { user, targets }) {
      const tgt = targets[0];
      // 太刀高手：每使用一次杀永久升级（无→白刃→黄刃→红刃，升级当次即生效）
      if (g.hasSkill(user, 'sk_taidao') && user.blade < 3) {
        user.blade++;
        g.log(`【太刀高手】${user.name} 的太刀升至 ${['无', '白刃（攻击范围+1）', '黄刃（每回合两张杀）', '红刃（杀伤害+1）'][user.blade]}`, 'skill');
      }
      // TODO(规则): 灌汤包摸牌条件取"使用时目标为1血"，命中未被闪避即摸
      const guantang = g.hasSkill(user, 'sk_guantangbao') && tgt.hp === 1;
      // 狼牙棒（主公技）杀伤害+1；太刀红刃（等级3）杀伤害+1
      const langya = user.identity === '主' && g.hasSkill(user, 'sk_langyabang') ? 1 : 0;
      const bladeDmg = g.hasSkill(user, 'sk_taidao') && user.blade >= 3 ? 1 : 0;
      const bonus = (user.turn.wine ? 1 : 0) + langya + bladeDmg;
      user.turn.wine = false;
      user.turn.shaUsed++;
      const hit = await g.shaResolve(user, tgt, bonus);
      if (guantang && hit) await g.drawCards(user, 1);
    },
  },
  {
    id: 'shan', name: '闪', type: 'basic', deckCount: 22, noPlay: true,
    desc: '当你成为【杀】或【万箭齐发】的目标时打出，令该牌对你无效。',
  },
  {
    id: 'tao', name: '桃', type: 'basic', deckCount: 10,
    desc: '出牌阶段对自己使用，回复1点体力；或有角色濒死时对其使用，将其体力回复至1点。',
    canUse: (g, u) => u.hp < u.maxHp,
    async effect(g, { user }) { await g.heal(user, 1); },
  },
  {
    id: 'jiu', name: '酒', type: 'basic', deckCount: 4,
    desc: '出牌阶段对自己使用：已受伤则回复1点体力；未受伤则本回合下一张【杀】伤害+1。',
    canUse: (g, u) => u.hp < u.maxHp || !u.turn.wine,
    async effect(g, { user }) {
      if (user.hp < user.maxHp) await g.heal(user, 1);
      else { user.turn.wine = true; g.log(`${user.name} 饮下【酒】，本回合下一张【杀】伤害+1`, 'use'); }
    },
  },

  // ---- 锦囊牌 ----
  {
    id: 'wuzhong', name: '无中生有', type: 'trick', deckCount: 4,
    desc: '摸两张牌。',
    async effect(g, { user, card }) {
      if (!(await g.askWuxie({ user, card }))) await g.drawCards(user, 2);
    },
  },
  {
    id: 'chaiqiao', name: '过河拆桥', type: 'trick', deckCount: 6,
    desc: '弃置一名其他角色区域里的一张牌。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u).filter(t => g.anyCards(t)) },
    async effect(g, { user, targets, card }) {
      const t = targets[0];
      if (await g.askWuxie({ user, card, target: t })) return;
      const pick = g.randomZoneCard(t);
      if (!pick) return;
      g.removeZoneCard(t, pick);
      g.toDiscard(pick.card, user, '弃置');
      g.log(`${user.name} 弃置了 ${t.name} 区域的${QYS.cardLabel(pick.card)}`, 'use');
    },
  },
  {
    id: 'shunshou', name: '顺手牵羊', type: 'trick', deckCount: 5,
    desc: '获得距离1以内的一名其他角色区域里的一张牌。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u).filter(t => g.anyCards(t) && g.distance(u, t) <= 1) },
    async effect(g, { user, targets, card }) {
      const t = targets[0];
      if (await g.askWuxie({ user, card, target: t })) return;
      const pick = g.randomZoneCard(t);
      if (!pick) return;
      g.removeZoneCard(t, pick);
      user.hand.push(pick.card);
      g.log(`${user.name} 获得了 ${t.name} 区域的${QYS.cardLabel(pick.card)}`, 'use');
    },
  },
  {
    id: 'juedou', name: '决斗', type: 'trick', deckCount: 3,
    desc: '与目标角色决斗：由其开始轮流打出【杀】，首先打不出的一方受到1点伤害。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u) },
    async effect(g, { user, targets, card }) {
      const t = targets[0];
      if (await g.askWuxie({ user, card, target: t })) return;
      let responder = t, attacker = user;
      while (!g.over && responder.alive && attacker.alive) {
        const sha = await g.askResponse(responder, '杀');
        if (!sha) {
          await g.damage({ source: attacker, target: responder, amount: 1, tag: '决斗' });
          return;
        }
        g.discardFromHand(responder, sha, '打出');
        g.log(`${responder.name} 打出了【杀】`, 'use');
        [responder, attacker] = [attacker, responder];
      }
    },
  },
  {
    id: 'nanman', name: '南蛮入侵', type: 'trick', deckCount: 3,
    desc: '其他所有角色需打出一张【杀】，否则受到1点伤害。',
    async effect(g, { user, card }) {
      for (const t of g.aoeOrder(user)) {
        if (g.over || !t.alive) return;
        if (await g.askWuxie({ user, card, target: t })) continue;
        const sha = await g.askResponse(t, '杀');
        if (sha) { g.discardFromHand(t, sha, '打出'); g.log(`${t.name} 打出了【杀】`, 'use'); }
        else await g.damage({ source: user, target: t, amount: 1, tag: '南蛮入侵' });
      }
    },
  },
  {
    id: 'wanjian', name: '万箭齐发', type: 'trick', deckCount: 2,
    desc: '其他所有角色需打出一张【闪】，否则受到1点伤害。',
    async effect(g, { user, card }) {
      for (const t of g.aoeOrder(user)) {
        if (g.over || !t.alive) return;
        if (await g.askWuxie({ user, card, target: t })) continue;
        if (!(await g.dodgeCheck(t, 'wanjian'))) await g.damage({ source: user, target: t, amount: 1, tag: '万箭齐发' });
      }
    },
  },
  {
    id: 'taoyuan', name: '桃园结义', type: 'trick', deckCount: 2,
    desc: '所有角色回复1点体力。',
    async effect(g, { user, card }) {
      for (const t of g.orderFrom(user)) {
        if (g.over) return;
        if (await g.askWuxie({ user, card, target: t })) continue;
        if (t.hp < t.maxHp) await g.heal(t, 1, user);
      }
    },
  },
  {
    id: 'wugu', name: '五谷丰登', type: 'trick', deckCount: 2,
    // TODO(规则): 原版为亮出人数张牌供各角色挑选，这里简化为各摸一张
    desc: '所有角色各摸一张牌。',
    async effect(g, { user, card }) {
      for (const t of g.orderFrom(user)) {
        if (g.over) return;
        if (await g.askWuxie({ user, card, target: t })) continue;
        await g.drawCards(t, 1);
      }
    },
  },
  {
    id: 'wuxie', name: '无懈可击', type: 'trick', deckCount: 4, noPlay: true,
    desc: '一张锦囊牌生效前打出，抵消之。',
  },

  // ---- 延迟锦囊 ----
  {
    id: 'lebu', name: '乐不思蜀', type: 'delayed', deckCount: 3,
    desc: '出牌阶段置于一名其他角色的判定区：其判定阶段判定，若结果为黑桃，跳过其出牌阶段。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u) },
    async effect(g, { targets, card }) {
      targets[0].judges.push(card);
      g.log(`${targets[0].name} 的判定区被放置了【乐不思蜀】`, 'use');
    },
    onJudge(g, p, j) {
      if (j.suit === '♠') {
        g.log(`${p.name} 判定为黑桃，将跳过出牌阶段`, 'system');
        p.turn.skipPlay = true;
      }
    },
  },
  {
    id: 'shandian', name: '闪电', type: 'delayed', deckCount: 2,
    desc: '置于你的判定区：判定阶段判定，若为黑桃2~9你受到3点雷电伤害；否则移至下家的判定区。',
    async effect(g, { user, card }) {
      user.judges.push(card);
      g.log(`${user.name} 的判定区被放置了【闪电】`, 'use');
    },
    async onJudge(g, p, j) {
      if (j.suit === '♠' && j.number >= 2 && j.number <= 9) {
        g.log('【闪电】命中！', 'damage');
        await g.damage({ source: null, target: p, amount: 3, tag: '雷电' });
        return 'discard';
      }
      return 'pass';
    },
  },

  // ---- 装备牌 ----
  {
    id: 'liannu', name: '诸葛连弩', type: 'equip', slot: 'weapon', range: 1, unlimitedSha: true, deckCount: 1,
    desc: '攻击范围1。出牌阶段你可以使用任意张【杀】。',
  },
  {
    id: 'qinglong', name: '青龙偃月刀', type: 'equip', slot: 'weapon', range: 3, deckCount: 1,
    desc: '攻击范围3。', // TODO(规则): 原版效果"杀被闪抵消后可追加一张杀"未实现
  },
  {
    id: 'bagua', name: '八卦阵', type: 'equip', slot: 'armor', deckCount: 1,
    desc: '当你需要使用或打出【闪】时，你可以判定：若结果为红色，视为你打出了一张【闪】。',
  },
  {
    id: 'ma_def', name: '+1马', type: 'equip', slot: 'horsePlus', deckCount: 3,
    desc: '其他角色计算与你的距离+1。',
  },
  {
    id: 'ma_atk', name: '-1马', type: 'equip', slot: 'horseMinus', deckCount: 3,
    desc: '你计算与其他角色的距离-1。',
  },
];
