// 群友杀 - 机器人适配器：与人类 UI 走完全相同的问答接口
// TODO(规则): bot 目前不读身份、纯随机选目标；要"会玩"再换成带阵营判断的启发式
globalThis.QYS = globalThis.QYS || {};
QYS.bot = { fast: false }; // fast=true 时关闭思考延迟（Node 模拟测试用）

(function () {
  const wait = async () => { if (!QYS.bot.fast) await QYS.util.sleep(400 + Math.random() * 700); };

  QYS.bot.io = function () {
    return {
      async chooseCard(p, { filter, tag } = {}) {
        await wait();
        const cs = p.hand.filter(filter || (() => true));
        if (!cs.length) return null;
        if (tag === '弃牌') return cs[(Math.random() * cs.length) | 0];
        return cs[0]; // 闪/杀/桃/技能弃牌：出第一张可用的
      },
      async chooseBool(p, { tag } = {}) {
        await wait();
        if (tag === '无懈') return Math.random() < 0.5;
        return true; // 八卦阵等默认发动
      },
      async chooseTargets(p, { candidates } = {}) {
        await wait();
        if (!candidates || !candidates.length) return null;
        return [candidates[(Math.random() * candidates.length) | 0]];
      },
      async askPlay(p, { playable, canSkill } = {}) {
        await wait();
        if (canSkill && Math.random() < 0.5) return { type: 'skill' };
        const find = pred => playable.find(it => pred(QYS.def(it.card)));
        const it = find(d => d.id === 'tao')
          || find(d => d.id === 'wuzhong')
          || find(d => d.type === 'equip')
          || find(d => d.id === 'sha')
          || playable[(Math.random() * playable.length) | 0];
        return it ? { type: 'card', card: it.card } : { type: 'end' };
      },
    };
  };
})();
