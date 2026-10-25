// 群友杀 - 规则层：回合阶段机（准备→判定→摸牌→出牌→弃牌→结束）与出牌结算
globalThis.QYS = globalThis.QYS || {};
QYS.rules = {};

(function () {
  const def = c => QYS.def(c);

  // 某张牌在出牌阶段能否被使用，以及合法目标
  QYS.rules.playInfo = function (game, p, card) {
    const d = def(card);
    // 小学生战争：被锁玩家只能使用【杀】（闪本身不可主动使用）
    if (game.isLocked(p) && d.id !== 'sha') return { ok: false, targets: [] };
    if (d.noPlay) return { ok: false, targets: [] };
    // 无膝盖之人：无法装备坐骑
    if (d.type === 'equip' && (d.slot === 'horsePlus' || d.slot === 'horseMinus') && game.hasSkill(p, 'sk_wuxigai'))
      return { ok: false, targets: [] };
    if (d.type === 'equip') return { ok: true, targets: [] };
    if (d.type === 'delayed') {
      if (d.id === 'shandian') return { ok: true, targets: [] };
      // 乐不思蜀默认全场其他角色；兵粮寸断等自带候选（距离限制）
      let cands = d.target?.candidates ? d.target.candidates(game, p) : game.othersAlive(p);
      cands = cands.filter(t => !game.hasSkill(t, 'sk_yinshen'));
      return { ok: cands.length > 0, targets: cands };
    }
    if (d.canUse && !d.canUse(game, p)) return { ok: false, targets: [] };
    let cands = d.target?.candidates ? d.target.candidates(game, p) : [];
    // 隐身：不能被单体锦囊（含乐不思蜀等延迟锦囊）选中为目标；对自己使用的锦囊不受影响
    if ((d.type === 'trick' || d.type === 'delayed') && (d.target?.count ?? 0) === 1)
      cands = cands.filter(t => t === p || !game.hasSkill(t, 'sk_yinshen'));
    const need = d.target?.count ?? 0;
    return { ok: cands.length >= need, targets: cands };
  };

  function activeSkill(game, p) {
    if (game.isLocked(p)) return null; // 小学生战争：主动技封印（被动仍生效）
    for (const id of p.skillIds) {
      const sk = QYS.data.skills[id];
      // freq 未声明或非 oncePerTurn 的主动技不占每回合一次的名额（如 orange 可连续使用）
      const usable = sk.freq === 'oncePerTurn' ? !p.turn.skillUsed : true;
      if (sk && sk.type === 'active' && usable && (!sk.canUse || sk.canUse(game, p))) return sk;
    }
    return null;
  }

  function collectPlayables(game, p) {
    const list = [];
    for (const card of p.hand) {
      const info = QYS.rules.playInfo(game, p, card);
      if (info.ok) list.push({ card, targets: info.targets });
    }
    return list;
  }

  async function useSkill(game, p) {
    const sk = activeSkill(game, p);
    if (!sk) return;
    const ok = await sk.exec(game, p);
    if (ok && sk.freq === 'oncePerTurn') p.turn.skillUsed = true;
  }

  async function playCard(game, user, card, targets) {
    const d = def(card);
    const i = user.hand.indexOf(card);
    if (i >= 0) user.hand.splice(i, 1);
    game.update();

    if (d.type === 'equip') {
      const old = user.equips[d.slot];
      if (old) { game.toDiscard(old, user, '被替换'); game.loseEquip(user, old); }
      user.equips[d.slot] = card;
      game.log(`${user.name} 装备了【${d.name}】`, 'use');
      game.update();
      return;
    }

    for (const t of targets) await game.emit('becomeTarget', { user, target: t, card });
    await game.emit('cardUsed', { user, card, targets });

    if (d.type === 'delayed') {
      await d.effect(game, { user, targets, card }); // 延迟锦囊进入判定区，不进弃牌堆
      game.update();
      return;
    }
    await d.effect(game, { user, targets, card });
    game.toDiscard(card, user, '使用');
    game.update();
  }

  async function playPhase(game, p) {
    while (!game.over && p.alive && !p.turn.skipPlay) {
      const playable = collectPlayables(game, p);
      const sk = activeSkill(game, p);
      game.update();
      const act = await p.io.askPlay(p, {
        playable, canSkill: !!sk, skillName: sk?.name,
        hint: '出牌阶段：点击手牌使用，或结束出牌',
      });
      if (!act || act.type === 'end') break;
      if (act.type === 'skill') { await useSkill(game, p); continue; }

      const card = act.card;
      if (!p.hand.includes(card)) continue;
      // 梯子专家：被盯上的角色本回合使用任意卡牌有一半概率失败（出牌阶段走 askPlay，不经 askCard，需在此判定）
      if (p.ladderFail && Math.random() < 0.5) {
        game.log(`${p.name} 的${QYS.cardLabel(card)}因【梯子专家】造成的网络波动而使用失败`, 'skill');
        game.update();
        continue;
      }
      const info = QYS.rules.playInfo(game, p, card);
      if (!info.ok) continue;
      let targets = [];
      if (info.targets.length) {
        const d = def(card);
        const cnt = d.target?.count ?? 1;
        const maxT = d.target?.max ? d.target.max(game, p, card) : cnt; // 方天画戟：最后一张手牌的杀至多 3 目标
        const sel = await game.askTargets(p, {
          candidates: info.targets, min: cnt, max: maxT,
          hint: maxT > cnt ? `请为【${d.name}】选择目标（可至多 ${maxT} 名）` : `请为【${d.name}】选择目标`,
        });
        if (!sel || !sel.length) continue; // 取消则回到出牌
        targets = sel;
      }
      await playCard(game, p, card, targets);
    }
  }

  async function judgePhase(game, p) {
    const cards = p.judges.splice(0);
    for (const card of cards) {
      if (game.over || !p.alive) { game.toDiscard(card, p, '判定'); continue; }
      const d = def(card);
      game.log(`${p.name} 判定区的【${d.name}】开始判定`, 'system');
      const j = game.judge(p, d.name);
      const dest = d.onJudge ? await d.onJudge(game, p, j, card) : null;
      if (dest === 'pass') {
        const nxt = game.nextAliveOf(p);
        if (nxt && nxt !== p) {
          nxt.judges.push(card);
          game.log(`【${d.name}】移至 ${nxt.name} 的判定区`, 'system');
        } else game.toDiscard(card, p, '判定');
      } else {
        game.toDiscard(card, p, '判定');
      }
      game.update();
    }
  }

  async function discardPhase(game, p) {
    // 小笼包：手牌上限-1（最低 0）；似乎有些触动：手牌上限+1
    let limit = game.hasSkill(p, 'sk_xiaolongbao') ? Math.max(0, p.hp - 1) : p.hp;
    if (game.hasSkill(p, 'sk_chudong')) limit += 1;
    while (!game.over && p.alive && p.hand.length > limit) {
      // 金针菇诅咒无法弃置：只剩诅咒时只能保留超限
      const normal = p.hand.filter(c => c.defId !== 'jinzhengu');
      if (!normal.length) { game.log(`${p.name} 的手牌全是【金针菇】，无法弃置`, 'system'); break; }
      const c = await game.askCard(p, {
        filter: x => x.defId !== 'jinzhengu', tag: '弃牌',
        hint: `弃牌阶段：请弃置手牌（上限 ${limit}，还需 ${p.hand.length - limit} 张；【金针菇】无法弃置）`, cancelText: '随机弃一张',
      });
      if (c && p.hand.includes(c)) {
        game.discardFromHand(p, c);
      } else {
        const r = normal[(Math.random() * normal.length) | 0];
        game.discardFromHand(p, r);
        game.log(`${p.name} 随机弃置了${QYS.cardLabel(r)}`, 'system');
      }
      game.update();
    }
  }

  async function turn(game, p) {
    game.turnCount++;
    p.turn = { shaUsed: 0, wine: false, skipPlay: false, skipDraw: false, skillUsed: false };
    game.tickCurse(p); // 金针菇诅咒：持有者回合开始计数+1，满三个回合自动移出
    game.players.forEach(q => { q.ladderFail = false; }); // 梯子专家标记只在其发动者回合内有效（防发动者中途回合中断导致残留）
    if (game.warLock && game.warLock.a === p) game.warLock = null; // 下一次轮到自己，小学生战争结束（一起上厕所的解除在其技能钩子内）
    game.phase = '回合开始';
    const who = p.seat === game.humanSeat ? '（你）' : '';
    game.log(`── 第 ${game.turnCount} 回合：${p.name}${who} ──`, 'turn');
    await game.emit('turnStart', { player: p });
    game.update();

    for (const ph of ['准备', '判定', '摸牌', '出牌', '弃牌', '结束']) {
      if (game.over || !p.alive) break;
      game.phase = ph;
      await game.emit('phaseStart', { player: p, phase: ph });
      if (ph === '判定') await judgePhase(game, p);
      else if (ph === '摸牌') {
        if (p.turn.skipDraw) game.log(`${p.name} 跳过摸牌阶段（兵粮寸断）`, 'system');
        else await game.drawCards(p, game.hasSkill(p, 'sk_xiaolongbao') ? 3 : 2);
      }
      else if (ph === '出牌') {
        if (p.turn.skipPlay) game.log(`${p.name} 跳过出牌阶段`, 'system');
        else await playPhase(game, p);
      } else if (ph === '弃牌') await discardPhase(game, p);
      await game.emit('phaseEnd', { player: p, phase: ph });
      game.update();
    }
    game.phase = null;
    if (p.charmFrom) p.charmFrom = null; // 【魅惑菇】：目标回合结束时解除
  }

  QYS.rules.run = async function (game) {
    game.currentIdx = game.lordSeat ?? game.humanSeat ?? 0; // 行动顺序从主公（1号）开始
    game.log('游戏开始，身份分配完毕', 'system');
    game.update();
    while (!game.over) {
      await turn(game, game.players[game.currentIdx]);
      if (game.over) break;
      game.currentIdx = game.nextAliveIdx(game.currentIdx);
      if (game.turnCount > 300) { // TODO(规则): 防呆上限，防引擎死循环
        game.over = true;
        game.winner = '平局';
        game.log('回合数超限，判定为平局', 'system');
        break;
      }
    }
    game.update();
    return game.winner;
  };
})();
