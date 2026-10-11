// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
import { app } from "../../scripts/app.js";
import { applyPmSettings } from "./pm-core.js";
import { S } from "./pm-state.js";
import { closeSaveDialog } from "./pm-save.js";
import { injectToolbars, sweepTextareas } from "./pm-toolbar.js";
import { exportPrompts, importPrompts } from "./pm-io.js";
import { closePromptDialog } from "./pm-list.js";
import { makeSettingButton, installTopbarButton } from "./pm-topbar.js";

console.log("[PromptManager] 前端扩展 JS 已加载");

app.registerExtension({
    name: "PromptManager.GlobalToolbar",

    setup() {
        installTopbarButton();
    },

    // 导入/导出同样保留在 ComfyUI 设置面板里, 与列表弹窗头部 ⚙ 设置菜单并存
    settings: [
        {
            id: "PromptManager.exportPrompts",
            name: "导出提示词库 (下载 JSON)",
            type: makeSettingButton("📤 导出提示词库", () => exportPrompts()),
            defaultValue: null,

            category: ["Prompt Manager", "提示词管理器", "导出"],
            tooltip: "把插件目录下数据库中的全部提示词导出为 JSON 文件并下载",
        },
        {
            id: "PromptManager.importPrompts",
            name: "导入提示词库 (选择 JSON 文件)",
            type: makeSettingButton("📥 导入提示词库", () => importPrompts()),
            defaultValue: null,
            category: ["Prompt Manager", "提示词管理器", "导入"],
            tooltip: "选择之前导出的 JSON 文件导入, 按内容判重: 库中已有相同内容(或同名)的条目会跳过, 只新增新内容",
        },
    ],

    beforeRegisterNodeDef(nodeType) {
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            let result;
            if (onNodeCreated) result = onNodeCreated.apply(this, arguments);

            injectToolbars(this);
            return result !== undefined ? result : this;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (S.dialog && S.dialog.target?.node === this) closePromptDialog();
            if (S.saveDialog && S.saveDialog.target?.node === this) closeSaveDialog();
            if (onRemoved) return onRemoved.apply(this, arguments);
        };
    },
});

applyPmSettings();

setInterval(sweepTextareas, 1500);
