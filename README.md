# ComfyUI Prompt Manager (提示词管理器)

<p><img src="https://img.shields.io/badge/version-1.2.5-blue" alt="version"> <img src="https://img.shields.io/badge/license-MIT-green" alt="license"> <img src="https://img.shields.io/badge/ComfyUI-custom__node-orange" alt="ComfyUI custom node"></p>

一个提示词保存插件，**无需添加任何节点**。装好插件后，画布上**所有带多行文本框的节点**（CLIP Text Encode、各种 Positive/Negative 提示词节点等）的文本框内部左下角都会出现一个半透明小图标工具条，可以把提示词保存到 SQLite 数据库、从数据库加载回来。

## 使用方式

平时文本框角落只有一个 💾 保存小图标，鼠标移上去工具条会展开：

- **💾 保存**（收起态的主图标，点击即保存）—— 弹出「名称 + 分类」输入（记住上次用的），把当前文本框内容存入数据库，同名覆盖
  - 分类是和列表弹窗同一套横向标签页：直接点选已有分类，点「+」可新建
  - 输入已存在的名称时会自动带出它原来的分类；保存时若同名已存在会先弹确认框
- **☰ 列表** —— 打开提示词库对话框：搜索 + 分类标签页 + 名称/内容预览，**点击名称即加载到当前文本框**
- **📤 移动** —— 列表弹窗里每条提示词悬停时会出现移动按钮（删除按钮左边），
  点开分类标签选择器（也能「+」新建），点击目标分类即把该条提示词移过去
- **🗑️ 删除** —— 在列表弹窗里操作：悬停条目显示删除小图标，或打开对话框的删除模式（有确认）
- ｜
- **⚙ 设置** —— 打开工具条设置面板：
  - **透明度**：滑块调节图标平时的不透明度，拖动即时生效
  - **显示位置**：左下（默认）/ 右下 / 左上 / 右上 四选一，位置在右侧时工具条自动改为向左展开
  - 设置自动保存（浏览器 localStorage），对所有文本框的工具条全局生效

平时图标**不带背景圈**（就是裸的描边小图标），悬停展开时才出现浅色底板承载按钮组。

对话框支持 `Esc` / 点击遮罩关闭。每个文本框独立一套工具条，互不干扰。

## 导入 / 导出（在设置面板中）

打开 ComfyUI 右上角 **设置（齿轮图标）** → 左侧分类 **Prompt Manager**：

- **导出提示词库 (下载 JSON)**：把数据库全部提示词下载为 `prompt_manager_export.json`
- **导入提示词库 (选择 JSON 文件)**：选择导出的 JSON 文件导入，同名条目会被覆盖

## 安装

方式一（推荐，方便更新）：在 `custom_nodes` 目录下克隆仓库

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/live1617/comfyui-prompt-manager.git
```

方式二：在 GitHub 页面点 **Code → Download ZIP**，解压后把文件夹放到 `custom_nodes` 下。

> ⚠️ 注意不要「套娃」：必须是 `custom_nodes/comfyui-prompt-manager/__init__.py`，
> 而不是 `custom_nodes/comfyui-prompt-manager/comfyui-prompt-manager/__init__.py`。

```
ComfyUI/custom_nodes/comfyui-prompt-manager/
```

无任何第三方依赖（仅使用 Python 内置 sqlite3），无需 pip install。

安装后**重启 ComfyUI** 并**强制刷新页面（Ctrl + Shift + R）**即可——节点列表里**不会**出现新节点（本来就不需要），随便打开一个带多行文本框的节点就能看到工具条。

> 从旧版（带 Prompt Manager 节点）升级：节点已从插件中移除，旧工作流里已添加的
> Prompt Manager 节点会显示为缺失节点，删掉它、改用任意文本节点 + 工具条即可；
> 数据库数据完全通用，无需迁移。

## 分类

- 保存时选分类（默认 = 「默认」分类），列表按分类管理提示词
- 列表弹窗顶部有分类筛选条（全部 + 各分类，带数量），列表按分类分组显示，条目上会显示所属分类标签
- 分类存在数据库里，导出/导入的 JSON 会带上 `category` 字段
- 旧版本升级：插件启动时自动给数据表加 `category` 列，已有提示词归到「默认」分类，数据不丢

## 数据库

- 数据库文件：`custom_nodes/comfyui-prompt-manager/prompt_manager.db`（SQLite，首次保存时自动创建）
- 数据表：`prompts(name 唯一, text, category, created_at, updated_at)`
- 同名保存会覆盖旧内容（并更新它所属的分类）

## 外观微调

- 图标默认透明度：工具条 **⚙ 设置** 面板里可调（保存在浏览器，默认 55%）；代码默认值在 `web/prompt_manager.js` 的 `PM_DEFAULT_SETTINGS.opacity`
- 图标位置：工具条 **⚙ 设置** 面板里可选（左下/右下/左上/右上，默认左下）；代码默认值在 `PM_DEFAULT_SETTINGS.position`

## API（前端调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/prompt_manager/save` | `{name, text, category}` 保存/覆盖 |
| POST | `/prompt_manager/load` | `{name}` 读取内容 |
| POST | `/prompt_manager/delete` | `{name}` 删除 |
| GET  | `/prompt_manager/list` | 全部名称 |
| GET  | `/prompt_manager/categories` | 分类列表（含数量） |
| GET  | `/prompt_manager/all` | 列表弹窗用：名称 + 分类 + 内容预览 + 长度 + 更新时间 |
| POST | `/prompt_manager/move` | `{name, category}` 修改提示词所属分类 |
| GET  | `/prompt_manager/export` | 导出 JSON（附件下载） |
| POST | `/prompt_manager/import` | multipart 上传 JSON 导入 |
| GET  | `/prompt_manager/version` | 插件版本号 |

