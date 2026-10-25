// 群友杀 - 启动：装配界面与引擎，处理开始界面
(function () {
  const $ = s => document.querySelector(s);
  const view = QYS.ui.create($('#gameRoot'));
  let game = null;

  function start(playerCount, humanSeat) {
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
    game = QYS.core.createGame({
      playerCount,
      humanSeat,
      lordSeat,
      ioFor: p => (p.seat === humanSeat ? view.io : QYS.bot.io()),
    });
    view.attach(game);
    $('#startScreen').hidden = true;

    (async () => {
      if (humanSeat != null) await view.showSplash(game);
      else game.log('全机器人演示开始', 'system');
      await QYS.rules.run(game);
      await view.showGameOver(game);
    })().catch(err => {
      console.error(err);
      view.fatal(err);
    });
  }

  $('#btnStart').addEventListener('click', () => start(+$('#playerCount').value, 0));
  $('#btnDemo').addEventListener('click', () => start(+$('#playerCount').value, null));
  $('#btnOnline').addEventListener('click', () => QYS.net.openLobby(view));
  $('#btnCodex').addEventListener('click', () => QYS.codex.open());
})();
