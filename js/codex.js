// 群友杀 - 图鉴：从数据文件自动生成武将与卡牌总览（数据更新后刷新页面即同步）
globalThis.QYS = globalThis.QYS || {};
QYS.codex = {};

(function () {
  const TYPE_NAME = { basic: '基本牌', trick: '锦囊', delayed: '延迟锦囊', equip: '装备', curse: '诅咒牌' };
  const TYPE_ORDER = ['basic', 'trick', 'delayed', 'equip', 'curse'];
  const SLOT_NAME = { weapon: '武器', armor: '防具', horsePlus: '+1马', horseMinus: '-1马' };

  let root = null, tab = 'char';

  function ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'codex';
    root.hidden = true;
    root.innerHTML = `
      <div class="codexHead">
        <h2>群友杀 · 图鉴</h2>
        <div class="codexTabs">
          <button class="btn tabBtn" data-tab="char">武 将</button>
          <button class="btn tabBtn" data-tab="card">卡 牌</button>
          <button class="btn tabBtn" data-tab="help">教 程</button>
        </div>
        <button class="btn" id="codexClose">返 回</button>
      </div>
      <div id="codexBody"></div>`;
    document.getElementById('app').appendChild(root);
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; render(); return; }
      if (e.target.closest('#codexClose')) QYS.codex.close();
    });
  }

  function charHtml() {
    return `<div class="codexGrid">` + QYS.data.characters.map(ch => {
      const skills = (ch.skills || []).map(id => QYS.data.skills[id]).filter(Boolean)
        .map(s => `<div class="sk"><b>【${s.name}】</b><i>${s.type === 'active' ? '主动技' : '触发技'}</i>${s.desc || ''}</div>`)
        .join('');
      return `<div class="codexEntry">
        ${QYS.charAvatar(ch, 'codexAvatar')}
        <div class="codexEntryBody">
          <div class="codexName">${ch.name}<span class="codexTitle">${ch.title || ''}</span><span class="chip">体力 ${ch.hp}</span></div>
          ${skills || '<div class="codexNone">暂无技能</div>'}
        </div>
      </div>`;
    }).join('') + `</div>`;
  }

  function cardHtml() {
    return TYPE_ORDER.map(t => {
      const list = QYS.data.cards.filter(d => d.type === t);
      if (!list.length) return '';
      return `<h3 class="codexGroup">${TYPE_NAME[t]}</h3><div class="codexGrid">` + list.map(d => {
        const meta = [];
        if (d.deckCount) meta.push(`×${d.deckCount}`);
        if (t === 'equip' && d.slot) meta.push(SLOT_NAME[d.slot]);
        if (d.range) meta.push(`射程${d.range}`);
        return `<div class="codexEntry codexCardEntry">
          <div class="card codexFace" data-type="${t}" style="font-size:${d.name.length <= 2 ? 19 : d.name.length <= 4 ? 15 : 12}px; letter-spacing:${d.name.length <= 2 ? 4 : d.name.length <= 4 ? 2 : 1}px;">${d.name}<img src="assets/cards/${d.id}.png" alt="" onerror="this.remove()"></div>
          <div class="codexEntryBody">
            <div class="codexName">${d.name}${meta.map(m => `<span class="chip">${m}</span>`).join('')}</div>
            <div class="dDesc">${d.desc || ''}</div>
          </div>
        </div>`;
      }).join('') + `</div>`;
    }).join('');
  }

  // 基础教程（数据驱动，直接改文案即可）
  const HELP = [
    {
      t: '身份与胜利条件',
      items: [
        '<b>2~8 人身份局</b>：主公 / 忠臣 / 反贼 / 内奸，配置随人数变化（牌桌右上角有本局配置）。',
        '开局<b>主公身份公开</b>，其余暗置；角色阵亡时翻开身份。',
        '<b>主公阵亡 → 反贼获胜</b>（若场上只剩一名内奸则内奸获胜）；<b>反贼与内奸全部阵亡 → 主公方获胜</b>。',
        '行动顺序从主公（1 号位）开始，按座位顺时针轮流；玩家编号即按此顺序排。',
      ],
    },
    {
      t: '回合流程',
      items: [
        '每个回合依次经过：<b>准备 → 判定 → 摸牌 → 出牌 → 弃牌 → 结束</b>。',
        '摸牌阶段固定摸 <b>2 张</b>（部分技能会加减速）。',
        '判定阶段结算自己判定区里的延迟锦囊（乐不思蜀 / 兵粮寸断 / 闪电）。',
      ],
    },
    {
      t: '手牌上限跟着血量走',
      items: [
        '弃牌阶段必须把<b>手牌弃到等于当前体力值</b>：上限 = 当前血量，<b>掉血了能留的牌就变少</b>。',
        '例：4 血最多留 4 张手牌；掉到 2 血时最多留 2 张。',
        '技能可以修正上限：小笼包 -1、似乎有些触动 +1 等（见武将图鉴）。',
        '手中的【金针菇】诅咒牌无法弃置，但<b>照常计入上限</b>。',
      ],
    },
    {
      t: '距离与攻击范围',
      items: [
        '座位围成一圈，<b>相邻座位距离 1</b>；有角色阵亡后环会收拢，距离重新计算。',
        '<b>+1马</b>：其他角色算到你的距离 +1（更难打到你）；<b>-1马</b>：你算到别人的距离 -1。',
        '【杀】默认只能指定<b>攻击范围 1</b> 内的目标，武器提供射程（青釭剑 2、麒麟弓 5 等）。',
        '「一起上厕所」等技能会临时改写距离。',
      ],
    },
    {
      t: '出牌常识',
      items: [
        '【杀】每回合限用 <b>1 次</b>（诸葛连弩不限次；灌汤包、太刀黄刃 2 次）。',
        '【酒】：未受伤时喝下，本回合下一张【杀】伤害 +1；已受伤时喝下回复 1 点体力。',
        '装备栏分武器 / 防具 / +1马 / -1马四个栏位，<b>同栏位装新牌会顶掉旧牌</b>。',
        '回合外也可能要出牌：被【杀】出【闪】、决斗 / 南蛮出【杀】、有人濒死出【桃】。',
      ],
    },
    {
      t: '锦囊与无懈可击',
      items: [
        '锦囊牌生效前，任何持有【无懈可击】的人都可以打出它<b>抵消</b>（无懈也可以被无懈抵消）。',
        '延迟锦囊放在目标的<b>判定区</b>：乐不思蜀（黑桃跳过出牌）、兵粮寸断（非♣跳过摸牌）、闪电（黑桃2~9 自伤 3 点，否则传给下家）。',
        '用过的牌进弃牌堆（右下角可展开查看来源）；牌堆抽空时弃牌堆洗回。',
      ],
    },
    {
      t: '濒死、死亡与奖惩',
      items: [
        '体力 ≤ 0 时进入<b>濒死</b>：按座位顺序，任何人都可以对其使用【桃】（+1 体力）。',
        '无人出桃则<b>阵亡</b>：弃掉所有牌、翻开身份。',
        '奖惩：杀死反贼<b>摸 3 张</b>；主公误杀忠臣要<b>弃光所有牌</b>。',
      ],
    },
    {
      t: '联机',
      items: [
        '房主点「创建新房间」得到 4 位房间码，群友凭码加入；房主选人数开局，空位机器人代打。',
        '对局进行中加入为观战；有人掉线其座位立即转机器人代打。',
      ],
    },
  ];

  function helpHtml() {
    return HELP.map(s => `<h3 class="codexGroup">${s.t}</h3><ul class="helpList">${s.items.map(i => `<li>${i}</li>`).join('')}</ul>`).join('');
  }

  function render() {
    root.querySelectorAll('.tabBtn').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const body = document.getElementById('codexBody');
    body.innerHTML = tab === 'char' ? charHtml() : tab === 'card' ? cardHtml() : helpHtml();
    body.scrollTop = 0;
  }

  QYS.codex.open = function (openTab) {
    ensureDom();
    if (openTab) tab = openTab;
    root.hidden = false;
    render();
  };
  QYS.codex.close = function () { if (root) root.hidden = true; };
})();
