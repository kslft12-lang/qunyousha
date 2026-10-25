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
};

QYS.data.characters = [
  // TODO: 路人群友为测试用白板武将
  { id: 'luren', name: '路人群友', title: '路人', hp: 4, skills: [] },
  // avatar: 头像扩展名（assets/characters/<id>.<avatar>），不填默认 png；正确声明可避免 404 探测造成的头像闪烁
  { id: 'hxtyd', name: '好像有一天', title: '谜之群友', hp: 4, avatar: 'jpeg', skills: ['sk_xueshengzhanzheng'] },
  { id: 'hsjjj', name: '花生酱酱酱', title: '群友', hp: 4, avatar: 'jpeg', skills: ['sk_yijiyiji'] },
  { id: 'hhdmw', name: '善良的黄瓜魔女', title: '群友', hp: 4, avatar: 'jpeg', skills: ['sk_wuwuwuwa'] },
  { id: 'dashen', name: '大神', title: '群友', hp: 4, skills: ['sk_wanrenmi'] },
];
