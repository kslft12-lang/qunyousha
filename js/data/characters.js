// 群友杀 - 武将与技能数据（占位内容，等待替换成真实群友）
// TODO: 把"群友甲~辛"换成真实群友——改 name / title / hp / skills 即可。
//       头像图约定：assets/characters/<id>.png，没有图片时界面自动用首字圆徽占位。
// 添加新武将：往 QYS.data.characters 里加一条；技能写在 QYS.data.skills 里并填进 skills 数组。
globalThis.QYS = globalThis.QYS || {};
QYS.data = QYS.data || {};

// 技能字段：
// type   active 主动技（出牌阶段可发动，有 canUse/exec）| trigger 触发技（靠 hooks 响应钩子）
// freq   'oncePerTurn' 每回合限一次
// canUse(game, player)  主动技：当前能否发动
// exec(game, player)    主动技：发动结算，返回 true 视为成功（消耗次数），false 视为取消
// hooks                 触发技：{ 钩子名(game, player, payload) }
//   可用钩子：turnStart / phaseStart / phaseEnd / beforeDamaged(可改 payload.amount) /
//   afterDamaged / onDying / onDeath / cardUsed / becomeTarget
QYS.data.skills = {
  // 示例主动技：演示"选牌 → 选目标 → 造成伤害"的问答交互通路
  sk_taigang: {
    name: '抬杠',
    type: 'active',
    freq: 'oncePerTurn',
    desc: '出牌阶段限一次，你可以弃置一张手牌，对你攻击范围内的一名其他角色造成1点伤害。',
    canUse(game, p) {
      return p.hand.length > 0 && game.othersAlive(p).some(t => game.inShaRange(p, t));
    },
    async exec(game, p) {
      const card = await game.askCard(p, { filter: () => true, tag: '技能', hint: '【抬杠】：请弃置一张手牌', cancelText: '取消' });
      if (!card) return false;
      const targets = game.othersAlive(p).filter(t => game.inShaRange(p, t));
      const sel = await game.askTargets(p, { candidates: targets, min: 1, max: 1, hint: '【抬杠】：请选择造成1点伤害的目标' });
      if (!sel || !sel.length) return false;
      game.log(`${p.name} 发动了【抬杠】`, 'skill');
      game.discardFromHand(p, card);
      await game.damage({ source: p, target: sel[0], amount: 1, tag: '抬杠' });
      return true;
    },
  },
  // 示例触发技：演示 hooks 触发通路
  sk_jichou: {
    name: '记仇',
    type: 'trigger',
    desc: '锁定技，每受到1点伤害后，你摸一张牌。',
    hooks: {
      async afterDamaged(game, p, payload) {
        if (payload.target === p && payload.amount > 0) {
          game.log(`${p.name} 的【记仇】触发，摸一张牌`, 'skill');
          await game.drawCards(p, 1);
        }
      },
    },
  },
};

// TODO(占位): 以下 8 个武将均为占位原型，技能共用示例技能，等你换成真实群友与专属技能
const PLACEHOLDER_SKILLS = ['sk_taigang', 'sk_jichou'];

QYS.data.characters = [
  { id: 'qunyou_1', name: '群友甲', title: '潜水冠军', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_2', name: '群友乙', title: '斗图之王', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_3', name: '群友丙', title: '夜猫子', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_4', name: '群友丁', title: '红包猎人', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_5', name: '群友戊', title: '键盘侠客', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_6', name: '群友己', title: '表情包库', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_7', name: '群友庚', title: '摸鱼大师', hp: 4, skills: PLACEHOLDER_SKILLS },
  { id: 'qunyou_8', name: '群友辛', title: '咳嗽大使', hp: 4, skills: PLACEHOLDER_SKILLS },
];
