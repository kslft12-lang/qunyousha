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
    g.players.slice(1).forEach(q => { q.skillIds = (q.skillIds || []).filter(s => s !== 'sk_wenzhe'); }); // 排除随机凑鸽子（闻着凑吃着香：次数用尽仍可对其出杀）
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
      g5.players.slice(1).forEach(q => { q.skillIds = (q.skillIds || []).filter(s => s !== 'sk_wenzhe'); }); // 排除随机凑鸽子：次数用尽仍可对其出杀（闻着凑吃着香）会干扰断言
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
      me.turn.shaUsed = 0; // 候选测试需在次数未用尽状态下（闻着凑吃着香：用尽时候选仅凑鸽子）
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
      g7.players.slice(1).forEach(q => { q.skillIds = []; }); // 钉死他人技能：候选过滤（蘑菇不可选）不受随机角色影响
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
      jia.skillIds = []; yi.skillIds = []; // 钉死对手技能，排除随机角色的蟑螂/呜呜呜袜等干扰
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
      far.skillIds = []; // 钉死靶子技能，排除蟑螂回魂/新疆网络等随机干扰
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

    // 呜呜呜袜改版 / 隐身 / 香香的检查
    {
      let captured = null; // 捕获凑凑的捣乱狂候选列表
      const io10 = over => ({
        async chooseCard(p, o) { return p.hand.find(c => (o.filter ? o.filter(c) : true) && (!over.card || over.card(c))) || null; },
        async chooseBool() { return over.bool !== false; },
        async chooseTargets(p, o) { captured = o.candidates; return o.candidates.slice(0, o.max || 1); },
        async askPlay() { return { type: 'end' }; }, log() {}, update() {},
      });
      const g10 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 1, names: ['魔', '甲', '乙', '丙', '丁'], ioFor: () => io10({}) });
      const [mo, jia, yi] = g10.players;
      mo.skillIds = ['sk_wuwuwuwa', 'sk_yinshen', 'sk_xiangxiang'];
      yi.skillIds = []; jia.skillIds = []; // 钉死他人技能，避免随机出的第二隐身/干扰技能
      // 呜呜呜袜：来源有手牌且同意 → 交牌、伤害照常
      jia.hand.length = 0; jia.hand.push({ defId: 'sha', suit: '♠', number: 5 });
      const moHandB = mo.hand.length, moHpB = mo.hp;
      await g10.damage({ source: jia, target: mo, amount: 1, tag: '杀' });
      if (mo.hp !== moHpB - 1 || mo.hand.length !== moHandB + 1 || jia.hand.length !== 0) throw new Error('呜呜呜袜交牌分支异常');
      // 来源无手牌 → 只能令伤害无效
      await g10.damage({ source: jia, target: mo, amount: 2, tag: '杀' });
      if (mo.hp !== moHpB - 1) throw new Error('无手牌来源的伤害应无效');
      // 来源拒绝（bool false）→ 伤害无效
      jia.io = io10({ bool: false });
      jia.hand.length = 0; jia.hand.push({ defId: 'sha', suit: '♠', number: 6 });
      await g10.damage({ source: jia, target: mo, amount: 1, tag: '杀' });
      if (mo.hp !== moHpB - 1 || mo.hand.length !== moHandB + 1) throw new Error('拒绝交牌应令伤害无效');
      // 隐身：决斗/拆桥/乐不思蜀候选不含魔女，杀不受影响
      const info = id => QYS.rules.playInfo(g10, jia, { defId: id, suit: '♠', number: 3 });
      for (const id of ['juedou', 'chaiqiao', 'lebu']) {
        const t = info(id).targets;
        if (t.includes(mo)) throw new Error(id + ' 不应可选魔女');
        if (!t.includes(yi)) throw new Error(id + ' 应仍可选其他角色');
      }
      // 杀仍可选魔女（需 turn 供 canUse 检查）
      jia.turn = { shaUsed: 0, wine: false, skipPlay: false, skillUsed: false };
      const shaInfo = QYS.rules.playInfo(g10, jia, { defId: 'sha', suit: '♠', number: 7 });
      if (!shaInfo.targets.includes(mo)) throw new Error('杀仍应可选魔女');
      // 香香的：凑凑的捣乱狂候选不含魔女
      yi.skillIds = ['sk_daoluan'];
      await g10.emit('turnStart', { player: yi });
      if (captured && captured.includes(mo)) throw new Error('凑凑的捣乱狂不应可选魔女');
      console.log('呜呜呜袜改版/隐身/香香的检查 ✓（交牌或无效/单体锦囊不可选/捣乱狂不可选）');
    }

    // 阴暗爬行 / 蟑螂回魂检查
    {
      const io11 = over => ({
        async chooseCard(p, o) { return p.hand.find(c => (o.filter ? o.filter(c) : true) && (!over.card || over.card(c))) || null; },
        async chooseBool() { return over.bool !== false; },
        async chooseTargets(p, o) { return o.candidates.slice(0, o.max || 1); },
        async askPlay() { return { type: 'end' }; }, log() {}, update() {},
      });
      const g11 = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 1, names: ['好', '甲', '乙'], ioFor: p => io11(p.seat === 0 ? { card: c => ['sha', 'tao'].includes(QYS.def(c).id) } : { card: () => false }) });
      const hao = g11.players[0];
      // 阴暗爬行：手里只有杀，被杀指定时当闪打出
      hao.skillIds = ['sk_yinpa', 'sk_zhanglang'];
      hao.hand.length = 0; hao.hand.push({ defId: 'sha', suit: '♠', number: 5 });
      const dodge1 = await g11.dodgeCheck(hao, 'sha');
      if (!(dodge1 && hao.hand.length === 0)) throw new Error('阴暗爬行应以杀当闪');
      // 万箭场合也可用
      hao.hand.length = 0; hao.hand.push({ defId: 'tao', suit: '♥', number: 4 });
      const dodge2 = await g11.dodgeCheck(hao, 'wanjian');
      if (!(dodge2 && hao.hand.length === 0)) throw new Error('阴暗爬行万箭场合应以桃当闪');
      // 非杀/桃不能转（手里无可用牌）
      hao.hand.length = 0; hao.hand.push({ defId: 'wuxie', suit: '♠', number: 8 });
      const dodge3 = await g11.dodgeCheck(hao, 'sha');
      if (dodge3) throw new Error('无懈不可当闪');
      // 蟑螂回魂：打至0血无人救 → 回3；第二次死亡 → 真死
      hao.hand.length = 0;
      hao.hp = 1;
      await g11.damage({ source: g11.players[1], target: hao, amount: 1, tag: '杀' });
      if (!hao.alive || hao.hp !== 3 || !hao.cockroachUsed) throw new Error('蟑螂回魂应回3血并标记已用');
      hao.hp = 1;
      await g11.damage({ source: g11.players[1], target: hao, amount: 1, tag: '杀' });
      if (hao.alive) throw new Error('蟑螂回魂每局一次，第二次应死亡');
      // 有人出桃救助时不消耗蟑螂
      const g12 = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 1, names: ['好', '甲', '乙'], ioFor: p => io11(p.seat === 1 ? { card: c => QYS.def(c).id === 'tao' } : { card: () => false }) });
      const hao2 = g12.players[0], jia2 = g12.players[1];
      hao2.skillIds = ['sk_zhanglang'];
      hao2.hand.length = 0;
      jia2.hand.length = 0; jia2.hand.push({ defId: 'tao', suit: '♥', number: 9 });
      hao2.hp = 1;
      await g12.damage({ source: g12.players[2], target: hao2, amount: 1, tag: '杀' });
      if (!hao2.alive || hao2.cockroachUsed) throw new Error('被桃救起不应消耗蟑螂回魂');
      console.log('阴暗爬行/蟑螂回魂检查 ✓（杀桃当闪/万箭可用/回魂一次/桃救不消耗）');
    }

    // 蘑菇检查：蘑菇生长/金针菇诅咒（塞入·不可选·到期·上厕所移出）/魅惑菇/毁灭菇/杏鲍菇/猴头菇/似乎有些触动
    {
      const io13 = () => ({
        async chooseCard(p, o) { return p.hand.find(c => (o.filter ? o.filter(c) : true)) || null; },
        async chooseBool() { return true; },
        async chooseTargets(p, o) { return o.candidates.slice(0, o.max || 1); },
        async askPlay() { return { type: 'end' }; }, log() {}, update() {},
      });
      const g13 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['菇', '甲', '乙', '丙', '丁'], ioFor: () => io13() });
      const [gu, jia, yi, bing, ding] = g13.players;
      gu.charId = 'mogu'; gu.skillIds = ['sk_chudong', 'sk_jinzhengu', 'sk_mogushengzhang']; // 钉死蘑菇与技能
      g13.players.slice(1).forEach(q => { q.charId = 'luren'; q.skillIds = []; }); // 钉死他人（防随机出第二个蘑菇干扰毁灭菇免疫断言）
      g13.players.forEach(q => { q.hand.length = 0; }); // 清手牌控制断言
      const shroomIds = ['mehuogu', 'huimiegu', 'xingbaogu', 'houtougu'];
      // 1) 回合开始：似乎有些触动（无牌可弃 → 额外摸1）+ 蘑菇生长（+1 张蘑菇牌）
      await g13.emit('turnStart', { player: gu });
      if (gu.hand.length !== 2) throw new Error('回合开始应共得 2 张牌（触动摸1+生长1），实际 ' + gu.hand.length);
      if (!gu.hand.some(c => shroomIds.includes(c.defId))) throw new Error('蘑菇生长应生成蘑菇牌');
      // 2) 金针菇诅咒：锦囊指定蘑菇为目标 → 使用者手牌被塞入金针菇
      await g13.emit('becomeTarget', { user: jia, target: gu, card: { defId: 'juedou', suit: '♠', number: 6 } });
      if (jia.hand.filter(c => c.defId === 'jinzhengu').length !== 1) throw new Error('被锦囊指定应塞入一张金针菇');
      // 3) 金针菇不可被选中：askCard 过滤后只能拿到普通牌
      jia.hand.push({ defId: 'shan', suit: '♦', number: 2 });
      const pick13 = await g13.askCard(jia, { filter: () => true, tag: '技能', hint: '' });
      if (!pick13 || pick13.defId !== 'shan') throw new Error('askCard 应过滤金针菇');
      // 4) 三个自己的回合后自动移出
      g13.tickCurse(jia); g13.tickCurse(jia);
      if (!jia.hand.some(c => c.defId === 'jinzhengu')) throw new Error('金针菇不应提前消失');
      if (g13.tickCurse(jia) !== 1 || jia.hand.some(c => c.defId === 'jinzhengu')) throw new Error('金针菇应于第3回合移出');
      // 5) 一起上厕所：不可选蘑菇；被选中者金针菇立即移出
      jia.hand.push({ defId: 'jinzhengu', suit: '♠', number: 3 });
      yi.skillIds = ['sk_toilet']; yi.turn = { shaUsed: 0, wine: false, skipPlay: false, skillUsed: false };
      const okToilet = await QYS.data.skills.sk_toilet.exec(g13, yi);
      if (!okToilet || g13.toilet.b !== jia) throw new Error('一起上厕所应跳过蘑菇选下一名角色');
      if (jia.hand.some(c => c.defId === 'jinzhengu')) throw new Error('被上厕所选中应立即移出金针菇');
      g13.toilet = null; yi.skillIds = [];
      // 6) 魅惑菇：目标无法将使用者选为杀目标
      g13.players.forEach(q => { q.hand.length = 0; });
      const mehuo = QYS.data.cards.find(c => c.id === 'mehuogu');
      await mehuo.effect(g13, { user: jia, targets: [yi], card: { defId: 'mehuogu', suit: '♠', number: 5 } });
      if (yi.charmFrom !== jia) throw new Error('魅惑菇应施加魅惑标记');
      const shaDef13 = QYS.data.cards.find(c => c.id === 'sha');
      const cands13 = shaDef13.target.candidates(g13, yi);
      if (cands13.includes(jia)) throw new Error('被魅惑者不应可选使用者作为杀目标');
      if (!cands13.includes(bing)) throw new Error('其他角色应仍可选');
      yi.charmFrom = null;
      // 7) 毁灭菇：前后邻座+自己各3伤；蘑菇免疫
      g13.players.forEach(q => { q.hand.length = 0; q.hp = q.maxHp; });
      const huimie = QYS.data.cards.find(c => c.id === 'huimiegu');
      await huimie.effect(g13, { user: jia, targets: [], card: { defId: 'huimiegu', suit: '♠', number: 7 } });
      if (gu.hp !== gu.maxHp) throw new Error('蘑菇应免疫毁灭菇');
      if (yi.hp !== yi.maxHp - 3 || jia.hp !== jia.maxHp - 3) throw new Error('邻座与使用者应各受3点伤害');
      if (bing.hp !== bing.maxHp || ding.hp !== ding.maxHp) throw new Error('非相邻者不应受伤');
      // 8) 杏鲍菇：自己回复2点
      gu.hp = 2;
      const xingbao = QYS.data.cards.find(c => c.id === 'xingbaogu');
      await xingbao.effect(g13, { user: gu, targets: [gu], card: { defId: 'xingbaogu', suit: '♥', number: 3 } });
      if (gu.hp !== 4) throw new Error('杏鲍菇应回复2点体力，实际 ' + gu.hp);
      // 9) 猴头菇：选类型抽牌，翻过的牌压回堆底
      const seq13 = [
        { defId: 'ma_atk', suit: '♣', number: 9 },  // 装备（非目标，压底）
        { defId: 'sha', suit: '♠', number: 7 },     // 基本（命中）
      ];
      const realDraw13 = g13.drawCard;
      g13.drawCard = () => seq13.shift() || null;
      gu.hand.length = 0;
      const houtou = QYS.data.cards.find(c => c.id === 'houtougu');
      await houtou.effect(g13, { user: gu, targets: [gu], card: { defId: 'houtougu', suit: '♣', number: 4 } });
      g13.drawCard = realDraw13;
      if (!gu.hand.some(c => c.defId === 'sha')) throw new Error('猴头菇应抽到所选基本牌');
      if (g13.deck[0]?.defId !== 'ma_atk') throw new Error('翻过的非目标牌应压回堆底');
      // 10) 似乎有些触动：弃置一名角色的一张牌
      g13.players.forEach(q => { q.hand.length = 0; });
      jia.hand.push({ defId: 'shan', suit: '♦', number: 5 });
      await QYS.data.skills.sk_chudong.hooks.turnStart(g13, gu, { player: gu });
      if (jia.hand.length !== 0) throw new Error('似乎有些触动应弃置目标一张牌');
      // 11) 隐身不阻挡对自己使用杏鲍菇
      yi.skillIds = ['sk_yinshen']; // yi 在步骤7中已受伤，满足 canUse
      const info13 = QYS.rules.playInfo(g13, yi, { defId: 'xingbaogu', suit: '♠', number: 4 });
      if (!info13.ok || !info13.targets.includes(yi)) throw new Error('隐身角色应可对自己使用杏鲍菇');
      yi.skillIds = [];
      console.log('蘑菇检查 ✓（生长/诅咒塞入·不可选·到期·上厕所移出/魅惑禁攻/毁灭免疫/杏鲍菇回2/猴头菇抽类型/触动弃牌）');
    }

    // 装备扩展检查：兵粮寸断/仁王盾/藤甲/白银狮子/护心镜/青釭剑/古锭刀/贯石斧/方天画戟/麒麟弓
    {
      const mkIo14 = () => ({
        async chooseCard(p, o) { return p.hand.find(c => (o.filter ? o.filter(c) : true)) || null; },
        async chooseBool() { return true; },
        async chooseTargets(p, o) { return o.candidates.slice(0, o.max || 1); },
        async askPlay() { return { type: 'end' }; }, log() {}, update() {},
      });
      const g14 = QYS.core.createGame({ playerCount: 5, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙', '丁', '戊'], ioFor: () => mkIo14() });
      const [jia, yi, bing] = g14.players;
      g14.players.forEach(q => { q.skillIds = []; q.hand.length = 0; });
      const shaDef14 = QYS.data.cards.find(c => c.id === 'sha');
      const useSha14 = async (user, tgt, card) => {
        user.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
        await shaDef14.effect(g14, { user, targets: [tgt], card });
      };
      // 仁王盾：黑杀无效、红杀命中
      yi.equips.armor = { defId: 'renwang', suit: '♣', number: 2 };
      await useSha14(jia, yi, { defId: 'sha', suit: '♠', number: 7 });
      if (yi.hp !== yi.maxHp) throw new Error('仁王盾应令黑色杀无效');
      await useSha14(jia, yi, { defId: 'sha', suit: '♥', number: 7 });
      if (yi.hp !== yi.maxHp - 1) throw new Error('红杀应正常命中仁王盾');
      jia.equips.weapon = { defId: 'qinggangjian', suit: '♠', number: 6 };
      yi.hp = yi.maxHp;
      await useSha14(jia, yi, { defId: 'sha', suit: '♠', number: 8 });
      if (yi.hp !== yi.maxHp - 1) throw new Error('青釭剑应无视仁王盾');
      jia.equips.weapon = null;
      // 藤甲：杀与南蛮无效、青釭剑穿透
      yi.equips.armor = { defId: 'tengjia', suit: '♣', number: 2 };
      yi.hp = yi.maxHp;
      await useSha14(jia, yi, { defId: 'sha', suit: '♥', number: 5 });
      if (yi.hp !== yi.maxHp) throw new Error('藤甲应令杀无效');
      const nanman14 = QYS.data.cards.find(c => c.id === 'nanman');
      await nanman14.effect(g14, { user: jia, targets: [], card: { defId: 'nanman', suit: '♠', number: 7 } });
      if (yi.hp !== yi.maxHp) throw new Error('藤甲应令南蛮无效');
      if (bing.hp !== bing.maxHp - 1) throw new Error('南蛮对无藤甲目标应造成伤害');
      jia.equips.weapon = { defId: 'qinggangjian', suit: '♠', number: 6 };
      await useSha14(jia, yi, { defId: 'sha', suit: '♥', number: 6 });
      if (yi.hp !== yi.maxHp - 1) throw new Error('青釭剑应穿透藤甲');
      jia.equips.weapon = null;
      // 白银狮子：3伤限1、失去回血
      yi.equips.armor = { defId: 'baiyinshizi', suit: '♣', number: 5 };
      yi.hp = yi.maxHp;
      await g14.damage({ source: jia, target: yi, amount: 3, tag: '毁灭菇' });
      if (yi.hp !== yi.maxHp - 1) throw new Error('白银狮子应将伤害限为1');
      yi.hp = 1;
      g14.removeZoneCard(yi, { zone: 'equip', slot: 'armor' });
      if (yi.hp !== 2 || yi.equips.armor !== null) throw new Error('失去白银狮子应回复1点体力');
      // 护心镜：致命免伤、非致命不触发
      yi.equips.armor = { defId: 'huxinjing', suit: '♠', number: 1 };
      yi.hp = 1;
      await g14.damage({ source: jia, target: yi, amount: 2, tag: '杀' });
      if (yi.hp !== 1 || yi.equips.armor !== null) throw new Error('护心镜应防止致命伤害并弃置自身');
      yi.hp = 4;
      yi.equips.armor = { defId: 'huxinjing', suit: '♠', number: 2 };
      await g14.damage({ source: jia, target: yi, amount: 1, tag: '杀' });
      if (yi.hp !== 3 || yi.equips.armor === null) throw new Error('非致命伤害不应触发护心镜');
      yi.equips.armor = null;
      // 古锭刀：已受伤目标伤害+1
      jia.equips.weapon = { defId: 'gudingdao', suit: '♠', number: 3 };
      yi.hp = 3;
      await useSha14(jia, yi, { defId: 'sha', suit: '♥', number: 4 });
      if (yi.hp !== 1) throw new Error('古锭刀对已受伤目标应伤害+1');
      jia.equips.weapon = null;
      // 贯石斧：被闪后弃两张手牌强命
      jia.equips.weapon = { defId: 'guanshifu', suit: '♠', number: 4 };
      jia.hand.push({ defId: 'tao', suit: '♥', number: 8 }, { defId: 'tao', suit: '♥', number: 9 }); // 供斧弃置
      yi.hand.push({ defId: 'shan', suit: '♦', number: 2 });
      yi.hp = 4;
      await useSha14(jia, yi, { defId: 'sha', suit: '♥', number: 8 });
      if (yi.hp !== 3) throw new Error('贯石斧弃两张应令杀依然生效');
      if (jia.hand.length !== 0) throw new Error('贯石斧应弃置两张手牌');
      jia.equips.weapon = null;
      // 方天画戟：最后手牌的杀至多3目标，多目标各自结算
      jia.equips.weapon = { defId: 'fangtian', suit: '♠', number: 5 };
      jia.hand.push({ defId: 'sha', suit: '♥', number: 3 });
      if (shaDef14.target.max(g14, jia) !== 3) throw new Error('方天画戟最后手牌杀应可指定3目标');
      jia.hand.push({ defId: 'shan', suit: '♦', number: 3 });
      if (shaDef14.target.max(g14, jia) !== 1) throw new Error('非最后手牌不应触发方天画戟');
      jia.hand.length = 0; jia.hand.push({ defId: 'sha', suit: '♥', number: 3 });
      yi.hp = 4; bing.hp = 4; yi.hand.length = 0; bing.hand.length = 0;
      jia.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
      await shaDef14.effect(g14, { user: jia, targets: [yi, bing], card: { defId: 'sha', suit: '♥', number: 3 } });
      if (yi.hp !== 3 || bing.hp !== 3) throw new Error('方天画戟多目标应各自结算');
      jia.equips.weapon = null;
      // 麒麟弓：命中后弃目标坐骑
      jia.equips.weapon = { defId: 'qilingong', suit: '♠', number: 5 };
      yi.equips.horsePlus = { defId: 'ma_def', suit: '♥', number: 3 };
      yi.hp = 4; yi.hand.length = 0;
      await useSha14(jia, yi, { defId: 'sha', suit: '♥', number: 2 });
      if (yi.equips.horsePlus !== null) throw new Error('麒麟弓应弃置目标坐骑');
      jia.equips.weapon = null;
      // 兵粮寸断：距离1候选 + 非♣判定跳摸牌
      const bl14 = QYS.data.cards.find(c => c.id === 'bingliang');
      const blInfo = QYS.rules.playInfo(g14, jia, { defId: 'bingliang', suit: '♠', number: 4 });
      if (blInfo.targets.includes(bing) || !blInfo.targets.includes(yi)) throw new Error('兵粮寸断候选应为距离1以内角色');
      yi.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
      await bl14.onJudge(g14, yi, { suit: '♥', number: 5 });
      if (!yi.turn.skipDraw) throw new Error('非♣判定应跳过摸牌阶段');
      yi.turn.skipDraw = false;
      await bl14.onJudge(g14, yi, { suit: '♣', number: 5 });
      if (yi.turn.skipDraw) throw new Error('♣判定不应跳过摸牌阶段');
      console.log('装备扩展检查 ✓（兵粮寸断/仁王盾/藤甲/白银狮子/护心镜/青釭剑/古锭刀/贯石斧/方天画戟/麒麟弓）');
    }

    // 酒杀检查：酒+1只作用于下一张杀（命中与否均消耗），不叠加、不跨回合残留
    {
      const g15 = QYS.core.createGame({ playerCount: 3, humanSeat: null, lordSeat: 0, names: ['甲', '乙', '丙'], ioFor: () => ({ async chooseCard() { return null; }, async chooseBool() { return false; }, async chooseTargets(p, o) { return o.candidates.slice(0, o.max || 1); }, async askPlay() { return { type: 'end' }; }, log() {}, update() {} }) });
      const [jia, yi] = g15.players;
      jia.skillIds = []; yi.skillIds = [];
      jia.hand.length = 0; yi.hand.length = 0; // 靶子无闪
      const sha15 = QYS.data.cards.find(c => c.id === 'sha');
      jia.turn = { shaUsed: 0, wine: true, skipPlay: false, skipDraw: false, skillUsed: false }; // 已喝酒
      await sha15.effect(g15, { user: jia, targets: [yi], card: { defId: 'sha', suit: '♠', number: 7 } });
      if (yi.hp !== yi.maxHp - 2) throw new Error('酒杀应造成2点伤害，实际 ' + (yi.maxHp - yi.hp));
      if (jia.turn.wine !== false) throw new Error('酒应在下一张杀后消耗');
      await sha15.effect(g15, { user: jia, targets: [yi], card: { defId: 'sha', suit: '♠', number: 8 } });
      if (yi.hp !== yi.maxHp - 3) throw new Error('第二张杀应为1点伤害（酒不残留），实际剩 ' + yi.hp);
      // 回合重置：turn() 每回合重建 p.turn（wine:false），此处验证新回合对象默认无酒
      jia.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
      const jiu15 = QYS.data.cards.find(c => c.id === 'jiu');
      if (!jiu15.canUse(g15, jia)) throw new Error('满血未喝酒时应可饮【酒】');
      await jiu15.effect(g15, { user: jia, card: { defId: 'jiu', suit: '♦', number: 9 } });
      if (jia.turn.wine !== true) throw new Error('满血饮酒应置酒标记');
      if (jiu15.canUse(g15, jia)) throw new Error('满血已喝酒不应可再叠加');
      console.log('酒杀检查 ✓（+1只作用下一杀/用后即耗/不可叠加/回合重置）');
    }
  }
})().catch(e => { console.error('模拟失败：', e); process.exit(1); });
