// 群友杀 - 武将与技能数据
// 添加新武将：往 QYS.data.characters 里加一条（id 同时是头像文件名 assets/characters/<id>.<avatar|png>）；
// 技能写在 QYS.data.skills 里并填进 skills 数组。字段与钩子说明见 README。
globalThis.QYS = globalThis.QYS || {};
QYS.data = QYS.data || {};

// 技能字段：
// type   active 主动技（出牌阶段可发动，有 canUse/exec）| trigger 触发技（靠 hooks 响应钩子）
// freq   'oncePerTurn' 每回合限一次
// canUse(game, player)  主动技：当前能否发动
// exec(game, player)    主动技：发动结算，返回 true 视为成功（消耗次数），false 视为取消
// hooks                 触发技：{ 钩子名(game, player, payload) }
// 注：一几一几/万人迷这类"响应时改写判定"的技能由 game.dodgeCheck 直接检查（game.hasSkill），
//     不走 hooks，也属于触发技（被动生效，小学生战争锁技期间仍可发动）。
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

  // 【一几一几】：被【杀】指定为目标时（万箭齐发不算），可以将任意一张手牌当作【闪】打出。
  // 实现在 game.dodgeCheck（仅 cause==='sha' 时询问；被【万人迷】选中代打时不触发）。
  sk_yijiyiji: {
    name: '一几一几',
    type: 'trigger',
    desc: '当你被【杀】指定为目标时，你可以将任意一张手牌当作【闪】打出。',
  },

  // 【无膝盖之人】：无法装备坐骑（+1马/-1马对其不可使用）。实现在 rules.js playInfo。
  sk_wuxigai: {
    name: '无膝盖之人',
    type: 'trigger',
    desc: '锁定技。你无法装备坐骑（+1马与-1马均不可装备）。',
  },

  // 【太刀高手】：每使用一次【杀】太刀永久升级：无→白刃（攻击范围+1）→黄刃（每回合两张【杀】）→红刃（【杀】伤害+1）；
  // 以【杀】杀死敌人则跌落一个刃等级。升级实现在 cards.js【杀】效果，范围/上限/掉级在 inShaRange/canUse/shaResolve。
  sk_taidao: {
    name: '太刀高手',
    type: 'trigger',
    desc: '你每使用一次【杀】，太刀永久升级：无→白刃（攻击范围+1）→黄刃（每回合可使用两次【杀】）→红刃（所有【杀】伤害+1）；若你以【杀】杀死一名角色，太刀跌落一个等级。',
  },

  // 【阴暗爬行】：可将【杀】或【桃】当作【闪】使用/打出（被杀指定与万箭齐发场合均可）。实现在 game.dodgeCheck。
  sk_yinpa: {
    name: '阴暗爬行',
    type: 'trigger',
    desc: '你可以将一张【杀】或【桃】当作【闪】使用或打出。',
  },

  // 【蟑螂回魂】：体力归零且无人出【桃】救助时，回复3点体力；每局限一次。实现在 game.dying。
  sk_zhanglang: {
    name: '蟑螂回魂',
    type: 'trigger',
    desc: '锁定技。当你的体力归零且无人出【桃】救助时，你回复3点体力；此技能每局游戏只能触发一次。',
  },

  // 【呜呜呜袜】：受到伤害时，伤害来源二选一：交给魔女一张手牌（无手牌时不可选），或令此伤害无效。
  // 实现在 beforeDamaged 钩子（可改 payload.amount=0 实现伤害无效）。
  sk_wuwuwuwa: {
    name: '呜呜呜袜',
    type: 'trigger',
    desc: '当你受到伤害时，伤害来源须做出选择：1.交给你一张手牌（其没有手牌时不可选择此项）；2.令此伤害无效。',
    hooks: {
      async beforeDamaged(game, p, payload) {
        if (payload.target !== p || payload.amount <= 0) return;
        const src = payload.source;
        if (!src || !src.alive || src === p) return;
        if (src.hand.length && await game.askBool(src, `${p.name} 的【呜呜呜袜】：交给她一张手牌？（拒绝则此伤害无效）`, { tag: '技能' })) {
          const c = await game.askCard(src, { filter: () => true, tag: '弃牌', hint: '【呜呜呜袜】：交给对方一张手牌', cancelText: '随机交一张' });
          const giveables = src.hand.filter(x => x.defId !== 'jinzhengu'); // 金针菇无法交给他人
          const give = c && src.hand.includes(c) ? c : giveables[(Math.random() * giveables.length) | 0];
          if (!give) { // 手牌全是金针菇：无从可交，视为拒绝
            payload.amount = 0;
            game.log(`${p.name} 的【呜呜呜袜】令伤害无效`, 'skill');
          } else {
            src.hand.splice(src.hand.indexOf(give), 1);
            p.hand.push(give);
            game.log(`${src.name} 交给 ${p.name} 一张手牌（呜呜呜袜）`, 'skill');
          }
        } else {
          payload.amount = 0;
          game.log(`${p.name} 的【呜呜呜袜】令伤害无效`, 'skill');
        }
        game.update();
      },
    },
  },

  // 【隐身】：不能被单体锦囊牌（过河拆桥/顺手牵羊/决斗/乐不思蜀等）选中为目标。实现在 rules.js playInfo 候选过滤。
  sk_yinshen: {
    name: '隐身',
    type: 'trigger',
    desc: '锁定技。你不能被单体锦囊牌（如【过河拆桥】【顺手牵羊】【决斗】【乐不思蜀】）选中为目标。',
  },

  // 【香香的】：不能被【凑凑的捣乱狂】选为目标。实现在 sk_daoluan 的候选过滤。
  sk_xiangxiang: {
    name: '香香的',
    type: 'trigger',
    desc: '锁定技。你不能被【凑凑的捣乱狂】选为目标。',
  },

  // 【万人迷】：需要使用/打出【闪】时（含被杀指定、万箭齐发），可选择场上任一其他角色替你打出【闪】；
  // 若其没有【闪】，其失去1点体力（体力流失，非伤害），且你仍需承受本次结算。
  // 实现在 game.dodgeCheck；被选中代打的角色直接被询问【闪】，其一几一几不触发。
  sk_wanrenmi: {
    name: '万人迷',
    type: 'trigger',
    desc: '当你需要使用或打出【闪】时，你可以选择场上任一其他角色替你打出【闪】；若其没有【闪】可打出，其失去1点体力。',
  },

  // 【豆沙包】：主公技。回合开始时可命令一名角色对另一名角色使用一张【杀】（强制执行；目标可闪避）。
  // TODO(规则): 强制使用不检查攻击范围（简化）
  sk_doushabao: {
    name: '豆沙包',
    type: 'trigger',
    desc: '主公技。回合开始时，你可以命令一名角色对另一名角色使用一张【杀】（其必须执行；目标可以打出【闪】躲避）。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p || p.identity !== '主') return;
        const cands = game.alive();
        if (cands.length < 2) return;
        if (!(await game.askBool(p, '是否发动【豆沙包】？命令一名角色对另一名角色使用【杀】', { tag: '技能' }))) return;
        const a = await game.askTargets(p, { candidates: cands, min: 1, max: 1, hint: '【豆沙包】：选择执行命令的角色' });
        if (!a || !a.length) return;
        const src = a[0];
        // 魅惑菇：被魅惑者无法对魅惑者出杀，强制命令同样不可指定
        const tCands = game.othersAlive(src).filter(t => src.charmFrom !== t);
        if (!tCands.length) return;
        const b = await game.askTargets(p, { candidates: tCands, min: 1, max: 1, hint: `【豆沙包】：${src.name} 对谁使用【杀】？` });
        if (!b || !b.length) return;
        const tgt = b[0];
        game.log(`${p.name} 发动【豆沙包】，命令 ${src.name} 对 ${tgt.name} 使用【杀】`, 'skill');
        const sha = src.hand.find(c => QYS.isSha(c));
        if (sha) {
          game.discardFromHand(src, sha, '使用');
          game.log(`${src.name} 被迫使用${QYS.cardLabel(sha)}`, 'use');
          await game.emit('becomeTarget', { user: src, target: tgt, card: sha }); // 保卫胡萝卜等"被杀指定"类触发技
          await game.shaResolve(src, tgt, 0);
        } else {
          game.log(`${src.name} 没有【杀】，命令落空`, 'system');
        }
        game.update();
      },
    },
  },

  // 【灌汤包】：每回合可用两张【杀】；场上存在 1 血角色时可无视距离对其出【杀】，命中（未被闪）摸一张牌。
  // 实现在 cards.js 的【杀】（canUse 次数上限 / candidates 距离豁免 / effect 命中摸牌）。
  sk_guantangbao: {
    name: '灌汤包',
    type: 'trigger',
    desc: '你每回合可以使用两张【杀】；若场上存在体力值为1的角色，你可以无视攻击距离对其使用【杀】，此【杀】未被【闪】抵消时，你摸一张牌。',
  },

  // 【小笼包】：手牌上限-1，摸牌阶段摸牌数+1。实现在 rules.js 的摸牌/弃牌阶段。
  sk_xiaolongbao: {
    name: '小笼包',
    type: 'trigger',
    desc: '锁定技。你的手牌上限-1，摸牌阶段摸牌数+1。',
  },

  // 【orange】：每回合开始获得 1 个 orange；抽到【桃】自动弃置并转化为 2 个 orange；
  // 出牌阶段可对任意角色（含自己）使用 orange：1 个回复 1 点体力，可连续使用直到用完。
  // 计数显示在头像下方的橙色徽标；主动使用走技能按钮（freq 不设 oncePerTurn = 不限次）。
  sk_orange: {
    name: 'orange',
    type: 'active',
    desc: '每回合开始时你获得 1 个 orange；你抽到【桃】时自动弃置之并转化为 2 个 orange。出牌阶段你可以使用 orange：令任意角色（包括自己）回复 1 点体力，只要有 orange 就可以继续使用。',
    canUse(game, p) { return p.oranges > 0 && game.alive().some(q => q.hp < q.maxHp); },
    async exec(game, p) {
      const sel = await game.askTargets(p, {
        candidates: game.alive(), min: 1, max: 1,
        hint: '【orange】：选择回复 1 点体力的目标（可含自己）',
      });
      if (!sel || !sel.length) return false;
      p.oranges--;
      game.log(`${p.name} 使用了 1 个 orange（剩 ${p.oranges}）`, 'skill');
      await game.heal(sel[0], 1, p);
      return true;
    },
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        p.oranges = (p.oranges || 0) + 1;
        game.log(`${p.name} 的【orange】触发，获得 1 个 orange（共 ${p.oranges}）`, 'skill');
      },
    },
  },

  // 【亚撒西】：抽到【杀】时弃置之并改为摸两张，每回合限一次。实现在 game.drawCards。
  sk_yasaxi: {
    name: '亚撒西',
    type: 'trigger',
    desc: '每回合限一次，你抽到【杀】时将之弃置，改为摸两张牌。',
  },

  // 【一起上厕所】：出牌阶段限一次，选择一名其他角色：直到自己的下回合开始，
  // 双方距离互相强制为 1（无视实际环距与坐骑；与其他人距离正常计算）。
  sk_toilet: {
    name: '一起上厕所',
    type: 'active',
    freq: 'oncePerTurn',
    desc: '出牌阶段限一次，你可以选择一名其他角色与你一起上厕所：直到你的下回合开始，你与其的距离互相强制为1（无视实际距离与坐骑，与其他角色的距离仍正常计算）。（不能选择拥有【金针菇】技能的角色；被选中者若有【金针菇】诅咒牌则立即移出）',
    canUse(game, p) {
      return game.othersAlive(p).some(t => !game.hasSkill(t, 'sk_jinzhengu')); // 蘑菇的【金针菇】：不可被选为目标
    },
    async exec(game, p) {
      const sel = await game.askTargets(p, {
        candidates: game.othersAlive(p).filter(t => !game.hasSkill(t, 'sk_jinzhengu')),
        min: 1, max: 1,
        hint: '【一起上厕所】：选择一起上厕所的角色（你们的距离将强制为 1）',
      });
      if (!sel || !sel.length) return false;
      const t = sel[0];
      game.voidAllCurse(t); // 被选中为目标：其手中的【金针菇】立即移出
      game.toilet = { a: p, b: t };
      game.log(`${p.name} 拉着 ${t.name} 一起上厕所！你们二人的距离强制为 1`, 'skill');
      // 上厕所要脱裤子：夺其防具入手（需同时拥有该技能）
      if (game.hasSkill(p, 'sk_tuokuzi') && t.equips.armor) {
        const armor = t.equips.armor;
        t.equips.armor = null;
        game.loseEquip(t, armor); // 白银狮子被夺走时目标回复1点体力
        p.hand.push(armor);
        game.log(`${t.name} 上厕所要脱裤子，【${QYS.def(armor).name}】被 ${p.name} 拿走了`, 'skill');
      }
      game.update();
      return true;
    },
    hooks: {
      // 自己的下回合开始：结束一起上厕所
      async turnStart(game, p, payload) {
        if (payload.player === p && game.toilet && game.toilet.a === p) {
          game.toilet = null;
          game.log('一起上厕所结束，距离恢复正常', 'system');
        }
      },
    },
  },

  // 【狼牙棒】：主公技。你的【杀】伤害+1、攻击范围+1；【诸葛连弩】对你无效。
  // 伤害与连弩封禁实现在 cards.js 的【杀】，攻击范围实现在 game.inShaRange。
  sk_langyabang: {
    name: '狼牙棒',
    type: 'trigger',
    desc: '主公技。你的【杀】伤害+1，攻击范围+1；【诸葛连弩】对你无效。',
  },

  // 【新疆网络】：对你使用的【杀】都有 1/2 概率因"网络波动"自动失效（无需闪避）。实现在 game.shaResolve。
  sk_xinjiangwang: {
    name: '新疆网络',
    type: 'trigger',
    desc: '锁定技。对你使用的【杀】都有二分之一的概率因为「网络波动」而自动失效。',
  },

  // 【梯子专家】：回合开始时选择一名角色，其须选择：交给噜噜打汪一张手牌，
  // 或本回合内使用任意卡牌都有 1/2 概率失败（无手牌只能选后者）。失败判定在 game.askCard。
  sk_ladder: {
    name: '梯子专家',
    type: 'trigger',
    desc: '回合开始时，你可以选择一名角色，该角色须做出选择：交给你一张手牌；或本回合内其使用任意卡牌都有二分之一的概率失败（无手牌则只能选择后者）。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        game.players.forEach(q => { q.ladderFail = false; }); // 清理上一回合残留
        const cands = game.othersAlive(p);
        if (!cands.length) return;
        if (!(await game.askBool(p, '是否发动【梯子专家】？', { tag: '技能' }))) return;
        const sel = await game.askTargets(p, { candidates: cands, min: 1, max: 1, hint: '【梯子专家】：选择本回合盯上的角色' });
        if (!sel || !sel.length) return;
        const t = sel[0];
        if (t.hand.length && await game.askBool(t, `被 ${p.name} 的【梯子专家】盯上：交给他一张手牌？（拒绝则本回合你使用卡牌有一半概率失败）`, { tag: '技能' })) {
          const c = await game.askCard(t, { filter: () => true, tag: '弃牌', hint: `【梯子专家】：交给 ${p.name} 一张手牌`, cancelText: '随机交一张' });
          const giveables = t.hand.filter(x => x.defId !== 'jinzhengu'); // 金针菇无法交给他人
          const give = c && t.hand.includes(c) ? c : giveables[(Math.random() * giveables.length) | 0];
          if (give) {
            t.hand.splice(t.hand.indexOf(give), 1);
            p.hand.push(give);
            game.log(`${t.name} 交给了 ${p.name} 一张手牌`, 'skill');
          } else { // 手牌全是金针菇：交不出，只能被盯上
            t.ladderFail = true;
            game.log(`${t.name} 无牌可交，本回合使用卡牌有一半概率失败（${p.name} 的【梯子专家】）`, 'skill');
          }
        } else {
          t.ladderFail = true;
          game.log(`${t.name} 本回合使用卡牌有一半概率失败（${p.name} 的【梯子专家】）`, 'skill');
        }
        game.update();
      },
      async phaseEnd(game, p, payload) {
        if (payload.player === p && payload.phase === '结束') game.players.forEach(q => { q.ladderFail = false; });
      },
    },
  },

  // 【上厕所要脱裤子】：与【一起上厕所】联动：一起上厕所的对象其装备栏中的防具放入你的手牌（坐骑和武器不算防具）。
  sk_tuokuzi: {
    name: '上厕所要脱裤子',
    type: 'trigger',
    desc: '被你用【一起上厕所】选中的对象，其装备栏中的防具将放入你的手牌中（坐骑和武器不是防具）。',
  },

  // 【凑凑的捣乱狂】：回合开始时，可将任意两名角色（含自己）的手牌全部洗混后随机分配回两人。
  sk_daoluan: {
    name: '凑凑的捣乱狂',
    type: 'trigger',
    desc: '回合开始时，你可以选择任意两名角色（包括自己），将两人的所有手牌洗混后随机分配回这两个人手中。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        // 香香的：不能被凑凑的捣乱狂选为目标
        const cands = game.alive().filter(q => !game.hasSkill(q, 'sk_xiangxiang'));
        if (cands.length < 2) return;
        if (!(await game.askBool(p, '是否发动【凑凑的捣乱狂】？将两名角色的手牌洗混随机分配', { tag: '技能' }))) return;
        const sel = await game.askTargets(p, { candidates: cands, min: 2, max: 2, hint: '【凑凑的捣乱狂】：选择两名角色（可含自己）' });
        if (!sel || sel.length !== 2) return;
        const [x, y] = sel;
        const pool = [...x.hand.splice(0), ...y.hand.splice(0)];
        QYS.util.shuffle(pool);
        for (const c of pool) (Math.random() < 0.5 ? x : y).hand.push(c);
        game.log(`${p.name} 发动【凑凑的捣乱狂】，${x.name} 与 ${y.name} 的手牌被洗混随机分配`, 'skill');
        game.update();
      },
    },
  },

  // 【蘑菇生长】：回合开始时随机生成一张蘑菇牌（金针菇除外）加入手牌。
  // 金针菇不进牌堆；其余蘑菇牌也在初始牌堆中各有一定数量。
  sk_mogushengzhang: {
    name: '蘑菇生长',
    type: 'trigger',
    desc: '回合开始时，你随机生成一张蘑菇牌（魅惑菇/毁灭菇/杏鲍菇/猴头菇）加入手牌。（【金针菇】不进入牌堆；其余蘑菇牌亦在牌堆中各有一定数量）',
    hooks: {
      turnStart(game, p, payload) {
        if (payload.player !== p) return;
        const pool = ['mehuogu', 'huimiegu', 'xingbaogu', 'houtougu'];
        const c = {
          defId: pool[(Math.random() * pool.length) | 0],
          suit: ['♠', '♥', '♣', '♦'][(Math.random() * 4) | 0],
          number: 1 + ((Math.random() * 13) | 0),
        };
        p.hand.push(c);
        game.log(`${p.name} 的【蘑菇生长】：长出了一株${QYS.cardLabel(c)}`, 'skill');
        game.update();
      },
    },
  },

  // 【似乎有些触动】：手牌上限+1（实现在 rules.js 弃牌阶段）；回合开始时二选一：弃一名角色一张牌 / 额外摸一张。
  sk_chudong: {
    name: '似乎有些触动',
    type: 'trigger',
    desc: '锁定技。你的手牌上限+1。回合开始时，你须选择一项：1.弃置一名角色区域里的一张牌；2.额外摸一张牌。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        const cands = game.alive().filter(q => game.anyCards(q));
        const useDiscard = cands.length > 0
          && await game.askBool(p, '是否发动【似乎有些触动】？【确定】弃置一名角色的一张牌；【放弃】改为额外摸一张牌', { tag: '技能' });
        if (useDiscard) {
          const sel = await game.askTargets(p, { candidates: cands, min: 1, max: 1, hint: '【似乎有些触动】：选择要弃牌的角色' });
          const t = sel && sel[0];
          if (t) {
            const pick = game.randomZoneCard(t);
            if (pick) {
              game.removeZoneCard(t, pick);
              game.toDiscard(pick.card, p, '弃置');
              game.log(`${p.name} 发动【似乎有些触动】，弃置了 ${t.name} 区域的${QYS.cardLabel(pick.card)}`, 'skill');
              game.update();
              return;
            }
          }
        }
        await game.drawCards(p, 1);
        game.log(`${p.name} 的【似乎有些触动】：额外摸了一张牌`, 'skill');
      },
    },
  },

  // 【金针菇】：不可被【一起上厕所】选为目标（实现在 sk_toilet）；被锦囊牌指定为目标时，
  // 往使用者手牌塞入一张【金针菇】诅咒牌（生命周期见 core.js tickCurse/voidAllCurse）。
  sk_jinzhengu: {
    name: '金针菇',
    type: 'trigger',
    desc: '锁定技。你不能被【一起上厕所】选为目标。当你被锦囊牌指定为目标时，将一张【金针菇】置入该牌使用者的手牌：其无法使用、打出或弃置这张牌，该牌计入其手牌上限，经过其三个回合后移出游戏；若其被【一起上厕所】选为目标，该牌立即移出。',
    hooks: {
      async becomeTarget(game, p, payload) {
        if (payload.target !== p || !payload.card) return;
        const d = QYS.def(payload.card);
        if (d.type !== 'trick' && d.type !== 'delayed') return;
        const src = payload.user;
        if (!src || !src.alive || src === p) return;
        src.hand.push({ defId: 'jinzhengu', suit: '♠', number: 1 + ((Math.random() * 13) | 0) });
        game.log(`${p.name} 的【金针菇】诅咒生效：${src.name} 的手牌中被塞入一株【金针菇】`, 'skill');
        game.update();
      },
    },
  },

  // 【大狗叫】：抽到的【杀】自动转换为【大狗叫】
  sk_dagoujiao: {
    name: '大狗叫',
    type: 'trigger',
    desc: '抽到的【杀】自动转换为【大狗叫】',
  },

  // 【遛狗去咯】：主动技。出牌阶段选择一名其他角色：本回合内你与该角色都无法被任何卡牌或技能选为目标。
  // 保护过滤实现在 core.js askTargets（所有选人问答的必经之路）；冷却在 turnStart 递减。
  sk_liugou: {
    name: '遛狗去咯',
    type: 'active',
    freq: 'oncePerTurn',
    desc: '出牌阶段限一次，你可以选择一名其他角色：直到本回合结束，你与该角色都无法被任何卡牌或技能选为目标。发动后冷却两回合。',
    canUse(game, p) {
      return !game.liugou && (p.liugouCd || 0) === 0 && game.othersAlive(p).length > 0;
    },
    async exec(game, p) {
      const sel = await game.askTargets(p, {
        candidates: game.othersAlive(p), min: 1, max: 1,
        hint: '【遛狗去咯】：选择一起遛狗的角色（本回合内你们二人都不可被选中）',
      });
      if (!sel || !sel.length) return false;
      game.liugou = { a: p, b: sel[0] };
      p.liugouCd = 2;
      game.log(`${p.name} 拉着 ${sel[0].name} 遛狗去咯！本回合内你们二人都不可被选中`, 'skill');
      game.update();
      return true;
    },
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player === p && p.liugouCd > 0) p.liugouCd--;
      },
    },
  },

  // 【涩苹果】：每回合开始时二选一：额外摸一张牌；或放弃本回合摸牌阶段，改为从两名其他角色处各拿取一张牌。
  sk_sepingguo: {
    name: '涩苹果',
    type: 'trigger',
    desc: '锁定技。每回合开始时，你须选择一项：1.额外摸一张牌；2.放弃本回合的摸牌阶段，改为选择两名其他角色，各拿取其区域里的一张牌。',
    hooks: {
      async turnStart(game, p, payload) {
        if (payload.player !== p) return;
        const extra = await game.askBool(p, '【涩苹果】：【确定】额外摸一张牌；【放弃】改为放弃本回合摸牌，从两名其他角色处各拿取一张牌', { tag: '技能' });
        if (extra) { await game.drawCards(p, 1); return; }
        p.turn.skipDraw = true;
        const cands = game.othersAlive(p).filter(t => game.anyCards(t));
        if (!cands.length) { game.log(`${p.name} 的【涩苹果】：场上无牌可拿`, 'system'); return; }
        const sel = await game.askTargets(p, {
          candidates: cands, min: Math.min(2, cands.length), max: 2,
          hint: '【涩苹果】：选择两名角色，各拿取其区域里的一张牌',
        });
        if (!sel || !sel.length) return;
        for (const t of sel) {
          if (!t.alive) continue;
          const pick = game.randomZoneCard(t);
          if (!pick) continue;
          game.removeZoneCard(t, pick);
          p.hand.push(pick.card);
          game.log(`${p.name} 拿取了 ${t.name} 区域的${QYS.cardLabel(pick.card)}`, 'use');
        }
        game.update();
      },
    },
  },

  // 【保卫胡萝卜】：成为【杀】的目标后，本回合内其与所有角色的距离强制为1。实现在 core.js distance。
  sk_baoweihuluobo: {
    name: '保卫胡萝卜',
    type: 'trigger',
    desc: '锁定技。当你成为【杀】（含【大狗叫】）的目标后，直到本回合结束，你与其他所有角色的距离强制为1。',
    hooks: {
      becomeTarget(game, p, payload) {
        if (payload.target !== p || !payload.card) return;
        const d = QYS.def(payload.card);
        if (d.id !== 'sha' && d.id !== 'dagoujiao') return;
        if (p.distGuardTurn === game.turnCount) return; // 本回合只标记一次
        p.distGuardTurn = game.turnCount;
        game.log(`${p.name} 的【保卫胡萝卜】触发：直到本回合结束，其与所有角色的距离强制为1`, 'skill');
        game.update();
      },
    },
  },

  // 【凑鸽子】：使用【闪】令【杀】无效后抽一张牌。实现在 core.js dodgeCheck。
  sk_cougezi: {
    name: '凑鸽子',
    type: 'trigger',
    desc: '当你使用【闪】令一张【杀】对你无效后，你摸一张牌。',
  },

  // 【凑凑的】：不能装备防具，但可以装备两个坐骑。
  // 防具禁用实现在 rules.js playInfo；第二坐骑栏实现在 rules.js playCard 与 core.js distance。
  sk_coucoude: {
    name: '凑凑的',
    type: 'trigger',
    desc: '锁定技。你不能装备防具；你的防具栏改为第二个坐骑栏，可以同时装备两个坐骑（如两张+1马）。',
  },

  // 【大剑虾】：回合开始摸牌阶段，摸到的牌中没有杀（含大狗叫）→ 额外摸一张。实现在 rules.js 摸牌阶段。
  sk_dajianxia: {
    name: '大剑虾',
    type: 'trigger',
    desc: '锁定技。每回合开始的摸牌阶段，若你摸到的牌中没有【杀】（含【大狗叫】），你额外摸一张牌。',
  },

  // 【真蓄斩】：回合结束时若本回合未使用过杀 → 蓄力+1（头像旁 ⚡ 徽标）；
  // 下一次杀消耗全部蓄力，每格威力+1；威力+3（即4点伤害）时此杀不能被无效/闪。
  // 释放实现在 cards.js 的【杀】/【大狗叫】与 sk_xiangsha 反击；无效豁免实现在 core.js shaResolve（opts.undodgeable）。
  sk_zhenxuzhan: {
    name: '真蓄斩',
    type: 'trigger',
    desc: '锁定技。回合结束时，若你本回合内没有使用过【杀】，你获得1格蓄力值。你下次使用【杀】时消耗全部蓄力值：每格使此【杀】威力+1；当威力达到+3（即4点伤害）时，此【杀】不能被【闪】避或无效。',
    hooks: {
      phaseEnd(game, p, payload) {
        if (payload.player !== p || payload.phase !== '结束' || !p.alive) return;
        const hasDajian = p.equips.weapon && QYS.def(p.equips.weapon).id === 'dajian';
        const usedSha = p.turn && (p.turn.shaUsed > 0 || p.turn.counterSha);
        const reasons = [];
        if (!usedSha) { p.charge++; reasons.push('真蓄斩'); }       // 本回合未用杀：真蓄斩蓄力+1
        if (hasDajian) { p.charge++; reasons.push('大剑'); }        // 大剑：每回合蓄力+1，无视用杀
        if (!reasons.length) return;
        game.log(`【${reasons.join('】【')}】${p.name} 蓄力 +${reasons.length}（共 ${p.charge} 格）`, 'skill');
        game.update();
      },
    },
  },

  // 【相杀】：每回合一次，成为杀（含大狗叫）的目标时，可用手中一张杀反制：
  // 无效对方的杀，并对使用者正常结算一次反击（反击伤害附加蓄力加成，满蓄同样无法被闪避）。
  // 无效标记在 core.js shaResolve 顶部消费（target.shaCounter）。
  sk_xiangsha: {
    name: '相杀',
    type: 'trigger',
    desc: '每回合限一次，当你成为【杀】（含【大狗叫】）的目标时，你可以使用手中的一张【杀】：无效此【杀】，并立即对其使用者正常结算一次【杀】（反击伤害附加【真蓄斩】蓄力加成）。',
    hooks: {
      async becomeTarget(game, p, payload) {
        if (payload.target !== p || !payload.card || !p.alive) return;
        const d = QYS.def(payload.card);
        if (!QYS.isSha(payload.card)) return;
        if (p.xiangshaTurn === game.turnCount) return; // 每回合一次
        const src = payload.user;
        if (!src || !src.alive || src === p) return;
        if (!p.hand.some(c => QYS.isSha(c))) return;
        if (!(await game.askBool(p, `是否发动【相杀】？用一张【杀】无效 ${src.name} 的${QYS.cardLabel(payload.card)}，并对其反击`, { tag: '技能' }))) return;
        const counter = p.hand.find(c => QYS.isSha(c)); // 询问后重取（手中牌可能已变）
        if (!counter) return;
        p.xiangshaTurn = game.turnCount;
        if (p.turn) p.turn.counterSha = true; // 真蓄斩：本回合已使用过杀，不再蓄力（首回合前 p.turn 为空，无从蓄力）
        game.discardFromHand(p, counter, '使用');
        game.log(`${p.name} 发动【相杀】，以${QYS.cardLabel(counter)}迎击 ${src.name} 的${QYS.cardLabel(payload.card)}`, 'skill');
        p.shaCounter = { vs: src }; // 对方的杀结算到 p 时被无效
        game.update();
        // 反击：正常造成伤害，附加蓄力加成（满蓄同样无法被闪避或无效）
        const bonus = game.consumeCharge(p);
        if (bonus > 0) game.log(`【真蓄斩】${p.name} 的反击释放 ${bonus} 格蓄力，威力+${bonus}${bonus >= 3 ? '（无法被闪避或无效）' : ''}`, 'skill');
        await game.shaResolve(p, src, bonus, counter, { undodgeable: bonus >= 3 });
        game.update();
      },
    },
  },

  // 【焦香酥脆】：被杀命中时伤害来源摸一张、自己生命上限-1。实现在 core.js shaHit（仅杀伤害触发）。
  sk_jiaoxiang: {
    name: '焦香酥脆',
    type: 'trigger',
    desc: '锁定技。当你被【杀】（含【大狗叫】）命中后，伤害来源摸一张牌，你减少1点生命上限。其他类型的伤害不触发此技能。',
  },

  // 【闻着凑吃着香】：以凑鸽子为目标时不限杀次数。实现在 cards.js 的【杀】/【大狗叫】 canUse/candidates。
  sk_wenzhe: {
    name: '闻着凑吃着香',
    type: 'trigger',
    desc: '锁定技。【杀】（含【大狗叫】）以你为目标时不受每回合使用次数限制：任意角色的【杀】次数用尽后，仍可以你为目标使用【杀】（此时【杀】只能指定你为目标）。',
  },

  // 【臭鸡炸炸炸】：游戏开始时生成一张特殊锦囊洗入牌堆（实现在 core.js createGame）；
  // 他人抽到自动放回重抽（实现在 core.js takeDrawnCard）；只有凑鸽子能使用（实现在 rules.js playInfo）。
  sk_chouji: {
    name: '臭鸡炸炸炸',
    type: 'trigger',
    desc: '锁定技。本局游戏开始时，一张【臭鸡炸炸炸】洗入牌堆：只有你能使用它（指定一名其他角色，丢弃其所有【桃】和【酒】并令其生命值归零）；其他角色抽到时会将其放回牌堆并重新抽一张牌。',
  },
};

