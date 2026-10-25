// 群友杀 - 规则层：回合阶段机（准备→判定→摸牌→出牌→弃牌→结束）与出牌结算
globalThis.QYS = globalThis.QYS || {};
QYS.rules = {};

(function () {
  const def = c => QYS.def(c);

  // 某张牌在出牌阶段能否被使用，以及合法目标
  QYS.rules.playInfo = function (game, p, card) {
    const d = def(card);
    if (d.noPlay) return { ok: false, targets: [] };
    if (d.type === 'equip') return { ok: true, targets: [] };
    if (d.type === 'delayed') {
      if (d.id === 'shandian') return { ok: true, targets: [] }; // 闪电放在自己判定区
      const cands = game.othersAlive(p);
      return { ok: cands.length > 0, targets: cands };
    }
    if (d.canUse && !d.canUse(game, p)) return { ok: false, targets: [] };
    const cands = d.target?.candidates ? d.target.candidates(game, p) : [];
    const need = d.target?.count ?? 0;
    return { ok: cands.length >= need, targets: cands };
  };

  function activeSkill(game, p) {
    for (const id of p.skillIds) {
      const sk = QYS.data.skills[id];
      if (sk && sk.type === 'active' && !p.turn.skillUsed && (!sk.canUse || sk.canUse(game, p))) return sk;
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
    if (ok) p.turn.skillUsed = true;
  }

  async function playCard(game, user, card, targets) {
    const d = def(card);
    const i = user.hand.indexOf(card);
    if (i >= 0) user.hand.splice(i, 1);
    game.update();

    if (d.type === 'equip') {
      const old = user.equips[d.slot];
      if (old) game.toDiscard(old, user, '被替换');
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
      const info = QYS.rules.playInfo(game, p, card);
      if (!info.ok) continue;
      let targets = [];
      if (info.targets.length) {
        const sel = await game.askTargets(p, {
          candidates: info.targets, min: 1, max: 1,
          hint: `请为【${def(card).name}】选择目标`,
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
    while (!game.over && p.alive && p.hand.length > p.hp) {
      const c = await game.askCard(p, {
        filter: () => true, tag: '弃牌',
        hint: `弃牌阶段：请弃置手牌（还需 ${p.hand.length - p.hp} 张）`, cancelText: '随机弃一张',
      });
      if (c && p.hand.includes(c)) {
        game.discardFromHand(p, c);
      } else if (p.hand.length > p.hp) {
        const r = p.hand[(Math.random() * p.hand.length) | 0];
        game.discardFromHand(p, r);
        game.log(`${p.name} 随机弃置了${QYS.cardLabel(r)}`, 'system');
      }
      game.update();
    }
  }

  async function turn(game, p) {
    game.turnCount++;
    p.turn = { shaUsed: 0, wine: false, skipPlay: false, skillUsed: false };
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
      else if (ph === '摸牌') await game.drawCards(p, 2);
      else if (ph === '出牌') {
        if (p.turn.skipPlay) game.log(`${p.name} 跳过出牌阶段`, 'system');
        else await playPhase(game, p);
      } else if (ph === '弃牌') await discardPhase(game, p);
      await game.emit('phaseEnd', { player: p, phase: ph });
      game.update();
    }
    game.phase = null;
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
