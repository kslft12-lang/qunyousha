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

    // 噜噜打汪检查：狼牙棒（主公范围/伤害+1/连弩无效）、新疆网络（50%失效）、梯子专家（交牌/盯人失败判定）
    {
      const io8 = over => ({ async chooseCard(p, o) { return p.hand.find(c => (o.filter ? o.filter(c) : true) && (!over.card || over.card(c))) || null; }, async chooseBool() { return over.bool !== false; }, async chooseTargets(p, o) { return [o.candidates[0]]; }, async askPlay() { return { type: 'end' }; }, log() {}, update() {} });
      const g8 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['噜', '甲', '乙', '丙', '丁'], ioFor: () => io8({ card: () => false }) });
      const [lulu, jia, yi] = g8.players;
      lulu.skillIds = ['sk_langyabang', 'sk_xinjiangwang', 'sk_ladder'];
      if (!g8.inShaRange(lulu, yi)) throw new Error('狼牙棒主公攻击范围应+1覆盖距离2');
      lulu.identity = '反';
      if (g8.inShaRange(lulu, yi)) throw new Error('非主公狼牙棒不应生效');
      lulu.identity = '主';
      lulu.turn = { shaUsed: 1, wine: false, skipPlay: false, skillUsed: false };
      lulu.equips.weapon = { defId: 'liannu', suit: '♦', number: 1 };
      const shaDef2 = QYS.data.cards.find(c => c.id === 'sha');
      if (shaDef2.canUse(g8, lulu)) throw new Error('狼牙棒主公连弩应无效');
      lulu.equips.weapon = null;
      // 伤害+1：甲无闪无网络，挨打掉2血
      jia.hand.length = 0;
      const hpB = jia.hp;
      await shaDef2.effect(g8, { user: lulu, targets: [jia], card: { defId: 'sha', suit: '♠', number: 7 } });
      if (jia.hp !== hpB - 2) throw new Error('狼牙棒主公杀伤害应+1，实际掉 ' + (hpB - jia.hp));
      // 新疆网络：对乙的杀 100 次统计，应有失效也有命中
      yi.skillIds = ['sk_xinjiangwang'];
      yi.hand.length = 0;
      let miss = 0, hit = 0;
      for (let k = 0; k < 100; k++) {
        yi.hp = 4;
        (await g8.shaResolve(lulu, yi, 0)) ? hit++ : miss++;
      }
      if (miss === 0 || hit === 0 || miss < 30 || miss > 70) throw new Error('新疆网络失效比例异常: ' + miss + '/100');
      // 梯子专家：盯甲（甲选交牌）→ 手牌转移
      yi.skillIds = [];
      jia.hand.length = 0; jia.hand.push({ defId: 'shan', suit: '♦', number: 2 });
      const luluHandB = lulu.hand.length;
      await g8.emit('turnStart', { player: lulu });
      if (jia.hand.length !== 0 || lulu.hand.length !== luluHandB + 1) throw new Error('梯子专家交牌未转移');
      // 甲改为拒绝（bool false）→ ladderFail；用牌失败统计
      g8.players.forEach(q => { q.ladderFail = false; });
      jia.hand.length = 0; jia.hand.push({ defId: 'shan', suit: '♦', number: 3 });
      lulu.hand.length = 0;
      jia.io = io8({ card: () => false, bool: false }); // 换成会拒绝交牌的决策
      await QYS.data.skills.sk_ladder.hooks.turnStart(g8, lulu, { player: lulu });
      if (!jia.ladderFail) throw new Error('拒绝交牌应被标记 ladderFail');
      jia.io = io8({}); // 统计阶段：桩正常给牌，失败只能来自梯子专家判定
      let fail = 0;
      for (let k = 0; k < 100; k++) {
        const r = await g8.askCard(jia, { filter: c => QYS.def(c).id === 'shan', tag: '闪' });
        if (!r) fail++;
      }
      if (fail < 30 || fail > 70) throw new Error('梯子用牌失败比例异常: ' + fail + '/100');
      console.log('噜噜打汪检查 ✓（狼牙棒范围/伤害/连弩无效、新疆网络' + miss + '%失效、梯子专家交牌/失败' + fail + '%）');
    }

    // 无膝盖之人 + 太刀高手检查：禁骑坐骑、升级链（范围/两杀/伤害）、杀敌掉级
    {
      const io9 = () => ({ async chooseCard() { return null; }, async chooseBool() { return false; }, async chooseTargets() { return null; }, async askPlay() { return { type: 'end' }; }, log() {}, update() {} });
      const g9 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['花', '甲', '乙', '丙', '丁'], ioFor: io9 });
      const hua = g9.players[0], far = g9.players[2];
      hua.skillIds = ['sk_yijiyiji', 'sk_wuxigai', 'sk_taidao'];
      // 无膝盖：坐骑不可装备，武器/防具正常
      if (QYS.rules.playInfo(g9, hua, { defId: 'ma_atk', suit: '♣', number: 9 }).ok) throw new Error('-1马应不可装备');
      if (!QYS.rules.playInfo(g9, hua, { defId: 'liannu', suit: '♦', number: 1 }).ok) throw new Error('武器应可装备');
      // 太刀升级链
      const shaDef3 = QYS.data.cards.find(c => c.id === 'sha');
      hua.turn = { shaUsed: 0, wine: false, skipPlay: false, skillUsed: false };
      far.hand.length = 0;
      if (hua.blade !== 0) throw new Error('太刀初始应为无');
      // 第1杀：升至白刃，范围+1 覆盖距离2（此次伤害仍1点）
      await shaDef3.effect(g9, { user: hua, targets: [far], card: { defId: 'sha', suit: '♠', number: 4 } });
      if (hua.blade !== 1) throw new Error('第1杀后应为白刃');
      if (!g9.inShaRange(hua, far)) throw new Error('白刃攻击范围应+1');
      // 第2杀：升至黄刃 → 每回合两杀
      far.hp = 4;
      hua.turn.shaUsed = 0;
      await shaDef3.effect(g9, { user: hua, targets: [far], card: { defId: 'sha', suit: '♠', number: 5 } });
      if (hua.blade !== 2) throw new Error('第2杀后应为黄刃');
      hua.turn.shaUsed = 1;
      if (!shaDef3.canUse(g9, hua)) throw new Error('黄刃应允许第二张杀');
      // 第3杀：升至红刃 → 伤害+1（升级当次生效）
      far.hp = 4;
      hua.turn.shaUsed = 0;
      await shaDef3.effect(g9, { user: hua, targets: [far], card: { defId: 'sha', suit: '♠', number: 6 } });
      if (hua.blade !== 3) throw new Error('第3杀后应为红刃');
      if (far.hp !== 2) throw new Error('红刃杀应造成2点伤害，实际剩 ' + far.hp);
      // 以杀杀死 → 掉一级（红刃3→2）
      far.hp = 1; far.identity = '忠';
      hua.turn.shaUsed = 0;
      await shaDef3.effect(g9, { user: hua, targets: [far], card: { defId: 'sha', suit: '♠', number: 7 } });
      if (!(!far.alive && hua.blade === 2)) throw new Error('杀敌应跌落一级，当前 ' + hua.blade);
      console.log('无膝盖/太刀高手检查 ✓（禁坐骑/升级链/红刃2伤/杀敌掉级）');
    }
  }
})().catch(e => { console.error('模拟失败：', e); process.exit(1); });