QYS.data.characters = [
  // TODO: 路人群友为测试用白板武将（人数超出角色池时以其补位，允许重复）
  { id: 'luren', name: '路人群友', title: '路人', hp: 4, skills: [] },
  // avatar: 头像扩展名（assets/characters/<id>.<avatar>），不填默认 png；正确声明可避免 404 探测造成的头像闪烁
  { id: 'hxtyd', name: '好像有一天', title: '谜之群友', hp: 5, avatar: 'jpeg', skills: ['sk_xueshengzhanzheng', 'sk_yinpa', 'sk_zhanglang'] },
  { id: 'hsjjj', name: '花生酱酱酱', title: '群友', hp: 4, skills: ['sk_yijiyiji', 'sk_wuxigai', 'sk_taidao'] },
  { id: 'hhdmw', name: '善良的黄瓜魔女', title: '群友', hp: 4, avatar: 'jpeg', skills: ['sk_wuwuwuwa', 'sk_yinshen', 'sk_xiangxiang'] },
  { id: 'dashen', name: '大神', title: '群友', hp: 5, skills: ['sk_wanrenmi', 'sk_dagoujiao'] },
  { id: 'baozi', name: '包子大王', title: '群友', hp: 4, avatar: 'png', skills: ['sk_doushabao', 'sk_xiaolongbao', 'sk_guantangbao'] },
  { id: 'hua00', name: '00的画', title: '群友', hp: 5, avatar: 'png', skills: ['sk_daoluan'] },
  { id: 'qiuqiu', name: '秋秋人', title: '群友', hp: 4, skills: ['sk_orange', 'sk_yasaxi'] },
  { id: 'yanwenzi', name: '颜文字小变态', title: '群友', hp: 5, skills: ['sk_toilet', 'sk_tuokuzi'] },
  // TODO: 噜噜打汪头像待补 assets/characters/lulu.png（当前显示首字圆徽）
  { id: 'lulu', name: '噜噜打汪', title: '群友', hp: 4, skills: ['sk_langyabang', 'sk_xinjiangwang', 'sk_ladder'] },
  { id: 'mogu', name: '蘑菇', title: '菌菇召唤师', hp: 4, skills: ['sk_chudong', 'sk_jinzhengu', 'sk_mogushengzhang'] },
  { id: 'pgjjj', name: '苹果酱酱酱', title: '群友', hp: 4, skills: ['sk_liugou', 'sk_sepingguo'] },
  { id: 'huluobo', name: '胡萝卜', title: '群友', hp: 4, skills: ['sk_baoweihuluobo', 'sk_cougezi', 'sk_coucoude'] },
  { id: 'sidun', name: '斯坦尊尊', title: '群友', hp: 4, skills: ['sk_dajianxia', 'sk_zhenxuzhan', 'sk_xiangsha'] },
  { id: 'cougezi', name: '凑鸽子', title: '群友', hp: 9, skills: ['sk_jiaoxiang', 'sk_wenzhe', 'sk_chouji'] },
];