## 常见问题

**A. 文本框里没有工具条**

1. 必须**重启 ComfyUI + Ctrl + Shift + R 强刷页面**（工具条是页面加载时注入的）。
2. 确认该节点的文本框是「多行」输入（单行输入框不会注入）。
3. F12 控制台自检：应看到 `[PromptManager] 前端扩展 JS 已加载`；
   刷新后应有若干条 `工具条已挂载 (节点: xxx, 控件: xxx)`。
4. 直接访问 `http://127.0.0.1:8188/extensions` 确认清单里有
   `/extensions/comfyui-prompt-manager/prompt_manager.js`。

**B. 列表对话框里没有内容预览 / 提示「读取列表失败 (404)」**

后端新增的 `/prompt_manager/all` 接口需要**重启 ComfyUI** 才会注册。
未重启时前端会自动降级到旧接口，只能显示名称、没有内容预览。

**C. 设置面板里找不到导入 / 导出**

设置项在页面加载时注册，同样需要 **Ctrl + Shift + R** 强刷一次。

## 版本历史

| 版本 | 日期 | 更新内容 |
|---|---|---|
| 1.2.5 | 2026-09-26 | 工具条精简：保存（软盘）成为收起态主图标、点击即保存并排在展开后第一位，移除删除按钮和原有的笔形触发图标（删除统一在列表弹窗里做） |
| 1.2.4 | 2026-09-26 | 列表条目新增「移动」按钮（删除按钮左侧）：弹出分类标签选择器（可新建分类），一键把提示词移到目标分类；后端新增 POST /prompt_manager/move 接口 |
| 1.2.3 | 2026-09-26 | 保存弹窗的分类也改成横向标签页（与列表弹窗一致）：点选已有分类、「+」新建，移除旧的输入框+下拉选择器 |
| 1.2.2 | 2026-09-26 | 列表弹窗分类改为横向标签页（仿提示词小助手标签栏）：选中项白色高亮 + 底部蓝色指示条，点击标签只显示该分类，右侧「+」可新建空分类；保存弹窗下拉同步包含空分类 |
| 1.2.1 | 2026-09-26 | 分类选择改成 ComfyUI 原生风格下拉弹层：保存弹窗点 ▾ 弹出分类列表（可输入自定义），列表弹窗改为「分类」下拉选择器，点选后只显示该分类内容 |
| 1.2.0 | 2026-09-26 | 支持自定义分类：保存时可填分类（已有分类自动提示），列表弹窗支持分类筛选与分组显示，条目显示分类标签；数据库自动迁移新增 category 列，导出/导入带分类 |
| 1.1.2 | 2026-09-25 | 保存覆盖提示：同名已存在时弹出确认框（取消 / 覆盖保存），缓存提示词名称并在列表刷新、删除时同步 |
| 1.1.1 | 2026-09-23 | 兜底扫描：每 1.5 秒自动检测节点内尚未挂载工具条的 textarea（含第三方插件动态添加、延迟生成的控件）并自动补挂，加载/保存直接读写 textarea |
| 1.1.0 | 2026-09-23 | 挂载范围不再仅限 nodeData 声明的 multiline STRING，改为逐控件检测（customtext / string / multiline STRING / textarea 元素 / 子图代理控件 resolveDeepest）；多文本框节点按控件序号精确匹配 textarea，修复错位；文本读写支持动态代理控件 |
| 1.0.0 | 2026-09-23 | 首个正式发布版：全局注入工具条（列表/保存/删除/设置）、SQLite 存储、导入/导出、透明度与显示位置设置、最低透明度保护 |

## 致谢

本插件的交互方式（文本框内注入悬停工具条、设置面板等）参考了 [yawiii](https://github.com/yawiii) 的 [ComfyUI-Prompt-Assistant（提示词小助手）](https://github.com/yawiii/ComfyUI-Prompt-Assistant)，特此感谢其优秀的开源作品带来的灵感。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源，欢迎自由使用、修改和分发。
