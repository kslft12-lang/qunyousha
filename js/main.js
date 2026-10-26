// 群友杀 - 启动：装配界面与引擎，处理开始界面
(function () {
  const $ = s => document.querySelector(s);
  const view = QYS.ui.create($('#gameRoot'));
  let game = null;
  let last = { count: 5, seat: 0, pool: null }; // 上一局设置：终局"继续一局"沿用

  function start(playerCount, humanSeat, charPool) {
    last = { count: playerCount, seat: humanSeat, pool: charPool || null };
    // 抢主公结算：人类勾选则参与，机器人各 50% 概率参抢；抢者随机定主公，无人抢则随机
    let lordSeat;
    if (humanSeat != null && $('#rushLord').checked) {
      const rushers = [humanSeat];
      for (let s = 0; s < playerCount; s++)
        if (s !== humanSeat && Math.random() < 0.5) rushers.push(s);
      lordSeat = rushers[(Math.random() * rushers.length) | 0];
    } else {
      lordSeat = (Math.random() * playerCount) | 0;
    }
    // 昵称：人类用输入框（缺省"你"，过滤 HTML 字符防注入界面），机器人按座位顺序编号
    const nick = ($('#nickName').value || '').replace(/[<>&"']/g, '').trim() || '你';
    const names = [];
    let botSeq = 0;
    for (let s = 0; s < playerCount; s++) names[s] = s === humanSeat ? nick : `机器人${++botSeq}`;
    game = QYS.core.createGame({
      playerCount,
      humanSeat,
      lordSeat,
      names,
      charPool,
      ioFor: p => (p.seat === humanSeat ? view.io : QYS.bot.io()),
    });
    view.attach(game);
    $('#startScreen').hidden = true;

    (async () => {
      if (humanSeat != null) await view.showSplash(game);
      else game.log('全机器人演示开始', 'system');
      await QYS.rules.run(game);
      await view.showGameOver(game, { local: humanSeat != null });
    })().catch(err => {
      console.error(err);
      view.fatal(err);
    });
  }

  // 本地角色池选择器（全不选 = 不限制，默认全员池）
  const localPicker = QYS.ui.buildCharPicker(document.getElementById('charPoolLocal'));

  // 终局双按钮：继续一局沿用上局人数与角色池；回到主页面返回开始界面
  view.onGameOverAction = act => {
    if (act === 'rematch') start(last.count, last.seat, localPicker.getSelected());
    else {
      view.hideGameScreen();
      $('#startScreen').hidden = false;
    }
  };

  $('#btnStart').addEventListener('click', () => start(+$('#playerCount').value, 0, localPicker.getSelected()));
  $('#btnDemo').addEventListener('click', () => start(+$('#playerCount').value, null, localPicker.getSelected()));
  $('#btnOnline').addEventListener('click', () => QYS.net.openLobby(view));
  $('#btnCodex').addEventListener('click', () => QYS.codex.open());
  $('#btnHelp').addEventListener('click', () => QYS.codex.open('help'));
})();
