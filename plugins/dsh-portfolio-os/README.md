# DSH Portfolio OS

Portfolio OS 的 DSH Desktop 市场插件。安装后会启动随包附带的 Windows Runtime，并在 DSH 内以独立全屏页面打开资产投研平台。

## 使用方式

1. 从 DSH 插件市场安装“资产投研”。
2. 点击 DSH 侧栏的“资产投研”。首次启动会初始化本地 SQLite 数据库。
3. 在右上角“AI API”中配置 Agnes 或其他 OpenAI-compatible API。
4. 在本地注册账号并导入自己的资产备份。

无需 Docker、Python、Node.js 或源代码。数据默认保存在 `%LOCALAPPDATA%\PortfolioOS`，卸载插件不会自动删除用户数据。

## 登录态与嵌入模式

平台的 iframe 与宿主页面跨站，只接受 `SameSite=None; Secure` 的会话 Cookie。插件启动运行时时注入：

```
SESSION_COOKIE_SAMESITE=none
SESSION_COOKIE_SECURE=true
```

等价命令行参数：`--cookie-samesite none --cookie-secure`。

插件会先用 `/api/runtime/capabilities` 检查已在运行的实例：旧版本实例（Lax Cookie）不复用，
改在其它可用端口启动，实际地址由状态接口的 `frontendUrl` 下发。要恢复旧的同站行为：

```yaml
embeddedCookies: false
```

工具栏的「浏览器打开」可在系统浏览器里以第一方身份打开同一地址。

## 运行时的分发方式

- Release 包内置 `vendor/portfolio-os-runtime`。
- 源码（git）安装不含 `vendor/`：插件会查 npm 包 `@snowball-labbot/portfolio-os-win32-x64`（已声明为 optional dependency）。
- 本地开发用下面的 `sourceDir`。

## 开发模式

仓库开发时可在插件配置中增加：

```yaml
sourceDir: D:/path/to/Portfolio-OS-Marketplace
pythonExecutable: D:/path/to/python.exe
```

发布包不使用这些字段。GitHub Release 中的插件包已内置 Windows Runtime，安装后无需再下载后端依赖。

## 从 GitHub Release 安装

```powershell
dsh plugin --profile <你的测试 Profile> add https://github.com/Snowball-labbot/Portfolio-OS/releases/download/v0.2.1/dsh-portfolio-os-0.2.1.tgz
```

建议固定具体版本，不要在正式资产数据上安装未固定的分支快照。
