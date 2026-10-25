// 群友杀 - 武将与技能数据
// 添加新武将：往 QYS.data.characters 里加一条（id 同时是头像文件名 assets/characters/<id>.<avatar|png>）；
// 技能写在 QYS.data.skills 里并填进 skills 数组。字段与钩子说明见 README。
globalThis.QYS = globalThis.QYS || {};
QYS.data = QYS.data || {};

// 技能字段：
// type   active 主动技（出牌阶段可发动，有 canUse/exec）| trigger 触发技（靠 hooks 响应钩子）
// freq   'oncePerTurn' 每回合限一次
// canUse(game, player)  主动技：当前能否发动
// exec(game, player)    主动技：发动结算，返回 true 视为成功（消耗次数），false 视为取消
// hooks                 触发技：{ 钩子名(game, player, payload) }
// 注：一几一几/万人迷这类"响应时改写判定"的技能由 game.dodgeCheck 直接检查（game.hasSkill），
//     不走 hooks，也属于触发技（被动生效，小学生战争锁技期间仍可发动）。
QYS.data.skills = {
  // 【小学生战争】：主动技。锁定双方直到发动者的下回合开始：
  // 被锁玩家无法使用/打出【杀】【闪】以外的任何牌（含无懈、桃），主动技封印；被动技能不受影响。
  // TODO(规则): 原始描述未注明发动频率，暂按"出牌阶段限一次"实现
  sk_xueshengzhanzheng: {
    name: '小学生战争',
    type: 'active',
    freq: 'oncePerTurn',
    desc: '出牌阶段限一次，你可以选择一名其他角色：直到你的下回合开始，你与该角色都无法使用【杀】和【闪】以外的任何卡牌，也无法发动主动技能（被动技能仍可生效）。',
    canUse(game, p) {
      return !game.warLock && game.othersAlive(p).length > 0;
    },
    async exec(game, p) {
      const sel = await game.askTargets(p, {
        candidates: game.othersAlive(p), min: 1, max: 1,
        hint: '【小学生战争】：选择一名角色开战（你们二人暂时只能使用【杀】【闪】）',
      });
      if (!sel || !sel.length) return false;
      game.warLock = { a: p, b: sel[0] };
      game.log(`${p.name} 对 ${sel[0].name} 发动【小学生战争】！你们二人暂时只能使用【杀】【闪】`, 'skill');
      game.update();
      return true;
    },
  },

  // 【一几一几】：被【杀】指定为目标时（万箭齐发不算），可以将任意一张手牌当作【闪】打出。
  // 实现在 game.dodgeCheck（仅 cause==='sha' 时询问；被【万人迷】选中代打时不触发）。
  sk_yijiyiji: {
    name: '一几一几',
    type: 'trigger',
    desc: '当你被【杀】指定为目标时，你可以将任意一张手牌当作【闪】打出。',
  },

  // 【呜呜呜袜】：每受到伤害时，令伤害来源弃置一张手牌。
  // TODO(规则): 描述为"丢弃一张牌"，暂按手牌实现（装备/判定区不参与）
  sk_wuwuwuwa: {
    name: '呜呜呜袜',
    type: 'trigger',
    desc: '当你受到伤害时，令伤害来源弃置一张手牌。',
    hooks: {
      async afterDamaged(game, p, payload) {
        if (payload.target !== p || payload.amount <= 0) return;
        const src = payload.source;
        if (!src || !src.alive || !src.hand.length) return;
        game.log(`${p.name} 的【呜呜呜袜】触发`, 'skill');
        const c = await game.askCard(src, {
          filter: () => true, tag: '弃牌',
          hint: `${p.name} 的【呜呜呜袜】：请弃置一张手牌`, cancelText: '随机弃一张',
        });
        const card = c && src.hand.includes(c) ? c : src.hand[(Math.random() * src.hand.length) | 0];
        game.discardFromHand(src, card, '弃置');
        game.log(`${src.name} 弃置了${QYS.cardLabel(card)}`, 'system');
        game.update();
      },
    },
  },

  // 【万人迷】：需要使用/打出【闪】时（含被杀指定、万箭齐发），可选择场上任一其他角色替你打出【闪】；
  // 若其没有【闪】，其失去1点体力（体力流失，非伤害），且你仍需承受本次结算。
  // 实现在 game.dodgeCheck；被选中代打的角色直接被询问【闪】，其一几一几不触发。
  sk_wanrenmi: {
    name: '万人迷',
    type: 'trigger',
    desc: '当你需要使用或打出【闪】时，你可以选择场上任一其他角色替你打出【闪】；若其没有【闪】可打出，其失去1点体力。',
  },

  // 【豆沙包】：主公技。回合开始时可命令一名角色对另一名角色使用一张【杀】（强制执行；目标可闪避）。
  // TODO(规则): 强制使用不检查攻击范围（简化）
  sk_doushabao: {
    name: '豆沙包',
    type: 'trigger',
    desc: '主公技。回合开始时，你可以命令一名角色对另一名角色使用一张【杀】（其必须执行；目标可以打出【闪】躲避）。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p || p.identity !== '主') return;
        const cands = game.alive();
        if (cands.length < 2) return;
        if (!(await game.askBool(p, '是否发动【豆沙包】？命令一名角色对另一名角色使用【杀】', { tag: '技能' }))) return;
        const a = await game.askTargets(p, { candidates: cands, min: 1, max: 1, hint: '【豆沙包】：选择执行命令的角色' });
        if (!a || !a.length) return;
        const src = a[0];
        const tCands = game.othersAlive(src);
        if (!tCands.length) return;
        const b = await game.askTargets(p, { candidates: tCands, min: 1, max: 1, hint: `【豆沙包】：${src.name} 对谁使用【杀】？` });
        if (!b || !b.length) return;
        const tgt = b[0];
        game.log(`${p.name} 发动【豆沙包】，命令 ${src.name} 对 ${tgt.name} 使用【杀】`, 'skill');
        const sha = src.hand.find(c => QYS.def(c).id === 'sha');
        if (sha) {
          game.discardFromHand(src, sha, '使用');
          game.log(`${src.name} 被迫使用${QYS.cardLabel(sha)}`, 'use');
          await game.shaResolve(src, tgt, 0);
        } else {
          game.log(`${src.name} 没有【杀】，命令落空`, 'system');
        }
        game.update();
      },
    },
  },

  // 【灌汤包】：每回合可用两张【杀】；场上存在 1 血角色时可无视距离对其出【杀】，命中（未被闪）摸一张牌。
  // 实现在 cards.js 的【杀】（canUse 次数上限 / candidates 距离豁免 / effect 命中摸牌）。
  sk_guantangbao: {
    name: '灌汤包',
    type: 'trigger',
    desc: '你每回合可以使用两张【杀】；若场上存在体力值为1的角色，你可以无视攻击距离对其使用【杀】，此【杀】未被【闪】抵消时，你摸一张牌。',
  },

  // 【小笼包】：手牌上限-1，摸牌阶段摸牌数+1。实现在 rules.js 的摸牌/弃牌阶段。
  sk_xiaolongbao: {
    name: '小笼包',
    type: 'trigger',
    desc: '锁定技。你的手牌上限-1，摸牌阶段摸牌数+1。',
  },

  // 【orange】：每回合开始获得 1 个 orange；抽到【桃】自动弃置并转化为 2 个 orange；
  // 出牌阶段可对任意角色（含自己）使用 orange：1 个回复 1 点体力，可连续使用直到用完。
  // 计数显示在头像下方的橙色徽标；主动使用走技能按钮（freq 不设 oncePerTurn = 不限次）。
  sk_orange: {
    name: 'orange',
    type: 'active',
    desc: '每回合开始时你获得 1 个 orange；你抽到【桃】时自动弃置之并转化为 2 个 orange。出牌阶段你可以使用 orange：令任意角色（包括自己）回复 1 点体力，只要有 orange 就可以继续使用。',
    canUse(game, p) { return p.oranges > 0; },
    async exec(game, p) {
      const sel = await game.askTargets(p, {
        candidates: game.alive(), min: 1, max: 1,
        hint: '【orange】：选择回复 1 点体力的目标（可含自己）',
      });
      if (!sel || !sel.length) return false;
      p.oranges--;
      game.log(`${p.name} 使用了 1 个 orange（剩 ${p.oranges}）`, 'skill');
      await game.heal(sel[0], 1, p);
      return true;
    },
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        p.oranges = (p.oranges || 0) + 1;
        game.log(`${p.name} 的【orange】触发，获得 1 个 orange（共 ${p.oranges}）`, 'skill');
      },
    },
  },

  // 【亚撒西】：抽到【杀】时弃置之并改为摸两张，每回合限一次。实现在 game.drawCards。
  sk_yasaxi: {
    name: '亚撒西',
    type: 'trigger',
    desc: '每回合限一次，你抽到【杀】时将之弃置，改为摸两张牌。',
  },

  // 【一起上厕所】：出牌阶段限一次，选择一名其他角色：直到自己的下回合开始，
  // 双方距离互相强制为 1（无视实际环距与坐骑；与其他人距离正常计算）。
  sk_toilet: {
    name: '一起上厕所',
    type: 'active',
    freq: 'oncePerTurn',
    desc: '出牌阶段限一次，你可以选择一名其他角色与你一起上厕所：直到你的下回合开始，你与其的距离互相强制为1（无视实际距离与坐骑，与其他角色的距离仍正常计算）。',
    canUse(game, p) { return game.othersAlive(p).length > 0; },
    async exec(game, p) {
      const sel = await game.askTargets(p, {
        candidates: game.othersAlive(p), min: 1, max: 1,
        hint: '【一起上厕所】：选择一起上厕所的角色（你们的距离将强制为1）',
      });
      if (!sel || !sel.length) return false;
      const t = sel[0];
      game.toilet = { a: p, b: t };
      game.log(`${p.name} 拉着 ${t.name} 一起上厕所！你们二人的距离强制为 1`, 'skill');
      // 上厕所要脱裤子：夺其防具入手（需同时拥有该技能）
      if (game.hasSkill(p, 'sk_tuokuzi') && t.equips.armor) {
        const armor = t.equips.armor;
        t.equips.armor = null;
        p.hand.push(armor);
        game.log(`${t.name} 上厕所要脱裤子，【${QYS.def(armor).name}】被 ${p.name} 拿走了`, 'skill');
      }
      game.update();
      return true;
    },
    hooks: {
      // 自己的下回合开始：结束一起上厕所
      async turnStart(game, p, payload) {
        if (payload.player === p && game.toilet && game.toilet.a === p) {
          game.toilet = null;
          game.log('一起上厕所结束，距离恢复正常', 'system');
        }
      },
    },
  },

  // 【狼牙棒】：主公技。你的【杀】伤害+1、攻击范围+1；【诸葛连弩】对你无效。
  // 伤害与连弩封禁实现在 cards.js 的【杀】，攻击范围实现在 game.inShaRange。
  sk_langyabang: {
    name: '狼牙棒',
    type: 'trigger',
    desc: '主公技。你的【杀】伤害+1，攻击范围+1；【诸葛连弩】对你无效。',
  },

  // 【新疆网络】：对你使用的【杀】都有 1/2 概率因"网络波动"自动失效（无需闪避）。实现在 game.shaResolve。
  sk_xinjiangwang: {
    name: '新疆网络',
    type: 'trigger',
    desc: '锁定技。对你使用的【杀】都有二分之一的概率因为「网络波动」而自动失效。',
  },

  // 【梯子专家】：回合开始时选择一名角色，其须选择：交给噜噜打汪一张手牌，
  // 或本回合内使用任意卡牌都有 1/2 概率失败（无手牌只能选后者）。失败判定在 game.askCard。
  sk_ladder: {
    name: '梯子专家',
    type: 'trigger',
    desc: '回合开始时，你可以选择一名角色，该角色须做出选择：交给你一张手牌；或本回合内其使用任意卡牌都有二分之一的概率失败（无手牌则只能选择后者）。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        game.players.forEach(q => { q.ladderFail = false; }); // 清理上一回合残留
        const cands = game.othersAlive(p);
        if (!cands.length) return;
        if (!(await game.askBool(p, '是否发动【梯子专家】？', { tag: '技能' }))) return;
        const sel = await game.askTargets(p, { candidates: cands, min: 1, max: 1, hint: '【梯子专家】：选择本回合盯上的角色' });
        if (!sel || !sel.length) return;
        const t = sel[0];
        if (t.hand.length && await game.askBool(t, `被 ${p.name} 的【梯子专家】盯上：交给他一张手牌？（拒绝则本回合你使用卡牌有一半概率失败）`, { tag: '技能' })) {
          const c = await game.askCard(t, { filter: () => true, tag: '弃牌', hint: `【梯子专家】：交给 ${p.name} 一张手牌`, cancelText: '随机交一张' });
          const give = c && t.hand.includes(c) ? c : t.hand[(Math.random() * t.hand.length) | 0];
          t.hand.splice(t.hand.indexOf(give), 1);
          p.hand.push(give);
          game.log(`${t.name} 交给了 ${p.name} 一张手牌`, 'skill');
        } else {
          t.ladderFail = true;
          game.log(`${t.name} 本回合使用卡牌有一半概率失败（${p.name} 的【梯子专家】）`, 'skill');
        }
        game.update();
      },
      async phaseEnd(game, p, payload) {
        if (payload.player === p && payload.phase === '结束') game.players.forEach(q => { q.ladderFail = false; });
      },
    },
  },

  // 【上厕所要脱裤子】：与【一起上厕所】联动：一起上厕所的对象其装备栏中的防具放入你的手牌（坐骑和武器不算防具）。
  sk_tuokuzi: {
    name: '上厕所要脱裤子',
    type: 'trigger',
    desc: '被你用【一起上厕所】选中的对象，其装备栏中的防具将放入你的手牌中（坐骑和武器不是防具）。',
  },

  // 【凑凑的捣乱狂】：回合开始时，可将任意两名角色（含自己）的手牌全部洗混后随机分配回两人。
  sk_daoluan: {
    name: '凑凑的捣乱狂',
    type: 'trigger',
    desc: '回合开始时，你可以选择任意两名角色（包括自己），将两人的所有手牌洗混后随机分配回这两个人手中。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        const cands = game.alive();
        if (cands.length < 2) return;
        if (!(await game.askBool(p, '是否发动【凑凑的捣乱狂】？将两名角色的手牌洗混随机分配', { tag: '技能' }))) return;
        const sel = await game.askTargets(p, { candidates: cands, min: 2, max: 2, hint: '【凑凑的捣乱狂】：选择两名角色（可含自己）' });
        if (!sel || sel.length !== 2) return;
        const [x, y] = sel;
        const pool = [...x.hand.splice(0), ...y.hand.splice(0)];
        QYS.util.shuffle(pool);
        for (const c of pool) (Math.random() < 0.5 ? x : y).hand.push(c);
        game.log(`${p.name} 发动【凑凑的捣乱狂】，${x.name} 与 ${y.name} 的手牌被洗混随机分配`, 'skill');
        game.update();
      },
    },
  },
};

