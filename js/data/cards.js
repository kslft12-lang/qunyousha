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

// 闻着凑吃着香（凑鸽子）：以凑鸽子为目标时不限杀次数；次数用尽时杀只能以凑鸽子为目标
QYS.wenzheShaLimit = (g, u) => {
  const w = u.equips.weapon ? QYS.def(u.equips.weapon) : null;
  const langyaLord = u.identity === '主' && g.hasSkill(u, 'sk_langyabang');
  if (w && w.unlimitedSha && !langyaLord) return Infinity; // 诸葛连弩：本就不限
  return Math.max(g.hasSkill(u, 'sk_guantangbao') ? 2 : 1, g.hasSkill(u, 'sk_taidao') && (u.blade || 0) >= 2 ? 2 : 1);
};

QYS.data.cards = [
  // ---- 基本牌 ----
  {
    id: 'sha', name: '杀', type: 'basic', deckCount: 30, img: true,
    desc: '出牌阶段，对你攻击范围内的一名其他角色使用。目标需打出【闪】，否则受到1点伤害。每回合限使用一次（【诸葛连弩】与【灌汤包】除外）。',
    target: {
      count: 1,
      // 方天画戟：此【杀】为最后一张手牌时可指定至多 3 名目标
      max: (g, u) => u.equips.weapon && QYS.def(u.equips.weapon).id === 'fangtian' && u.hand.length === 1 ? 3 : 1,
      candidates: (g, u) => {
        // 魅惑菇：被魅惑者（u.charmFrom 指向使用者）无法将其选为【杀】的目标
        const base = g.othersAlive(u).filter(t => g.inShaRange(u, t) && u.charmFrom !== t);
        // 灌汤包：场上 1 血角色无视距离均可作为目标
        const extra = g.hasSkill(u, 'sk_guantangbao')
          ? g.othersAlive(u).filter(t => t.hp === 1 && !base.includes(t) && u.charmFrom !== t)
          : [];
        const all = [...base, ...extra];
        // 闻着凑吃着香：杀次数用尽时，只能以凑鸽子为目标
        if (u.turn.shaUsed >= QYS.wenzheShaLimit(g, u)) return all.filter(t => g.hasSkill(t, 'sk_wenzhe'));
        return all;
      },
    },
    canUse: (g, u) => {
      if (u.turn.shaUsed >= QYS.wenzheShaLimit(g, u)) {
        // 次数用尽：范围内仍有凑鸽子（闻着凑吃着香）→ 仍可出杀（目标被限定为凑鸽子）
        return g.othersAlive(u).some(t => g.hasSkill(t, 'sk_wenzhe') && g.inShaRange(u, t) && u.charmFrom !== t);
      }
      return true;
    },
    async effect(g, { user, targets, card }) {
      const ts = targets.filter(t => t.alive);
      // 太刀高手：每使用一次杀永久升级（无→白刃→黄刃→红刃，升级当次即生效；多人目标也只升一次）
      if (g.hasSkill(user, 'sk_taidao') && user.blade < 3) {
        user.blade++;
        g.log(`【太刀高手】${user.name} 的太刀升至 ${['无', '白刃（攻击范围+1）', '黄刃（每回合两张杀）', '红刃（杀伤害+1）'][user.blade]}`, 'skill');
      }
      // 狼牙棒（主公技）杀伤害+1；太刀红刃（等级3）杀伤害+1；真蓄斩蓄力每格+1（一次性消耗，+3 时无法被闪避或无效）
      const langya = user.identity === '主' && g.hasSkill(user, 'sk_langyabang') ? 1 : 0;
      const bladeDmg = g.hasSkill(user, 'sk_taidao') && user.blade >= 3 ? 1 : 0;
      const chargeBonus = g.consumeCharge(user);
      if (chargeBonus > 0) g.log(`【真蓄斩】${user.name} 释放 ${chargeBonus} 格蓄力，此【杀】威力+${chargeBonus}${chargeBonus >= 3 ? '（无法被闪避或无效）' : ''}`, 'skill');
      const base = (user.turn.wine ? 1 : 0) + langya + bladeDmg + chargeBonus;
      const undodgeable = chargeBonus >= 3;
      // TODO(规则): 灌汤包摸牌条件取"使用时目标为1血"，命中未被闪避即摸（多人目标命中任意一名即摸一张）
      const guantang = g.hasSkill(user, 'sk_guantangbao') && ts.some(t => t.hp === 1);
      user.turn.wine = false;
      user.turn.shaUsed++;
      let anyHit = false;
      for (const tgt of ts) {
        if (g.over) break;
        // 古锭刀：对已受伤角色的杀伤害+1
        const guding = user.equips.weapon && QYS.def(user.equips.weapon).id === 'gudingdao' && tgt.hp < tgt.maxHp ? 1 : 0;
        if (await g.shaResolve(user, tgt, base + guding, card, { undodgeable })) anyHit = true;
      }
      if (guantang && anyHit) await g.drawCards(user, 1);
    },
  },
  {
    id: 'shan', name: '闪', type: 'basic', deckCount: 22, noPlay: true, img: true,
    desc: '当你成为【杀】或【万箭齐发】的目标时打出，令该牌对你无效。',
  },
  {
    id: 'tao', name: '桃', type: 'basic', deckCount: 10, img: true,
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
    id: 'wuzhong', name: '无中生有', type: 'trick', deckCount: 4, img: true,
    desc: '摸两张牌。',
    async effect(g, { user, card }) {
      if (!(await g.askWuxie({ user, card }))) await g.drawCards(user, 2);
    },
  },
  {
    id: 'chaiqiao', name: '过河拆桥', type: 'trick', deckCount: 6, img: true,
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
    id: 'shunshou', name: '顺手牵羊', type: 'trick', deckCount: 5, img: true,
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
    id: 'juedou', name: '决斗', type: 'trick', deckCount: 3, img: true,
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
        g.log(`${responder.name} 打出了${QYS.cardLabel(sha)}`, 'use');
        [responder, attacker] = [attacker, responder];
      }
    },
  },
  {
    id: 'nanman', name: '南蛮入侵', type: 'trick', deckCount: 3,
    desc: '其他所有角色需打出一张【杀】，否则受到1点伤害。',
    async effect(g, { user, card }) {
      for (const t of g.aoeOrder(user)) {
        if (g.over) return;
        if (!t.alive) continue; // 目标列表是结算前快照，中途阵亡者跳过，其余目标继续
        if (t.equips.armor && QYS.def(t.equips.armor).id === 'tengjia') {
          g.log(`${t.name} 的【藤甲】令【南蛮入侵】无效`, 'skill');
          continue;
        }
        if (await g.askWuxie({ user, card, target: t })) continue;
        const sha = await g.askResponse(t, '杀');
        if (sha) { g.discardFromHand(t, sha, '打出'); g.log(`${t.name} 打出了${QYS.cardLabel(sha)}`, 'use'); }
        else await g.damage({ source: user, target: t, amount: 1, tag: '南蛮入侵' });
      }
    },
  },
  {
    id: 'wanjian', name: '万箭齐发', type: 'trick', deckCount: 2,
    desc: '其他所有角色需打出一张【闪】，否则受到1点伤害。',
    async effect(g, { user, card }) {
      for (const t of g.aoeOrder(user)) {
        if (g.over) return;
        if (!t.alive) continue; // 目标列表是结算前快照，中途阵亡者跳过，其余目标继续
        if (t.equips.armor && QYS.def(t.equips.armor).id === 'tengjia') {
          g.log(`${t.name} 的【藤甲】令【万箭齐发】无效`, 'skill');
          continue;
        }
        if (await g.askWuxie({ user, card, target: t })) continue;
        if (!(await g.dodgeCheck(t, 'wanjian', user))) await g.damage({ source: user, target: t, amount: 1, tag: '万箭齐发' });
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
    id: 'wuxie', name: '无懈可击', type: 'trick', deckCount: 6, noPlay: true, img: true,
    desc: '一张锦囊牌生效前打出，抵消之。',
  },
  {
    // 臭鸡炸炸炸：不进初始牌堆，游戏开始时由凑鸽子的【臭鸡炸炸炸】技能洗入；
    // 他人抽到时在 core.js takeDrawnCard 放回牌堆重新抽牌
    id: 'choujizhazha', name: '臭鸡炸炸炸', type: 'trick', deckCount: 0,
    desc: '特殊锦囊牌，只有【凑鸽子】可以使用：出牌阶段指定一名其他角色，丢弃其所有【桃】和【酒】，然后令其生命值归零（进入濒死）。其他角色抽到此牌时，将其放回牌堆并重新抽一张牌。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u) },
    async effect(g, { user, targets, card }) {
      const t = targets[0];
      if (await g.askWuxie({ user, card, target: t })) return;
      // 先丢弃其所有桃/酒（拆掉自救手段），再令生命值归零进入濒死
      const junks = t.hand.filter(c => ['tao', 'jiu'].includes(QYS.def(c).id));
      for (const c of junks) g.discardFromHand(t, c, '弃置');
      if (junks.length) g.log(`【臭鸡炸炸炸】丢弃了 ${t.name} 的 ${junks.length} 张【桃】/【酒】`, 'use');
      await g.loseHp(t, t.hp, '臭鸡炸炸炸');
    },
  },

  // ---- 延迟锦囊 ----
  {
    id: 'lebu', name: '乐不思蜀', type: 'delayed', deckCount: 3, img: true,
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
    id: 'bingliang', name: '兵粮寸断', type: 'delayed', deckCount: 3, img: true,
    desc: '出牌阶段，对距离1以内的一名其他角色使用，置于其判定区：其判定阶段判定，若结果不为♣，其跳过摸牌阶段。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u).filter(t => g.distance(u, t) <= 1) },
    async effect(g, { targets, card }) {
      targets[0].judges.push(card);
      g.log(`${targets[0].name} 的判定区被放置了【兵粮寸断】`, 'use');
    },
    onJudge(g, p, j) {
      if (j.suit !== '♣') {
        g.log(`${p.name} 判定不为♣，将跳过摸牌阶段`, 'system');
        p.turn.skipDraw = true;
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
  {
    id: 'qinggangjian', name: '青釭剑', type: 'equip', slot: 'weapon', range: 2, deckCount: 1,
    desc: '攻击范围2。锁定技，你使用【杀】无视目标角色的防具（八卦阵、仁王盾、藤甲、白银狮子、护心镜均失效）。',
  },
  {
    id: 'gudingdao', name: '古锭刀', type: 'equip', slot: 'weapon', range: 2, deckCount: 1,
    desc: '攻击范围2。锁定技，你使用【杀】指定已受伤的角色为目标后，此【杀】对其伤害+1。',
  },
  {
    id: 'guanshifu', name: '贯石斧', type: 'equip', slot: 'weapon', range: 3, deckCount: 1,
    desc: '攻击范围3。当你使用的【杀】被【闪】抵消后，你可以弃置两张手牌，令此【杀】依然生效。',
  },
  {
    id: 'fangtian', name: '方天画戟', type: 'equip', slot: 'weapon', range: 4, deckCount: 1,
    desc: '攻击范围4。当你使用的【杀】是你最后的手牌时，此【杀】可以指定至多三名目标。',
  },
  {
    // 太刀（花生酱酱酱专属强化）：刃不降实现在 core.js shaHit；闪/一几一几摸牌实现在 core.js dodgeCheck
    id: 'taidao', name: '太刀', type: 'equip', slot: 'weapon', range: 2, deckCount: 1,
    desc: '攻击范围2。【花生酱酱酱】装备时：太刀的刃等级永不下降；你使用或打出【闪】时（【一几一几】将手牌当作【闪】也算）摸一张牌。',
  },
  {
    // 大剑（斯坦尊尊专属强化）：蓄力加成实现在 sk_zhenxuzhan 的 phaseEnd 钩子
    id: 'dajian', name: '大剑', type: 'equip', slot: 'weapon', range: 2, deckCount: 1,
    desc: '攻击范围2。【斯坦尊尊】装备时：每回合结束时蓄力值+1（无论本回合是否使用过【杀】）。',
  },
  {
    id: 'qilingong', name: '麒麟弓', type: 'equip', slot: 'weapon', range: 5, deckCount: 1,
    desc: '攻击范围5。当你使用【杀】对目标角色造成伤害后，你可以弃置其装备区里的一张坐骑牌。',
  },
  {
    id: 'renwang', name: '仁王盾', type: 'equip', slot: 'armor', deckCount: 1,
    desc: '锁定技。黑色的【杀】对你无效。',
  },
  {
    id: 'tengjia', name: '藤甲', type: 'equip', slot: 'armor', deckCount: 1,
    desc: '锁定技。【杀】、【南蛮入侵】与【万箭齐发】对你无效。（本作无火系伤害，火焰伤害+1的效果从略）',
  },
  {
    id: 'baiyinshizi', name: '白银狮子', type: 'equip', slot: 'armor', deckCount: 1,
    desc: '锁定技。你每次受到的伤害最多 1 点；当你失去装备区里的【白银狮子】时，你回复 1 点体力。',
  },
  {
    id: 'huxinjing', name: '护心镜', type: 'equip', slot: 'armor', deckCount: 1,
    desc: '当你受到的伤害值不小于你的体力值时，你可以弃置装备区里的【护心镜】防止此伤害。',
  },

  // ---- 蘑菇牌（金针菇不进牌堆：只能由【金针菇】技能置入、移出不入弃牌堆；其余四张为普通牌堆牌，另可由【蘑菇生长】生成）----
  {
    id: 'jinzhengu', name: '金针菇', type: 'curse', deckCount: 0, noPlay: true, art: 'curse',
    desc: '诅咒牌。无法使用、打出或弃置，计入手牌上限；经过你自己的三个回合后自动移出游戏。你被【一起上厕所】选为目标时，其立即移出。只能通过【金针菇】技能进入手牌，移出后不进弃牌堆。',
  },
  // ---- 诅咒牌：叫叫叫（持有时抽牌数-1；可主动使用以摆脱，代价是弃一张牌并失去1点体力）----
  {
    // vanish：使用后直接移出游戏，不进弃牌堆（否则会被洗回牌堆，从此任何人都可能摸到）
    id: 'jiaojiaojiao', name: '叫叫叫', type: 'curse', deckCount: 0, art: 'curse', vanish: true,
    desc: '诅咒牌。无法丢弃、无法被拿走，持有时抽牌数减一。你可以在出牌阶段使用它：弃置一张其他手牌并失去1点体力，将此牌移出游戏。只能通过【大狗叫】命中获得。',
    canUse: (g, u) => u.hand.some(c => c.defId !== 'jiaojiaojiao'), // 手里要有别的牌可弃
    async effect(g, { user }) {
      // 先弃置一张非叫叫叫的手牌（没有其他手牌时 canUse 已挡住，此处双保险）
      const others = user.hand.filter(c => c.defId !== 'jiaojiaojiao');
      if (!others.length) return;
      const c = await g.askCard(user, {
        filter: card => card.defId !== 'jiaojiaojiao',
        tag: '弃牌',
        hint: '【叫叫叫】：弃置一张其他手牌',
        cancelText: '随机弃一张',
      });
      const toDiscard = c && user.hand.includes(c) ? c : others[(Math.random() * others.length) | 0];
      g.discardFromHand(user, toDiscard, '弃置');
      g.log(`${user.name} 使用【叫叫叫】，弃置了${QYS.cardLabel(toDiscard)}`, 'use');
      await g.loseHp(user, 1, '叫叫叫');
    },
  },

  // ---- 基本牌：大狗叫（大神专用）----
  {
    // vanish：使用后移出游戏，不进弃牌堆（牌堆洗回时不会混进普通牌）
    id: 'dagoujiao', name: '大狗叫', type: 'basic', deckCount: 0, vanish: true,
    desc: '基本牌，只能通过大神的技能获取。效果与【杀】相同，并且当此牌未被【闪】抵消时，往目标手牌加入一张【叫叫叫】。',
    target: {
      count: 1,
      // 方天画戟：此【大狗叫】为最后一张手牌时可指定至多 3 名目标
      max: (g, u) => u.equips.weapon && QYS.def(u.equips.weapon).id === 'fangtian' && u.hand.length === 1 ? 3 : 1,
      candidates: (g, u) => {
        // 魅惑菇：被魅惑者（u.charmFrom 指向使用者）无法将其选为【大狗叫】的目标
        const base = g.othersAlive(u).filter(t => g.inShaRange(u, t) && u.charmFrom !== t);
        // 灌汤包：场上 1 血角色无视距离均可作为目标
        const extra = g.hasSkill(u, 'sk_guantangbao')
          ? g.othersAlive(u).filter(t => t.hp === 1 && !base.includes(t) && u.charmFrom !== t)
          : [];
        const all = [...base, ...extra];
        // 闻着凑吃着香：杀次数用尽时，只能以凑鸽子为目标
        if (u.turn.shaUsed >= QYS.wenzheShaLimit(g, u)) return all.filter(t => g.hasSkill(t, 'sk_wenzhe'));
        return all;
      },
    },
    canUse: (g, u) => {
      if (u.turn.shaUsed >= QYS.wenzheShaLimit(g, u)) {
        // 次数用尽：范围内仍有凑鸽子（闻着凑吃着香）→ 仍可使用（目标被限定为凑鸽子）
        return g.othersAlive(u).some(t => g.hasSkill(t, 'sk_wenzhe') && g.inShaRange(u, t) && u.charmFrom !== t);
      }
      return true;
    },
    async effect(g, { user, targets, card }) {
      const ts = targets.filter(t => t.alive);
      // 太刀高手：每使用一次杀永久升级（无→白刃→黄刃→红刃，升级当次即生效；多人目标也只升一次）
      if (g.hasSkill(user, 'sk_taidao') && user.blade < 3) {
        user.blade++;
        g.log(`【太刀高手】${user.name} 的太刀升至 ${['无', '白刃（攻击范围+1）', '黄刃（每回合两张杀）', '红刃（杀伤害+1）'][user.blade]}`, 'skill');
      }
      // 狼牙棒（主公技）杀伤害+1；太刀红刃（等级3）杀伤害+1；真蓄斩蓄力每格+1（一次性消耗，+3 时无法被闪避或无效）
      const langya = user.identity === '主' && g.hasSkill(user, 'sk_langyabang') ? 1 : 0;
      const bladeDmg = g.hasSkill(user, 'sk_taidao') && user.blade >= 3 ? 1 : 0;
      const chargeBonus = g.consumeCharge(user);
      if (chargeBonus > 0) g.log(`【真蓄斩】${user.name} 释放 ${chargeBonus} 格蓄力，此【大狗叫】威力+${chargeBonus}${chargeBonus >= 3 ? '（无法被闪避或无效）' : ''}`, 'skill');
      const base = (user.turn.wine ? 1 : 0) + langya + bladeDmg + chargeBonus;
      const undodgeable = chargeBonus >= 3;
      // 灌汤包摸牌条件取"使用时目标为1血"，命中未被闪避即摸（多人目标命中任意一名即摸一张）
      const guantang = g.hasSkill(user, 'sk_guantangbao') && ts.some(t => t.hp === 1);
      user.turn.wine = false;
      user.turn.shaUsed++;
      let anyHit = false;
      for (const tgt of ts) {
        if (g.over) break;
        // 古锭刀：对已受伤角色的杀伤害+1
        const guding = user.equips.weapon && QYS.def(user.equips.weapon).id === 'gudingdao' && tgt.hp < tgt.maxHp ? 1 : 0;
        const dodged = !(await g.shaResolve(user, tgt, base + guding, card, { undodgeable }));
        if (!dodged) {
          anyHit = true;
          // 大狗叫额外效果：未被闪时往对方手牌增加一张【叫叫叫】诅咒牌
          // （目标若已被此杀打死，其手牌已结算完毕，不再塞入）
          if (tgt.alive) {
            tgt.hand.push({
              defId: 'jiaojiaojiao',
              suit: ['♠', '♥', '♣', '♦'][(Math.random() * 4) | 0],
              number: 1 + ((Math.random() * 13) | 0),
            });
            g.log(`${tgt.name} 被【大狗叫】命中，手牌中被塞入一张【叫叫叫】`, 'skill');
          }
        }
      }
      if (guantang && anyHit) await g.drawCards(user, 1);
    },
  },
  {
    id: 'mehuogu', name: '魅惑菇', type: 'trick', deckCount: 3, art: 'shroom',
    desc: '出牌阶段，对你的攻击范围内的一名其他角色使用：直到其下个回合结束，其无法将你选为【杀】的目标。',
    target: { count: 1, candidates: (g, u) => g.othersAlive(u).filter(t => g.inShaRange(u, t)) },
    async effect(g, { user, targets, card }) {
      const t = targets[0];
      if (await g.askWuxie({ user, card, target: t })) return;
      t.charmFrom = user;
      g.log(`${t.name} 吃下了【魅惑菇】，其下个回合内无法对 ${user.name} 使用【杀】`, 'use');
      g.update();
    },
  },
  {
    id: 'huimiegu', name: '毁灭菇', type: 'trick', deckCount: 2, art: 'shroom',
    desc: '出牌阶段使用：你与相邻的两名角色各受到3点伤害（「蘑菇」无论是否为使用者均免疫此伤害）。',
    async effect(g, { user, card }) {
      const alive = g.alive();
      if (alive.length < 2) return;
      const i = alive.indexOf(user);
      // 后一位、前一位、自己（两人局时前后均为对方，去重）
      const zone = [...new Set([alive[(i + 1) % alive.length], alive[(i - 1 + alive.length) % alive.length], user])];
      for (const t of zone) {
        if (g.over) return;
        if (!t.alive) continue;
        if (t.charId === 'mogu') { g.log(`【毁灭菇】对 ${t.name} 无效（蘑菇免疫）`, 'skill'); continue; }
        if (await g.askWuxie({ user, card, target: t })) continue;
        await g.damage({ source: user, target: t, amount: 3, tag: '毁灭菇' });
      }
    },
  },
  {
    id: 'xingbaogu', name: '杏鲍菇', type: 'trick', deckCount: 3, art: 'shroom',
    desc: '出牌阶段对自己使用，回复2点体力。',
    canUse: (g, u) => u.hp < u.maxHp,
    target: { count: 1, candidates: (g, u) => [u] },
    async effect(g, { user, card }) {
      if (await g.askWuxie({ user, card, target: user })) return;
      await g.heal(user, 2);
    },
  },
  {
    id: 'houtougu', name: '猴头菇', type: 'trick', deckCount: 3, art: 'shroom',
    desc: '出牌阶段对自己使用：从基本/锦囊/装备牌中选择一种类型，从牌堆中抽取一张该类型的牌（翻过的牌压回堆底）。',
    target: { count: 1, candidates: (g, u) => [u] },
    async effect(g, { user, card }) {
      if (await g.askWuxie({ user, card, target: user })) return;
      const typeNames = { basic: '基本牌', trick: '锦囊牌', equip: '装备牌' };
      // 类型选择复用确定/放弃问答：基本 → 锦囊 → 装备
      let type = null;
      if (await g.askBool(user, '【猴头菇】：抽取【基本牌】？', { cancelText: '选其他类型' })) type = 'basic';
      else if (await g.askBool(user, '【猴头菇】：抽取【锦囊牌】？', { cancelText: '抽装备牌' })) type = 'trick';
      else type = 'equip';
      const skipped = [];
      let got = null;
      for (;;) {
        const c = g.drawCard();
        if (!c) break; // 牌堆与弃牌堆翻尽仍无该类型
        if (c.defId === 'choujizhazha') { skipped.push(c); continue; } // 臭鸡炸炸炸不参与猴头菇检索：保持其在牌堆流转，只有凑鸽子自然摸到才能使用
        if (QYS.def(c).type === type) { got = c; break; }
        skipped.push(c);
      }
      for (const c of skipped) g.deck.unshift(c); // 翻过的非目标牌压回堆底
      if (got) {
        g.log(`${user.name} 吃下【猴头菇】，抽到了${QYS.cardLabel(got)}`, 'use');
        await g.takeDrawnCard(user, got); // 与摸牌同规则：亚撒西/orange 的抽到转化
      } else g.log(`${user.name} 吃下【猴头菇】，但牌堆中没有${typeNames[type]}`, 'system');
      g.update();
    },
  },
];
