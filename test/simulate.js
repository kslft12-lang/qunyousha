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
  }
})().catch(e => { console.error('模拟失败：', e); process.exit(1); });
