// 凑鸽子 / 臭鸡炸炸炸 / 濒死救援 专项测试（node test/cougezi.spec.js）
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

(async () => {
  // ===== 焦香酥脆 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['鸽', '甲', '乙'], ioFor: () => mkIo({}) });
    const [pg, jia] = g.players;
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    pg.skillIds = ['sk_jiaoxiang'];
    jia.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    const maxB = pg.maxHp;
    const deckB = g.deck.length;
    await QYS.data.cards.find(c => c.id === 'sha').effect(g, { user: jia, targets: [pg], card: shaCard });
    if (pg.maxHp !== maxB - 1) throw new Error('被杀命中应-1生命上限');
    if (jia.hand.length !== 1 || g.deck.length !== deckB - 1) throw new Error('伤害来源应摸一张');
    const maxB2 = pg.maxHp;
    await QYS.data.cards.find(c => c.id === 'juedou').effect(g, { user: jia, targets: [pg], card: { defId: 'juedou', suit: '♠', number: 6 } });
    if (pg.maxHp !== maxB2) throw new Error('决斗伤害不应触发焦香酥脆');
    console.log('焦香酥脆 ✓（杀命中来源摸1+上限-1；决斗不触发）');
  }
  // ===== 闻着凑吃着香 =====
  {
    const g = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '鸽', '丙', '丁'], ioFor: () => mkIo({}) });
    const jia = g.players[0], pg = g.players[2]; // 环距2，默认不可及
    g.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
    pg.skillIds = ['sk_wenzhe'];
    jia.turn = { shaUsed: 1, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    const shaDef = QYS.data.cards.find(c => c.id === 'sha');
    if (shaDef.canUse(g, jia)) throw new Error('次数用尽且凑鸽子不可及时应不可用');
    jia.equips.horseMinus = { defId: 'ma_atk', suit: '♣', number: 9 };
    if (!shaDef.canUse(g, jia)) throw new Error('凑鸽子在范围内时应可用');
    const cands = shaDef.target.candidates(g, jia);
    if (cands.length !== 1 || !cands.includes(pg)) throw new Error('次数用尽时候选应只有凑鸽子');
    pg.alive = false;
    if (shaDef.canUse(g, jia)) throw new Error('凑鸽子阵亡后应恢复次数限制');
    pg.alive = true;
    jia.turn.shaUsed = 0;
    if (shaDef.target.candidates(g, jia).length < 2) throw new Error('次数未用尽时候选应正常');
    console.log('闻着凑吃着香 ✓（次数用尽仅可指定凑鸽子/范围限制/阵亡恢复）');
  }
  // ===== 臭鸡炸炸炸开局洗入 =====
  {
    let g = null, hasPg = false;
    for (let k = 0; k < 40 && !hasPg; k++) { // 8/14 概率随机到凑鸽子，重试直到命中
      g = QYS.core.createGame({ playerCount: 8, humanSeat: null, lordSeat: 0, names: ['鸽', '甲', '乙', '丙', '丁', '戊', '己', '庚'], ioFor: () => mkIo({}) });
      hasPg = g.players.some(p => p.charId === 'cougezi');
    }
    if (!hasPg) throw new Error('40 次随机仍未抽到凑鸽子');
    // 起始发牌不走弹回逻辑，臭鸡炸炸炸可能在牌堆也可能在某家起始手牌：总数应为 1
    const total = g.deck.filter(c => c.defId === 'choujizhazha').length
      + g.players.reduce((n, p) => n + p.hand.filter(c => c.defId === 'choujizhazha').length, 0);
    if (total !== 1) throw new Error('臭鸡炸炸炸应恰有一张（牌堆+手牌），实际 ' + total);
    console.log('臭鸡炸炸炸开局洗入 ✓');
  }
  {
    let g = null;
    for (let k = 0; k < 40; k++) { // 找一局没有凑鸽子的（14选3 ≈ 每局60%+没有，重试必中）
      g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙'], ioFor: () => mkIo({}) });
      if (!g.players.some(p => p.charId === 'cougezi')) break;
    }
    if (g.players.some(p => p.charId === 'cougezi')) throw new Error('40 次仍未抽到无凑鸽子的局');
    g.players.forEach(q => { q.hand.length = 0; });
    if (g.deck.some(c => c.defId === 'choujizhazha')) throw new Error('无凑鸽子不应有臭鸡炸炸炸');
    g.deck.push({ defId: 'choujizhazha', suit: '♠', number: 1 });
    const got = await g.drawCards(g.players[0], 1);
    if (got.length !== 1 || got[0].defId === 'choujizhazha') throw new Error('应弹回并重抽到别的牌');
    if (!g.deck.some(c => c.defId === 'choujizhazha')) throw new Error('弹回后牌堆应仍有臭鸡炸炸炸');
    console.log('臭鸡炸炸炸弹回重抽 ✓（不占摸牌名额，牌堆保留）');
  }
  // ===== 只有凑鸽子能用 =====
  {
    const g = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['鸽', '甲', '乙', '丙', '丁'], ioFor: () => mkIo({}) });
    const pg = g.players[0], other = g.players[1];
    pg.charId = 'cougezi'; pg.skillIds = ['sk_jiaoxiang', 'sk_wenzhe', 'sk_chouji'];
    other.charId = 'luren'; other.skillIds = []; // 钉死对照角色（随机池里可能也是凑鸽子）
    g.deck.push({ defId: 'choujizhazha', suit: '♠', number: 1 }); // 模拟技能洗入
    const card = { defId: 'choujizhazha', suit: '♠', number: 2 };
    g.players.forEach(q => { q.hand.length = 0; }); // 清掉起始手牌，保证 hand[0] 就是测试牌
    pg.hand.push(card);
    pg.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    if (!QYS.rules.playInfo(g, pg, card).ok) throw new Error('凑鸽子应可用臭鸡炸炸炸');
    other.hand.push({ ...card });
    other.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    if (QYS.rules.playInfo(g, other, other.hand[0]).ok) throw new Error('其他角色不应可用臭鸡炸炸炸');
    console.log('臭鸡炸炸炸使用限制 ✓');
  }
  // ===== 效果：丢桃酒 + 生命归零 =====
  {
    const g = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['鸽', '甲', '乙', '丙', '丁'], ioFor: () => mkIo({ bool: false }) });
    const pg = g.players[0], jia = g.players[1];
    pg.charId = 'cougezi'; pg.skillIds = ['sk_jiaoxiang', 'sk_wenzhe', 'sk_chouji'];
    g.players.forEach(q => { q.hand.length = 0; q.skillIds = (q.skillIds || []).filter(s => s !== 'sk_zhanglang'); });
    jia.hand.push({ defId: 'tao', suit: '♥', number: 2 }, { defId: 'jiu', suit: '♦', number: 3 }, { defId: 'shan', suit: '♦', number: 4 });
    const card = { defId: 'choujizhazha', suit: '♠', number: 1 };
    await QYS.data.cards.find(c => c.id === 'choujizhazha').effect(g, { user: pg, targets: [jia], card });
    const disc = g.discard.map(c => QYS.def(c).id);
    if (!disc.includes('tao') || !disc.includes('jiu')) throw new Error('桃酒应被丢弃进弃牌堆');
    if (jia.alive) throw new Error('生命归零且无人救应阵亡');
    console.log('臭鸡炸炸炸效果 ✓（丢弃桃酒/生命归零/无人救阵亡）');
  }
  // ===== 酒救濒死 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['鸽', '甲', '乙'], ioFor: () => mkIo({ bool: false }) });
    const [pg, jia, yi] = g.players;
    g.players.forEach(q => { q.skillIds = (q.skillIds || []).filter(s => s !== 'sk_zhanglang' && s !== 'sk_chouji'); q.hand.length = 0; });
    yi.hand.push({ defId: 'jiu', suit: '♦', number: 3 });
    jia.hand.push({ defId: 'tao', suit: '♥', number: 2 });
    const card = { defId: 'choujizhazha', suit: '♠', number: 1 };
    await QYS.data.cards.find(c => c.id === 'choujizhazha').effect(g, { user: pg, targets: [jia], card });
    if (!jia.alive || jia.hp !== 1) throw new Error('乙的酒应救回甲（1血）');
    console.log('濒死救援·酒 ✓');
  }
  // ===== orange 救濒死 =====
  {
    const g = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['鸽', '甲', '秋'], ioFor: () => mkIo({ bool: true, card: () => null }) });
    const [pg, jia, qiu] = g.players;
    g.players.forEach(q => { q.skillIds = (q.skillIds || []).filter(s => s !== 'sk_zhanglang' && s !== 'sk_chouji'); q.hand.length = 0; });
    qiu.skillIds = ['sk_orange'];
    qiu.oranges = 2;
    jia.hand.push({ defId: 'tao', suit: '♥', number: 2 });
    const card = { defId: 'choujizhazha', suit: '♠', number: 1 };
    await QYS.data.cards.find(c => c.id === 'choujizhazha').effect(g, { user: pg, targets: [jia], card });
    if (!jia.alive || jia.hp !== 1) throw new Error('orange 应救回甲');
    if (qiu.oranges !== 1) throw new Error('orange 应消耗1个，剩 ' + qiu.oranges);
    console.log('濒死救援·orange ✓');
  }
  console.log('\n凑鸽子/臭鸡炸炸炸/濒死救援专项测试全部通过 ✓');
})().catch(e => { console.error('失败:', e); process.exit(1); });
