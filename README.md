# ComfyUI Prompt Manager (提示词管理器)

<p><img src="https://img.shields.io/badge/version-1.1.0-blue" alt="version"> <img src="https://img.shields.io/badge/license-MIT-green" alt="license"> <img src="https://img.shields.io/badge/ComfyUI-custom__node-orange" alt="ComfyUI custom node"></p>

一个提示词保存插件，**无需添加任何节点**。装好插件后，画布上**所有带多行文本框的节点**（CLIP Text Encode、各种 Positive/Negative 提示词节点等）的文本框内部左下角都会出现一个半透明小图标工具条，可以把提示词保存到 SQLite 数据库、从数据库加载回来。

## 使用方式

把鼠标移到文本框左下角的 ✏️ 小图标上，工具条会向右展开：

- **☰ 列表** —— 打开提示词库对话框：搜索 + 名称/内容预览，**点击名称即加载到当前文本框**
- ｜
- **🔖 保存** —— 弹出名称输入框（记住上次用的名称），把当前文本框内容存入数据库，同名覆盖
- **🗑️ 删除** —— 打开对话框的删除模式，点击名称即删除（有确认）；列表项悬停时右侧也有删除小图标
- ｜
- **⚙ 设置** —— 打开工具条设置面板：
  - **透明度**：滑块调节图标平时的不透明度（10%~100%），拖动即时生效
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

## 数据库

- 数据库文件：`custom_nodes/comfyui-prompt-manager/prompt_manager.db`（SQLite，首次保存时自动创建）
- 数据表：`prompts(name 唯一, text, created_at, updated_at)`
- 同名保存会覆盖旧内容

## 外观微调

- 图标默认透明度：工具条 **⚙ 设置** 面板里可调（保存在浏览器，默认 55%）；代码默认值在 `web/prompt_manager.js` 的 `PM_DEFAULT_SETTINGS.opacity`
- 图标位置：工具条 **⚙ 设置** 面板里可选（左下/右下/左上/右上，默认左下）；代码默认值在 `PM_DEFAULT_SETTINGS.position`

## API（前端调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/prompt_manager/save` | `{name, text}` 保存/覆盖 |
| POST | `/prompt_manager/load` | `{name}` 读取内容 |
| POST | `/prompt_manager/delete` | `{name}` 删除 |
| GET  | `/prompt_manager/list` | 全部名称 |
| GET  | `/prompt_manager/all` | 列表弹窗用：名称 + 内容预览 + 长度 + 更新时间 |
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
| 1.1.0 | 2026-09-23 | 挂载范围不再仅限 nodeData 声明的 multiline STRING，改为逐控件检测（customtext / string / multiline STRING / textarea 元素 / 子图代理控件 resolveDeepest）；多文本框节点按控件序号精确匹配 textarea，修复错位；文本读写支持动态代理控件 |
| 1.0.0 | 2026-09-23 | 首个正式发布版：全局注入工具条（列表/保存/删除/设置）、SQLite 存储、导入/导出、透明度与显示位置设置、最低透明度保护 |

## 致谢

本插件的交互方式（文本框内注入悬停工具条、设置面板等）参考了 [yawiii](https://github.com/yawiii) 的 [ComfyUI-Prompt-Assistant（提示词小助手）](https://github.com/yawiii/ComfyUI-Prompt-Assistant)，特此感谢其优秀的开源作品带来的灵感。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源，欢迎自由使用、修改和分发。
