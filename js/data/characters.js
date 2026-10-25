// 群友杀 - 武将与技能数据
// 添加新武将：往 QYS.data.characters 里加一条（id 同时是头像文件名 assets/characters/<id>.png|.jpeg|.jpg）；
// 技能写在 QYS.data.skills 里并填进 skills 数组。字段与钩子说明见 README。
globalThis.QYS = globalThis.QYS || {};
QYS.data = QYS.data || {};

// 技能字段：
// type   active 主动技（出牌阶段可发动，有 canUse/exec）| trigger 触发技（靠 hooks 响应钩子）
// freq   'oncePerTurn' 每回合限一次
// canUse(game, player)  主动技：当前能否发动
// exec(game, player)    主动技：发动结算，返回 true 视为成功（消耗次数），false 视为取消
// hooks                 触发技：{ 钩子名(game, player, payload) }
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
};

QYS.data.characters = [
  // TODO: 路人群友为测试用白板武将
  { id: 'luren', name: '路人群友', title: '路人', hp: 4, skills: [] },
  { id: 'hxtyd', name: '好像有一天', title: '谜之群友', hp: 4, skills: ['sk_xueshengzhanzheng'] },
];
