// 群友杀 - Node 模拟测试：加载引擎（不含 UI/main），全机器人跑通多局
// 用法：node test/simulate.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'js/data/characters.js',
  'js/data/cards.js',
  'js/engine/core.js',
  'js/engine/rules.js',
  'js/adapter/bot.js',
];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

QYS.bot.fast = true;

async function play(n) {
  const game = QYS.core.createGame({ playerCount: n, humanSeat: null, ioFor: () => QYS.bot.io() });
  game.view = null;
  const winner = await QYS.rules.run(game);
  if (!game.over || !winner) throw new Error(`${n}人局未正常终局`);
  return { n, turns: game.turnCount, winner, game };
}

(async () => {
  const plan = [5, 5, 5, 5, 5, 2, 8];
  const results = [];
  for (const n of plan) results.push(await play(n));
  console.log('#  | 人数 | 回合 | 胜方');
  results.forEach((r, i) => console.log(`${String(i + 1).padEnd(2)} | ${r.n}人  | ${String(r.turns).padEnd(4)} | ${r.winner}`));
  console.log(`\n${results.length} 局全部跑通 ✓`);

  // 快照隐私检查（用未结束的局：终局会翻开全部身份）：座位 0 能看到自己的手牌，看不到座位 1 的手牌与暗置身份
  const fresh = QYS.core.createGame({ playerCount: 5, humanSeat: null, ioFor: () => QYS.bot.io() });
  const snap = QYS.core.snapshot(fresh, 0);
  if (snap.players[1].hand !== undefined || snap.players[1].identity !== null) throw new Error('快照泄漏手牌/身份');
  if (!Array.isArray(snap.players[0].hand) || !snap.players[0].hand.length) throw new Error('快照缺少座位0手牌');
  if (!Array.isArray(snap.discardEntries)) throw new Error('快照缺少弃牌记录');
  console.log('快照检查 ✓（座位0可见自己手牌，座位1手牌/身份不可见）');

  // 装备机制检查：武器射程/连弩/八卦阵属性在卡牌定义上（QYS.def），马为存在性判定
  {
    const io = () => ({ async chooseCard() { return null; }, async chooseBool() { return false; }, async chooseTargets() { return null; }, async askPlay() { return { type: 'end' }; }, log() {}, update() {} });
    const g = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙', '丁', '戊'], ioFor: io });
    const me = g.players[0], far = g.players[2]; // 环距 2
    me.skillIds = []; // 清空随机分配的技能，保证杀次数断言不受角色影响
    if (g.distance(me, far) !== 2) throw new Error('环距离计算错误');
    if (g.inShaRange(me, far)) throw new Error('无武器距离2应在范围外');
    me.equips.weapon = { defId: 'qinglong', suit: '♠', number: 5 };
    if (!g.inShaRange(me, far)) throw new Error('青龙偃月刀射程3应覆盖距离2');
    me.equips.weapon = null;
    me.equips.horseMinus = { defId: 'ma_atk', suit: '♣', number: 9 };
    if (!g.inShaRange(me, far)) throw new Error('-1马应使距离2变为1');
    me.equips.horseMinus = null;
    far.equips.horsePlus = { defId: 'ma_def', suit: '♥', number: 3 };
    if (g.distance(me, far) !== 3) throw new Error('+1马应使他人到其距离+1');
    far.equips.horsePlus = null;
    me.equips.weapon = { defId: 'liannu', suit: '♦', number: 1 };
    me.turn = { shaUsed: 1, wine: false, skipPlay: false, skillUsed: false };
    const shaDef = QYS.data.cards.find(c => c.id === 'sha');
    if (!shaDef.canUse(g, me)) throw new Error('诸葛连弩应允许出第二张杀');
    me.equips.weapon = { defId: 'qinglong', suit: '♠', number: 5 };
    if (shaDef.canUse(g, me)) throw new Error('非连弩武器每回合限一杀');
    console.log('装备机制检查 ✓（射程/连弩/±1马）');

    // 阵亡离场距离检查：两人之间的角色死亡后，环收拢、距离-1
    {
      const g2 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙', '丁', '戊'], ioFor: io });
      const [p0, p1, p2] = g2.players;
      if (g2.distance(p0, p2) !== 2) throw new Error('初始甲-丙距离应为2');
      p1.alive = false; // 乙阵亡，甲丙相邻
      if (g2.distance(p0, p2) !== 1) throw new Error('乙阵亡后甲-丙应为邻座距离1');
      g2.players[3].alive = false; // 丁也阵亡
      if (g2.distance(p0, p2) !== 1) throw new Error('多个阵亡后存活环距离计算错误');
      if (g2.distance(p0, g2.players[4]) !== 1) throw new Error('甲-戊在存活环上应相邻');
      console.log('阵亡离场距离检查 ✓（座位收拢）');
    }

    // 角色唯一性检查：除路人群友外每局不重复
    {
      const g3 = QYS.core.createGame({ playerCount: 8, humanSeat: null, lordSeat: 0, ioFor: io });
      const ids = g3.players.map(p => p.charId);
      const nonLuren = ids.filter(id => id !== 'luren');
      if (new Set(nonLuren).size !== nonLuren.length) throw new Error('非路人群友角色出现重复：' + ids.join(','));
      const g4 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, ioFor: io });
      if (new Set(g4.players.map(p => p.charId)).size !== 5) throw new Error('5人局角色重复');
      console.log('角色唯一性检查 ✓（仅路人群友可重复补位）');
    }

    // 灌汤包检查：杀次数上限2 / 1血目标无视距离 / 命中摸牌
    {
      const g5 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙', '丁', '戊'], ioFor: io });
      const me = g5.players[0], far = g5.players[2]; // 距离2
      me.skillIds = ['sk_guantangbao'];
      me.turn = { shaUsed: 0, wine: false, skipPlay: false, skillUsed: false };
      const shaDef = QYS.data.cards.find(c => c.id === 'sha');
      if (!shaDef.canUse(g5, me)) throw new Error('灌汤包第一张杀应可用');
      me.turn.shaUsed = 1;
      if (!shaDef.canUse(g5, me)) throw new Error('灌汤包每回合应可用两张杀');
      me.turn.shaUsed = 2;
      if (shaDef.canUse(g5, me)) throw new Error('灌汤包第三张杀应不可用');
      me.equips.weapon = { defId: 'liannu', suit: '♦', number: 1 };
      if (!shaDef.canUse(g5, me)) throw new Error('连弩仍应无限出杀');
      me.equips.weapon = null;
      const noSkillCands = shaDef.target.candidates(g5, me);
      if (noSkillCands.includes(far)) throw new Error('距离2默认不可选');
      far.hp = 1;
      const cands = shaDef.target.candidates(g5, me);
      if (!cands.includes(far)) throw new Error('灌汤包应无视距离选中1血目标');
      console.log('灌汤包检查 ✓（两张杀/无视距离/连弩兼容）');
    }

    // orange / 亚撒西检查：抽牌转化链、回合获得、主动使用回血、每回合限一次
    {
      const io6 = () => ({ async chooseCard() { return null; }, async chooseBool() { return false; }, async chooseTargets(p, o) { return [o.candidates[0]]; }, async askPlay() { return { type: 'end' }; }, log() {}, update() {} });
      const g6 = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['秋', '甲', '乙'], ioFor: io6 });
      const qiu = g6.players[0];
      qiu.skillIds = ['sk_orange', 'sk_yasaxi'];
      g6.turnCount = 1;
      // 控制抽牌顺序：杀（触发亚撒西）→ 桃（转2orange）→ 桃（再转2orange）→ 杀（限一次后正常入手）
      const seq = [
        { defId: 'sha', suit: '♠', number: 7 },
        { defId: 'tao', suit: '♥', number: 4 },
        { defId: 'tao', suit: '♥', number: 5 },
        { defId: 'sha', suit: '♠', number: 9 },
      ];
      g6.drawCard = () => seq.shift() || null;
      qiu.hand.length = 0;
      await g6.drawCards(qiu, 1); // 抽1张杀 → 亚撒西弃置改抽2 → 两张桃各转2orange
      if (qiu.hand.length !== 0) throw new Error('亚撒西替换抽牌后不应有手牌，实际 ' + qiu.hand.length);
      if (qiu.oranges !== 4) throw new Error('两张桃应转化4个orange，实际 ' + qiu.oranges);
      // 亚撒西每回合限一次：再抽杀应直接入手
      await g6.drawCards(qiu, 1);
      if (qiu.hand.filter(c => c.defId === 'sha').length !== 1) throw new Error('亚撒西本回合不应再触发');
      // 回合开始 +1 orange，主动使用回血
      await g6.emit('turnStart', { player: qiu });
      if (qiu.oranges !== 5) throw new Error('回合开始应+1 orange');
      qiu.hp = 2;
      await QYS.data.skills.sk_orange.exec(g6, qiu); // stub chooseTargets 返回第一个候选（自己）
      if (qiu.oranges !== 4 || qiu.hp !== 3) throw new Error('orange 使用应-1计数且回1血');
      console.log('orange/亚撒西检查 ✓（转化/限次/回合获得/使用回血）');
    }

    // 一起上厕所检查：距离强制1（双向、无视坐骑）、第三者正常、下回合解除、脱裤子夺防具
    {
      const io7 = () => ({ async chooseCard() { return null; }, async chooseBool() { return false; }, async chooseTargets(p, o) { return [o.candidates[1] || o.candidates[0]]; }, async askPlay() { return { type: 'end' }; }, log() {}, update() {} });
      const g7 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['变', '甲', '乙', '丙', '丁'], ioFor: io7 });
      const me = g7.players[0], far = g7.players[2], other = g7.players[1];
      me.skillIds = ['sk_toilet', 'sk_tuokuzi'];
      me.turn = { shaUsed: 0, wine: false, skipPlay: false, skillUsed: false };
      if (g7.distance(me, far) !== 2) throw new Error('初始距离应为2');
      far.equips.horsePlus = { defId: 'ma_def', suit: '♥', number: 3 }; // +1马 → 距离3
      if (g7.distance(me, far) !== 3) throw new Error('+1马后距离应为3');
      // 目标穿防具，一起上厕所 → 距离强制1 且防具被夺
      far.equips.armor = { defId: 'bagua', suit: '♠', number: 11 };
      const okExec = await QYS.data.skills.sk_toilet.exec(g7, me);
      if (!okExec) throw new Error('一起上厕所应发动成功');
      if (g7.distance(me, far) !== 1 || g7.distance(far, me) !== 1) throw new Error('上厕所双方距离应强制为1');
      if (g7.distance(me, other) !== 1) throw new Error('与第三者距离应正常');
      if (far.equips.armor !== null) throw new Error('目标防具应被夺走');
      if (!me.hand.some(c => c.defId === 'bagua')) throw new Error('防具应进入发动者手牌');
      // 发动者下回合开始解除
      g7.emit('turnStart', { player: me });
      if (g7.toilet !== null) throw new Error('下回合开始应解除');
      if (g7.distance(me, far) !== 3) throw new Error('解除后距离应恢复（含+1马为3）');
      console.log('一起上厕所检查 ✓（强制距离1/夺防具/下回合解除）');
    }
  }
})().catch(e => { console.error('模拟失败：', e); process.exit(1); });
