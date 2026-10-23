# 开发文档

前端模块划分、测试与发版流程。只想用插件的看 [README.md](README.md)，
版本历史看 [CHANGELOG.md](CHANGELOG.md)。

## API（前端调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/prompt_manager/save` | `{name, text, category}` 保存/覆盖 |
| POST | `/prompt_manager/load` | `{name}` 读取内容 |
| POST | `/prompt_manager/delete` | `{name}` 删除 |
| GET  | `/prompt_manager/list` | 全部名称 |
| GET  | `/prompt_manager/categories` | 分类列表（含数量，按排序返回） |
| POST | `/prompt_manager/categories` | `{name}` 新建分类 |
| POST | `/prompt_manager/categories/rename` | `{old_name, new_name}` 分类改名（提示词自动跟随） |
| POST | `/prompt_manager/categories/delete` | `{name, mode}` 删除分类，mode = `delete_all`（连提示词一起删）/ `keep`（提示词移到「默认」） |
| GET  | `/prompt_manager/all` | 列表弹窗用：名称 + 分类 + 内容预览 + 长度 + 更新时间。可选 `?q=关键字&category=分类&offset=0&limit=300` 做服务端筛选与分页，返回 `{items, total, offset, limit, has_more}`（不带 `limit` 就是取全部） |
| POST | `/prompt_manager/rename` | `{name, new_name}` 提示词改名（重名会被拒绝） |
| POST | `/prompt_manager/move` | `{name, category}` 修改提示词所属分类 |
| GET  | `/prompt_manager/duplicates` | 查重：按内容指纹分组（忽略首尾空白与换行差异），返回重复组 `[{preview, count, items:[{name, category, ...}]}]`；可选 `?q=关键字&offset=0&limit=50` 分页，返回 `{groups, total, offset, limit, has_more}` |
| POST | `/prompt_manager/dedupe` | `{names: [...]}` 批量删除提示词（排重复用），返回 `{deleted}` |
| GET  | `/prompt_manager/export` | 导出 JSON（附件下载） |
| POST | `/prompt_manager/import` | multipart 上传 JSON 导入 |
| GET  | `/prompt_manager/workflow` | 取图片内嵌的工作流（UI graph 格式，可直接 `app.loadGraphData()`），参数同 `/meta` |
| GET  | `/prompt_manager/version` | 插件版本号 |
| GET  | `/prompt_manager/access` | 当前页面是否有写权限：`{local: bool}`，局域网访问时为 false |
| GET  | `/prompt_manager/health` | 自检：库路径 / 大小 / journal 模式 / 备份份数 / 表结构版本 / 完整性检查结果（`quick_check`） |

> `/prompt_manager/` 下的写接口（`load` 除外，它是以 POST 发的只读接口）、`export`、`dirs`
> 以及带自定义路径的图库读，默认只接受本机请求，见下方「局域网访问控制」。

## 开发 / 测试

### 数据库结构迁移

`db.py` 用 SQLite 自带的 `PRAGMA user_version` 记表结构版本：每个版本的改动写成一个迁移函数，
`get_conn()` 按版本号从小到大补跑缺的那些，跑完把版本号写回库里（**改结构和改版本号在同一个
事务里**，中途失败整体回滚，不会留下半截结构）。历史库的 `user_version` 是 0，被当作 v1 的起点。
已经是最新的库每进程只做一次校验，之后每次连接不再探测。

要加字段 / 加表：

1. `SCHEMA_VERSION` + 1；
2. 写一个 `_migrate_to_N(conn)` 并登记进 `_MIGRATIONS`；
3. 迁移函数必须幂等（建表用 `IF NOT EXISTS`、加列前先看列在不在）—— 全新库、历史库、
   以及「版本号被别的东西占用但结构不全」的库都会走进来。

别在 `get_conn()` 里直接 `PRAGMA table_info` 逐列探测：那等于每次连接都白做一遍，而且表达不了
「先加列、再按旧数据回填」这类有先后顺序的改动。

### 局域网访问控制

`security_guard.py` 给 ComfyUI 的 aiohttp app 套一层中间件，只作用于 `/prompt_manager/`：

- **非 GET 默认只允许本机**（`return path not in READ_POSTS`），新增写接口不用改这里，天然受保护；
- 以 POST 发的只读接口要显式登记进 `READ_POSTS`（目前只有 `load`）；
- 敏感 GET 登记在 `LOCAL_GETS`（`export` 整包导出、`dirs` 目录浏览）；
- `gallery` / `thumb` / `meta` / `workflow` 只要带了 `path` / `paths` 参数也收紧到本机，
  否则远程能借「自定义目录」读到任意本地文件。

「本机」= 回环地址 + 本机所有网卡地址（`gethostbyname_ex` / `getaddrinfo` 解析，60 秒缓存）。
**刻意不校验 Host 和代理头**：用局域网 IP 打开自己的 ComfyUI 时不会被锁在门外。代价是放弃了
DNS rebinding 那层防护 —— 对本地小工具是可接受的取舍。

`tests/pm_security_test.py` 会扫描 `__init__.py` 里所有 `@routes.post/get`，确认每个写接口都要求
本机、只读白名单里没混进写接口。

### 前端文件结构

