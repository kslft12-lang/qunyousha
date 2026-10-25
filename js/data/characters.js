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
];
