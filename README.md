# 群友杀

以群友为武将的三国杀式网页卡牌游戏（框架演示版）。武将、卡牌全部**数据驱动**，当前均为占位内容——替换文案与图片不需要动引擎代码。

## 运行

- **单机**：直接双击 `index.html`；或 `python -m http.server 8080` 后访问 http://localhost:8080
- **局域网/公网联机**：见下方[公网联机部署](#公网联机部署)

## 公网联机部署

最快方式（不需要买服务器、不需要注册账号，利用 Cloudflare 免费快速隧道）：

1. 下载 [cloudflared Windows 版](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe)，放到 `tools/cloudflared.exe`（`tools/` 已被 gitignore，不入库）
2. 双击 **`start-online.bat`**：它会同时启动游戏服务器（`node server.js 8123`）和公网隧道
3. 隧道窗口会出现一行 `https://xxxx-xxxx.trycloudflare.com`，把它发到群里——群友浏览器打开、点「联机」输昵称进大厅即可；房主（先加入的人）开局，空座位机器人代打

注意：

- 快速隧道**每次重启网址都会变**；要固定网址需注册 Cloudflare 账号建命名隧道（`tools\cloudflared.exe tunnel login` 后按其文档创建并运行），或改用下面的部署平台
- 服务器当前是"单房间、无鉴权"的框架实现：知道网址的人都能进入（对局开始后加入为观战），别用于需要私密性的场景
- 有自己的云服务器：上传代码 → `node server.js 8123` → 安全组放行端口即可，建议用 `pm2 start server.js` 或 systemd 守护；也可推到 Render/Railway/Zeabur 等 Node 托管平台自动部署（启动命令 `node server.js`，平台会给公网域名）

## 玩法

2~8 人身份局：主公 / 忠臣 / 反贼 / 内奸。座位围成一圈，你在 6 点位、下家在右手侧，屏幕相邻即距离 1（受 ±1 马修正）。流程：准备 → 判定 → 摸牌(2) → 出牌 → 弃牌(手牌弃至当前体力) → 结束。主公死亡则反贼（或独存的内奸）获胜；反贼与内奸全灭则主公方获胜。每个玩家右下角的「弃 N」按钮可展开其打出/弃置过的牌（悬浮看来源与效果）。

## 目录结构

```
qunyousha/
├── index.html               # 入口（按依赖顺序加载脚本）
├── server.js                # 联机服务器：静态文件 + WebSocket + 权威引擎
├── css/style.css            # 界面样式
├── js/
│   ├── main.js              # 启动与开始界面
│   ├── net.js               # 联机客户端：快照渲染 + 决策转发
│   ├── codex.js             # 图鉴
│   ├── data/
│   │   ├── characters.js    # ★ 群友武将 + 技能定义（占位，改这里）
│   │   └── cards.js         # ★ 卡牌定义（占位，改这里）
│   ├── engine/
│   │   ├── core.js          # 状态/牌堆/问答/伤害/濒死/胜负/座位快照
│   │   └── rules.js         # 回合阶段机 + 出牌结算
│   └── adapter/
│       ├── bot.js           # 机器人决策（与人类同一问答接口）
│       └── ui.js            # 渲染 + 人类玩家问答
├── test/simulate.js         # Node 全机器人模拟测试
└── assets/
    ├── characters/          # 武将头像：assets/characters/<id>.png
    └── cards/               # 卡面图：assets/cards/<id>.png
```

## 添加群友武将（三步）

1. **头像**：把图片放进 `assets/characters/`，以武将 `id` 命名，如 `qunyou_1.png`（建议 200×200 正方形；缺图时界面自动用名字首字圆徽占位）。
2. **资料**：在 `js/data/characters.js` 的 `QYS.data.characters` 里改/加一条：
   ```js
   { id: 'qunyou_1', name: '群友甲', title: '潜水冠军', hp: 4, skills: ['sk_taigang', 'sk_jichou'] }
   ```
3. **技能**：在 `QYS.data.skills` 里定义技能（两个示例已演示两种类型）：
   ```js
   sk_xxx: {
     name: '技能名', type: 'active',   // active 主动技 | trigger 触发技
     desc: '技能描述',
     canUse(game, p) { ... },          // 主动技：能否发动
     async exec(game, p) { ... },      // 主动技：结算，返回 true 消耗次数
     hooks: { afterDamaged(game, p, payload) { ... } },  // 触发技：钩子
   }
   ```

## 添加卡牌

在 `js/data/cards.js` 的 `QYS.data.cards` 里加一条，牌堆按 `deckCount` 自动展开：

```js
{
  id: 'xinpai', name: '新牌', type: 'trick', deckCount: 4,
  desc: '规则描述（悬停详情展示）',
  target: { count: 1, candidates: (g, u) => g.othersAlive(u) },  // 无目标牌可省略
  canUse: (g, u) => true,                                        // 可省略
  async effect(g, { user, targets, card }) { ... },              // 结算逻辑
  // onJudge(g, p, j, card)  延迟锦囊专用，返回 'pass' 表示移至下家判定区
}
```

- `type`：`basic` 基本牌 / `trick` 锦囊 / `delayed` 延迟锦囊 / `equip` 装备（配 `slot: weapon|armor|horsePlus|horseMinus`，武器可加 `range` 与 `unlimitedSha`）
- `noPlay: true` 表示只能被动打出（如闪、无懈可击）
- 卡面图：`assets/cards/<id>.png`，悬停手牌时展示，缺图自动隐藏

## 技能钩子一览

`turnStart` / `phaseStart` / `phaseEnd` / `beforeDamaged`（可改 `payload.amount`）/ `afterDamaged` / `onDying` / `onDeath` / `cardUsed` / `becomeTarget`

## 测试

```
node test/simulate.js
```

全机器人跑通 5 人局×5 + 2 人局 + 8 人局，全部到达终局即通过。

## 已简化的规则（代码中均标有 `TODO(规则)`）

- 五谷丰登简化为"所有角色各摸一张"（原版为亮牌挑选）
- 青龙偃月刀只有射程 3，无特效
- 无懈可击链上限 3 层，用次数奇偶近似抵消关系
- 主公固定 0 号位；被拆/被偷的手牌随机选定（原版选区域后手牌也随机）
- 死亡奖励只实现"杀反贼摸 3""主公误杀忠臣弃光"
- 机器人不读身份、纯随机攻击目标
- 判定区按放置顺序结算（原版后放置先判定）

## 路线图建议

联机对战（需后端）→ 选将界面 → 更多技能钩子（摸牌阶段/回合结束/装备特效）→ 卡牌图鉴 → 音效与动画。
