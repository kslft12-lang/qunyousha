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

  function render() {
    root.querySelectorAll('.tabBtn').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const body = document.getElementById('codexBody');
    body.innerHTML = tab === 'char' ? charHtml() : cardHtml();
    body.scrollTop = 0;
  }

  QYS.codex.open = function () { ensureDom(); root.hidden = false; render(); };
  QYS.codex.close = function () { if (root) root.hidden = true; };
})();