ComfyUI 会把 `WEB_DIRECTORY` 下**每个 js 都单独 import 一次，且顺序不保证**，所以依赖一律靠
`import` 显式声明，顶层副作用（注册扩展、定时扫描）只留在入口文件。当前是 12 个 ES 模块
（入口从最初的 4743 行降到 63 行）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `web/pm-styles.js` | 363 | `ensureStyles()` 与全部 CSS |
| `web/pm-core.js` | 405 | 常量、接口封装、提示条、控件读写、剪贴板、图标、设置存取、名称缓存 |
| `web/pm-state.js` | 20 | 跨模块共享的可变状态对象 `S`（ES module 的 import 绑定只读，A 不能给 B 的 `let` 赋值，故集中到对象属性；弹窗对象自带 `close()` / `reload()` 方法也是为此） |
| `web/pm-dialogs.js` | 370 | 通用弹窗原语：选择 / 输入 / 覆盖确认 / 目录浏览，以及关闭顶栏菜单 |
| `web/pm-hover.js` | 99 | 悬停预览浮层 |
| `web/pm-save.js` | 230 | 保存提示词对话框（列表弹窗与大图查看器共用） |
| `web/pm-io.js` | 275 | 提示词库导入 / 导出 |
| `web/pm-list.js` | 1218 | 提示词列表弹窗：加载 / 分页 / 分类栏 / 查重 / 新建 / 改名 / 移动 / 删除 |
| `web/pm-gallery.js` | 1112 | 图库弹窗、大图查看器、工作流回填、图库设置 |
| `web/pm-toolbar.js` | 410 | 节点内工具条注入、textarea 扫描、插件设置对话框 |
| `web/pm-topbar.js` | 273 | ComfyUI 顶栏入口按钮与快捷浮层（列表 / 图库 / 提示词库） |
| `web/prompt_manager.js` | 63 | 入口：`registerExtension` + 初始设置应用 + 定时扫描 |

模块之间是严格 DAG（`tests/pm_modules_check.js` 会校验循环依赖、import/export 对账、
"用了却没 import"、"import 了却没用"、`app` / `api` 是否显式 import）。

### 测试

仓库自带一套零第三方依赖的测试（前端用 Node 的 `vm` + DOM 桩跑，后端用假 `aiohttp` / `folder_paths`
模块隔离加载），一条命令跑完：

```bash
python tests/run_all.py        # 全套（缺依赖的项会自动跳过并说明原因）
python tests/check_version.py  # 只校验版本号六处是否一致
```

**发版**（改版本号 → 校验 → 跑测试 → 打包，一步到位）：

```bash
python tests/bump_version.py 1.4.62 --note "这次改了什么" --pack
python tests/bump_version.py 1.4.62 --dry     # 只看会改哪些地方，不落盘
```

它会同时改六处（`__init__.py` / `PM_VERSION` / `pyproject.toml` / README 徽章 /
README 更新日志新增一行 / vm 测试断言），然后自动跑校验与全套测试 —— **任何一步失败都会
把六处全部回滚**。`--pack` 打包的产物落在仓库上一级，想归档到别处设环境变量
`PM_ARCHIVE_DIR`（或加 `--archive <目录>`）。

| 测试 | 覆盖内容 |
|---|---|
| `tests/pm_modules_check.js` | 前端模块体检：import/export 对账、循环依赖、孤儿文件、非入口模块的顶层副作用 |
| `tests/pm_bundle.js` | 测试用的拼接器：把 web 下多个 ES 模块按依赖顺序拼成普通脚本，供 node vm 跑 |
| `tests/pm_vm_test.js` | 前端主逻辑（298 项断言，vm 桩环境，跑的是拼接后的 bundle） |
| `tests/pm_mini_blank_test.js` | 顶栏浮层 / 设置菜单的空白处关闭行为 |
| `tests/pm_backend_trash_test.py` | 后端路由、图库扫描、移入回收站、工作流接口（45 项） |
| `tests/pm_log_path_test.py` | 错误日志位置解析、旧日志迁移、1 MB 轮转、写失败静默（28 项） |
| `tests/pm_db_path_test.py` | 数据库路径解析与旧库迁移（14 项） |
| `tests/pm_db_wal_test.py` | WAL 模式 / 连接参数 / 完整性巡检 / WAL 下备份与迁移不丢数据（27 项） |
| `tests/pm_schema_test.py` | 表结构版本：全新库建到位 / 历史库补齐 / 不重复迁移 / 失败整体回滚 / 版本号被占用（32 项） |
| `tests/pm_security_test.py` | 局域网写保护：路由清单全覆盖、本机判定、自定义路径收紧、中间件 403、挂载幂等（66 项） |
| `tests/pm_db_backup_test.py` | 写前自动备份、节流、份数轮转（18 项） |
| `tests/pm_content_hash_test.py` | 内容指纹列 / 索引 / 老库补算 / 导入判重（21 项） |
| `tests/pm_paging_test.py` | 列表筛选分页、查重 SQL 分组、version / health 接口（63 项） |
| `tests/pm_meta_workflow_test.py` | 图片元数据 / 提示词提取回归（需 pillow） |
| `tests/check_version.py` | 版本号六处一致性 |
| `tests/bump_version.py` | 一键发版：改六处版本号 → 校验 → 跑测试 → 打包（失败自动回滚） |

push / PR 会触发 GitHub Actions（`.github/workflows/ci.yml`），在 Python 3.10 与 3.12 上跑同一套。

> 另有 `tests/pm_unused_scan.js` 是人工用的冗余扫描小工具（需 `npm i acorn acorn-walk`），不进 CI。


界面默认值（改代码时用，普通使用不需要动）：

- 透明度默认值：`web/pm-core.js` 的 `PM_DEFAULT_SETTINGS.opacity`
- 位置默认值：`web/pm-core.js` 的 `PM_DEFAULT_SETTINGS.position`
