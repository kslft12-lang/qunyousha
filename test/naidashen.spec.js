// 奶·大神 / 奶龙大笑 / 奶龙蛋 / 破壳 专项测试（node test/naidashen.spec.js）
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
  async chooseTargets(p, o) { return (o.candidates || []).slice(0, over.tcount ?? (o.max || 1)); },
  async askPlay() { return { type: 'end' }; },
  log() {}, update() {},
});

(async () => {
  const NAILONG = () => ({ defId: 'nailongdaxiao', suit: '♠', number: 1 });

  // ===== 众宾欢也：回合开始置入奶龙大笑（0~3人） =====
  {
    const g = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['奶', '甲', '乙', '丙', '丁'], ioFor: () => mkIo({ tcount: 2 }) });
    const nd = g.players[0];
    nd.charId = 'naidashen'; nd.skillIds = ['sk_poke', 'sk_zhongbhuan', 'sk_nailongdan'];
    g.players.slice(1).forEach(q => { q.skillIds = []; q.hand.length = 0; });
    g.turnCount = 1; // 未破壳
    await g.emit('turnStart', { player: nd });
    const holders = g.players.filter(q => q.hand.some(c => c.defId === 'nailongdaxiao'));
    if (holders.length !== 2) throw new Error('应置入2名角色，实际 ' + holders.length);
    if (!holders.every(q => q.hand.filter(c => c.defId === 'nailongdaxiao').length === 1)) throw new Error('破壳前每人应恰1张');
    // tcount:99 → 最多3名（未破壳上限）
    nd.io = mkIo({ tcount: 99 });
    g.players.forEach(q => { q.hand.length = 0; });
    await g.emit('turnStart', { player: nd });
    const holders2 = g.players.filter(q => q.hand.some(c => c.defId === 'nailongdaxiao'));
    if (holders2.length !== 3) throw new Error('未破壳至多3名，实际 ' + holders2.length);
    console.log('众宾欢也 ✓（0~3名各1张，超出截断）');
  }
  // ===== 奶龙大笑生命周期：占用一回合上限，弃牌阶段结束销毁（走真实 discardPhase）=====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙'], ioFor: () => mkIo({ bool: false, card: () => null }) });
    const jia = g.players[0];
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    jia.maxHp = 2; jia.hp = 2; // 上限2：手牌3张（奶龙占1格）→ 需弃1张真实牌
    jia.hand.push(NAILONG(), { defId: 'sha', suit: '♠', number: 3 }, { defId: 'shan', suit: '♦', number: 4 });
    jia.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    await QYS.rules.discardPhase(g, jia);
    if (jia.hand.length !== 1) throw new Error('弃牌后应剩1张真实牌（奶龙占1格），实际 ' + jia.hand.length);
    if (jia.hand.some(c => c.defId === 'nailongdaxiao')) throw new Error('奶龙大笑应在弃牌阶段后销毁');
    if (g.discard.some(c => c.defId === 'nailongdaxiao')) throw new Error('销毁不应进弃牌堆');
    if (!g.discard.some(c => ['sha', 'shan'].includes(QYS.def(c).id))) throw new Error('应弃置过一张真实牌');
    if (!g.logs.some(l => l.type === 'nailong')) throw new Error('销毁应产生 nailong 类型日志（音频触发源）');
    // 上限内时不销毁吗？——销毁无条件：清空手牌只留奶龙+1张（未超限）→ 奶龙仍销毁
    jia.hand.length = 0;
    jia.hand.push(NAILONG(), { defId: 'sha', suit: '♠', number: 5 });
    await QYS.rules.discardPhase(g, jia);
    if (jia.hand.length !== 1 || jia.hand[0].defId !== 'sha') throw new Error('未超限时奶龙也应到期销毁');
    console.log('奶龙生命周期 ✓（占上限/弃牌阶段后销毁/不进弃牌堆/nailong日志）');
  }
  // ===== 奶龙蛋：免疫1点伤害、≥2正常；抽牌-1、上限-1 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['奶', '甲', '乙'], ioFor: () => mkIo({}) });
    const nd = g.players[0], jia = g.players[1];
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    nd.skillIds = ['sk_nailongdan'];
    jia.hand.length = 0;
    const hpB = nd.hp;
    await g.damage({ source: jia, target: nd, amount: 1, tag: '杀' });
    if (nd.hp !== hpB) throw new Error('奶龙蛋应免疫1点伤害');
    await g.damage({ source: jia, target: nd, amount: 2, tag: '杀' });
    if (nd.hp !== hpB - 2) throw new Error('2点伤害应正常生效');
    // 抽牌-1
    g.players.forEach(q => { q.hand.length = 0; });
    nd.turn = { shaUsed: 0, wine: false, skipPlay: true, skipDraw: false, skillUsed: false };
    await QYS.rules.drawPhase(g, nd);
    if (nd.hand.length !== 1) throw new Error('奶龙蛋抽牌应-1（2→1），实际 ' + nd.hand.length);
    console.log('奶龙蛋 ✓（免疫1点/≥2生效/抽牌-1）');
  }
  // ===== 破壳：第4回合变形 =====
  {
    const g = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['奶', '甲', '乙', '丙', '丁'], ioFor: () => mkIo({ tcount: 8 }) });
    const nd = g.players[0];
    nd.charId = 'naidashen'; nd.skillIds = ['sk_poke', 'sk_zhongbhuan', 'sk_nailongdan'];
    g.players.slice(1).forEach(q => { q.skillIds = []; q.hand.length = 0; });
    g.turnCount = 3;
    nd.hp = 1; nd.maxHp = 4;
    // 第3回合：不触发
    await g.emit('turnStart', { player: g.players[1] });
    if (nd.shellBroken) throw new Error('第3回合不应破壳');
    // 第4回合：变形
    g.turnCount = 4;
    await g.emit('turnStart', { player: g.players[1] });
    if (!nd.shellBroken) throw new Error('第4回合应破壳');
    if (nd.skillIds.includes('sk_nailongdan')) throw new Error('奶龙蛋应失效');
    if (nd.maxHp !== 6 || nd.hp !== 6) throw new Error('血量上限+2并回满，实际 ' + nd.hp + '/' + nd.maxHp);
    // 破壳后众宾欢也：8人各2张
    nd.io = mkIo({ tcount: 99 });
    await g.emit('turnStart', { player: nd });
    const holders = g.players.filter(q => q.hand.some(c => c.defId === 'nailongdaxiao'));
    if (holders.length !== 5) throw new Error('破壳后可选至8名（场上5人全选），实际 ' + holders.length);
    if (!holders.every(q => q.hand.filter(c => c.defId === 'nailongdaxiao').length === 2)) throw new Error('破壳后每人应2张');
    // 破壳后抽牌+2（奶龙蛋失效不再-1）
    nd.hand.length = 0;
    nd.turn = { shaUsed: 0, wine: false, skipPlay: true, skipDraw: false, skillUsed: false };
    nd.io = mkIo({});
    await QYS.rules.drawPhase(g, nd);
    if (nd.hand.length !== 4) throw new Error('破壳后抽牌应2+2=4，实际 ' + nd.hand.length);
    // 免疫失效
    const attacker = g.players[1];
    attacker.hand.length = 0;
    const hpB = nd.hp;
    await g.damage({ source: attacker, target: nd, amount: 1, tag: '杀' });
    if (nd.hp !== hpB - 1) throw new Error('破壳后1点伤害应正常生效');
    console.log('破壳 ✓（第4回合变形/奶龙蛋失效/上限+2回满/众宾欢也强化/抽牌+2/免疫失效）');
  }
  // ===== 奶龙蛋：手牌上限-1（真实 discardPhase）=====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['奶', '甲', '乙'], ioFor: () => mkIo({ bool: false, card: () => null }) });
    const nd = g.players[0];
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    nd.skillIds = ['sk_nailongdan'];
    nd.hp = 5; nd.maxHp = 5; // 无奶龙蛋上限5；有则4
    nd.hand.push({ defId: 'sha', suit: '♠', number: 1 }, { defId: 'sha', suit: '♠', number: 2 }, { defId: 'sha', suit: '♠', number: 3 }, { defId: 'sha', suit: '♠', number: 4 }, { defId: 'sha', suit: '♠', number: 5 });
    nd.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    await QYS.rules.discardPhase(g, nd);
    if (nd.hand.length !== 4) throw new Error('奶龙蛋上限应为4，弃1后剩4，实际 ' + nd.hand.length);
    console.log('奶龙蛋·手牌上限 ✓（上限-1）');
  }
  // ===== 奶龙大笑不可转移/不可弃置 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['奶', '甲', '乙'], ioFor: () => mkIo({}) });
    const nd = g.players[0];
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    nd.hand.push(NAILONG(), { defId: 'shan', suit: '♦', number: 2 });
    const pick = g.randomZoneCard(nd);
    if (pick.card.defId !== 'shan') throw new Error('奶龙大笑不可被拿走');
    const asked = await g.askCard(nd, { filter: () => true, tag: '弃牌' });
    if (asked && asked.defId === 'nailongdaxiao') throw new Error('奶龙大笑不可被选中弃置');
    console.log('奶龙大笑·诅咒属性 ✓（不可转移/不可弃置）');
  }
  console.log('\n奶·大神专项测试全部通过 ✓');
})().catch(e => { console.error('失败:', e); process.exit(1); });
