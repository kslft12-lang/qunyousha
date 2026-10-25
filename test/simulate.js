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
  }
})().catch(e => { console.error('模拟失败：', e); process.exit(1); });