QYS.data.characters = [
  // TODO: 路人群友为测试用白板武将（人数超出角色池时以其补位，允许重复）
  { id: 'luren', name: '路人群友', title: '路人', hp: 4, skills: [] },
  // avatar: 头像扩展名（assets/characters/<id>.<avatar>），不填默认 png；正确声明可避免 404 探测造成的头像闪烁
  { id: 'hxtyd', name: '好像有一天', title: '谜之群友', hp: 4, avatar: 'jpeg', skills: ['sk_xueshengzhanzheng'] },
  { id: 'hsjjj', name: '花生酱酱酱', title: '群友', hp: 4, avatar: 'jpeg', skills: ['sk_yijiyiji'] },
  { id: 'hhdmw', name: '善良的黄瓜魔女', title: '群友', hp: 4, avatar: 'jpeg', skills: ['sk_wuwuwuwa'] },
  { id: 'dashen', name: '大神', title: '群友', hp: 4, skills: ['sk_wanrenmi'] },
  { id: 'baozi', name: '包子大王', title: '群友', hp: 4, avatar: 'png', skills: ['sk_doushabao', 'sk_xiaolongbao', 'sk_guantangbao'] },
  { id: 'hua00', name: '00的画', title: '群友', hp: 4, avatar: 'png', skills: ['sk_daoluan'] },
  // TODO: 秋秋人头像待补 assets/characters/qiuqiu.png（当前显示首字圆徽）
  { id: 'qiuqiu', name: '秋秋人', title: '群友', hp: 4, skills: ['sk_orange', 'sk_yasaxi'] },
  // TODO: 颜文字小变态头像待补 assets/characters/yanwenzi.png（当前显示首字圆徽）
  { id: 'yanwenzi', name: '颜文字小变态', title: '群友', hp: 4, skills: ['sk_toilet', 'sk_tuokuzi'] },
  // TODO: 噜噜打汪头像待补 assets/characters/lulu.png（当前显示首字圆徽）
  { id: 'lulu', name: '噜噜打汪', title: '群友', hp: 4, skills: ['sk_langyabang', 'sk_xinjiangwang', 'sk_ladder'] },
];
