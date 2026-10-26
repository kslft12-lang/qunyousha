// 太刀 / 大剑 武器牌专项测试（node test/weapons.spec.js）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/data/characters.js', 'js/data/cards.js', 'js/engine/core.js', 'js/engine/rules.js', 'js/adapter/bot.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
QYS.bot.fast = true;

const mkIo = over => ({
  async chooseCard(p, o) { return p.hand.find(c => (o.filter ? o.filter(c) : true) && (!over.card || over.card(c))) || null; },
  async chooseBool() { return over.bool !== false; },
  async chooseTargets(p, o) { return o.candidates.slice(0, o.max || 1); },
  async askPlay() { return { type: 'end' }; },
  log() {}, update() {},
});
const shaCard = { defId: 'sha', suit: '♠', number: 9 };
const TAIDAO = { defId: 'taidao', suit: '♠', number: 2 };
const DAJIAN = { defId: 'dajian', suit: '♠', number: 2 };

(async () => {
  // ===== 太刀：射程2 / 牌组恰一张 =====
  {
    const t = QYS.data.cards.find(c => c.id === 'taidao');
    const d = QYS.data.cards.find(c => c.id === 'dajian');
    if (!t || t.range !== 2 || t.deckCount !== 1 || t.slot !== 'weapon') throw new Error('太刀定义错误');
    if (!d || d.range !== 2 || d.deckCount !== 1 || d.slot !== 'weapon') throw new Error('大剑定义错误');
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙'], ioFor: () => mkIo({}) });
    const total = g.deck.filter(c => c.defId === 'taidao').length + g.players.reduce((n, p) => n + p.hand.filter(c => c.defId === 'taidao').length, 0);
    if (total !== 1) throw new Error('太刀应恰一张在局内，实际 ' + total);
    console.log('太刀/大剑定义 ✓（射程2、牌组各一张、太刀已入局）');
  }
  // ===== 太刀：花生酱酱酱打出闪摸牌；非其装备不触发 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['花', '甲', '乙'], ioFor: () => mkIo({ card: c => QYS.def(c).id === 'shan' }) });
    const [hs, jia] = g.players;
    hs.skillIds = ['sk_yijiyiji', 'sk_wuxigai', 'sk_taidao']; // 花生酱酱酱
    jia.skillIds = [];
    hs.hand.length = 0; hs.hand.push({ defId: 'shan', suit: '♦', number: 2 });
    jia.hand.length = 0;
    hs.equips.weapon = { ...TAIDAO };
    const deckB = g.deck.length;
    await g.shaResolve(jia, hs, 0, shaCard);
    if (hs.hp !== hs.maxHp) throw new Error('闪应令杀无效');
    if (hs.hand.length !== 1 || g.deck.length !== deckB - 1) throw new Error('太刀打出闪应摸一张');
    // 万箭场合打闪同样摸
    hs.hand.length = 0; hs.hand.push({ defId: 'shan', suit: '♦', number: 3 });
    const deckB2 = g.deck.length;
    await g.dodgeCheck(hs, 'wanjian', null);
    if (hs.hand.length !== 1 || g.deck.length !== deckB2 - 1) throw new Error('太刀万箭场合打闪也应摸牌');
    console.log('太刀·闪摸牌 ✓（杀/万箭场合均摸）');
  }
  {
    // 非花生酱酱酱装备太刀：打闪不摸
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙'], ioFor: () => mkIo({ card: c => QYS.def(c).id === 'shan' }) });
    const [p0, jia] = g.players;
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    p0.hand.push({ defId: 'shan', suit: '♦', number: 2 });
    jia.hand.length = 0;
    p0.equips.weapon = { ...TAIDAO };
    const deckB = g.deck.length;
    await g.shaResolve(jia, p0, 0, shaCard);
    if (g.deck.length !== deckB) throw new Error('非花生酱酱酱装备太刀不应摸牌');
    console.log('太刀·专属限制 ✓（他人装备无效果）');
  }
  // ===== 太刀：一几一几当闪也摸牌 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['花', '甲', '乙'], ioFor: () => mkIo({ bool: true, card: () => true }) });
    const hs = g.players[0];
    hs.skillIds = ['sk_yijiyiji', 'sk_wuxigai', 'sk_taidao'];
    hs.hand.length = 0; hs.hand.push({ defId: 'wuzhong', suit: '♥', number: 5 }); // 无闪，一几一几拿无中生有当闪
    hs.equips.weapon = { ...TAIDAO };
    const deckB = g.deck.length;
    await g.dodgeCheck(hs, 'sha', null);
    if (hs.hand.length !== 1) throw new Error('一几一几弃牌后手牌应只剩太刀摸的1张，实际 ' + hs.hand.length);
    if (g.deck.length !== deckB - 1) throw new Error('太刀：一几一几当闪应摸一张');
    console.log('太刀·一几一几 ✓（当闪打出后摸一张）');
  }
  // ===== 太刀：刃等级永不下降 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['花', '甲', '乙'], ioFor: () => mkIo({}) });
    const [hs, jia] = g.players;
    hs.skillIds = ['sk_yijiyiji', 'sk_wuxigai', 'sk_taidao'];
    jia.skillIds = [];
    hs.blade = 3; // 红刃
    jia.hand.length = 0; jia.hp = 1; jia.identity = '反';
    // 无太刀：杀敌掉级
    const shaDef = QYS.data.cards.find(c => c.id === 'sha');
    hs.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    await shaDef.effect(g, { user: hs, targets: [jia], card: shaCard });
    if (hs.blade !== 2) throw new Error('无太刀杀敌应掉一级');
    // 装备太刀：杀敌不掉级
    jia.hp = 1; jia.alive = true; jia.hand.length = 0;
    hs.equips.weapon = { ...TAIDAO };
    hs.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    await shaDef.effect(g, { user: hs, targets: [jia], card: shaCard });
    // 用杀先升级（2→3），杀敌不掉级 → 应保持 3；若掉级则为 2
    if (hs.blade !== 3) throw new Error('装备太刀杀敌刃等级应升级且不下降（预期3），实际 ' + hs.blade);
    console.log('太刀·刃不降 ✓（无刀掉级/有刀保持）');
  }
  // ===== 大剑：斯坦尊尊每回合蓄力+1 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['斯', '甲', '乙'], ioFor: () => mkIo({}) });
    const s = g.players[0];
    s.skillIds = ['sk_dajianxia', 'sk_zhenxuzhan', 'sk_xiangsha'];
    s.charge = 0;
    s.turn = { shaUsed: 1, wine: false, skipPlay: false, skipDraw: false, skillUsed: false }; // 本回合用过杀
    // 无大剑：用过杀不蓄力
    await g.emit('phaseEnd', { player: s, phase: '结束' });
    if (s.charge !== 0) throw new Error('用过杀且无大剑不应蓄力');
    // 装备大剑：用过杀也+1
    s.equips.weapon = { ...DAJIAN };
    await g.emit('phaseEnd', { player: s, phase: '结束' });
    if (s.charge !== 1) throw new Error('大剑应每回合+1，实际 ' + s.charge);
    // 未用杀：真蓄斩+大剑 = +2
    s.turn.shaUsed = 0;
    await g.emit('phaseEnd', { player: s, phase: '结束' });
    if (s.charge !== 3) throw new Error('未用杀应+2（真蓄斩+大剑），实际 ' + s.charge);
    console.log('大剑·蓄力 ✓（用杀+1/未用杀+2/无刀不蓄）');
  }
  {
    // 非斯坦尊尊装备大剑：不蓄力
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙'], ioFor: () => mkIo({}) });
    const p0 = g.players[0];
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    p0.equips.weapon = { ...DAJIAN };
    p0.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    await g.emit('phaseEnd', { player: p0, phase: '结束' });
    if (p0.charge !== 0) throw new Error('非斯坦尊尊装备大剑不应蓄力');
    console.log('大剑·专属限制 ✓');
  }
  console.log('\n太刀/大剑专项测试全部通过 ✓');
})().catch(e => { console.error('失败:', e); process.exit(1); });
