// 群友杀 - 启动：装配界面与引擎，处理开始界面
(function () {
  const $ = s => document.querySelector(s);
  const view = QYS.ui.create($('#gameRoot'));
  let game = null;

  function start(playerCount, humanSeat) {
    game = QYS.core.createGame({
      playerCount,
      humanSeat,
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
  $('#btnOnline').addEventListener('click', () => QYS.net.connect($('#nickName').value, view));
  $('#btnCodex').addEventListener('click', () => QYS.codex.open());
})();
