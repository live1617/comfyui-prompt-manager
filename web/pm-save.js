// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 保存提示词对话框 (列表弹窗与大图查看器共用)

import { PM_DEFAULT_CATEGORY, PM_ICONS, apiPost, getWidgetText, pmItemsCacheAdd, pmKnownCategories, pmKnownItems, pmKnownNames, suggestNameForCategory, toast } from "./pm-core.js";
import { confirmOverwrite, pmInputDialog } from "./pm-dialogs.js";
import { S } from "./pm-state.js";
import { ensureStyles } from "./pm-styles.js";
export let _lastSaveCategory = "";

export function closeSaveDialog() {
    if (!S.saveDialog) return;
    const d = S.saveDialog;
    S.saveDialog = null;
    try {
        if (d.onKey) document.removeEventListener("keydown", d.onKey, true);
        d.mask.remove();
    } catch (e) {

    }
}

// target: 节点 (从其文本框取内容); textOverride: 直接给定文本 (图库大图保存提示词用, target 传 null)
export function saveWithDialog(target, textOverride) {
    if (S.dialog) S.dialog.close();
    closeSaveDialog();
    ensureStyles();

    const text =
        typeof textOverride === "string" ? textOverride : getWidgetText(target);
    if (!text.trim()) {
        toast("文本框是空的, 没有内容可保存", false);
        return;
    }

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    // 图库大图查看器是 100300, 保存框要能盖在它上面 (确认覆盖/输入框在 100400)
    mask.style.zIndex = "100320";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-sm";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = "保存提示词";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "取消 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSaveDialog();
    });
    head.appendChild(title);
    head.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "输入保存名称...";
    input.value = "";

    let nameDirty = false;
    input.addEventListener("input", () => {
        nameDirty = true;
    });

    const catRow = document.createElement("div");
    catRow.className = "pm-save-row";
    const catLabel = document.createElement("span");
    catLabel.className = "pm-save-label";
    catLabel.textContent = "分类";
    const catTabs = document.createElement("div");
    catTabs.className = "pm-cat-bar pm-save-cats";
    catRow.append(catLabel, catTabs);

    let catDirty = !!_lastSaveCategory;
    let catValue = _lastSaveCategory || PM_DEFAULT_CATEGORY;
    let catList = [];

    const refreshSuggestedName = async () => {
        if (nameDirty) return;
        input.value = await suggestNameForCategory(catValue);
    };

    const renderCatTabs = () => {
        catTabs.innerHTML = "";
        if (catValue && !catList.includes(catValue)) catList.push(catValue);
        const makeTab = (label) => {
            const t = document.createElement("button");
            t.type = "button";
            t.className = "pm-tab" + (catValue === label ? " pm-tab-on" : "");
            t.textContent = label;
            t.addEventListener("click", async () => {
                catValue = label;
                catDirty = true;
                renderCatTabs();
                await refreshSuggestedName();
            });
            return t;
        };
        for (const c of catList) catTabs.appendChild(makeTab(c));
        const add = document.createElement("button");
        add.type = "button";
        add.className = "pm-tab pm-tab-add";
        add.title = "新建分类";
        add.textContent = "+";
        add.addEventListener("click", async () => {
            const name = (await pmInputDialog("新建分类", "输入分类名称...", "") || "").trim();
            if (!name) return;
            if (!catList.includes(name)) catList.push(name);
            catValue = name;
            catDirty = true;
            renderCatTabs();
            await refreshSuggestedName();
            toast(`分类已选择: ${name}`);
        });
        catTabs.appendChild(add);
    };

    pmKnownCategories().then(async (cats) => {
        catList = cats.slice();
        renderCatTabs();
        await refreshSuggestedName();
    });
    renderCatTabs();
    refreshSuggestedName();

    const syncCategoryFromName = async () => {
        const name = (input.value || "").trim();
        if (!name || catDirty) return;
        const items = await pmKnownItems();
        const hit = items.find((i) => i.name === name);
        if (hit) {
            catValue = hit.category || PM_DEFAULT_CATEGORY;
            renderCatTabs();
        }
    };
    input.addEventListener("input", () => syncCategoryFromName());
    syncCategoryFromName();

    const info = document.createElement("div");
    info.className = "pm-dialog-hint";
    info.textContent = `将保存当前文本 (共 ${text.length} 个字符), 名称按分类自动编号, 同名保存会先询问是否覆盖`;
    info.style.padding = "0";

    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pm-btn";
    cancel.textContent = "取消";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "pm-btn pm-btn-primary";
    ok.textContent = "保存";
    actions.append(cancel, ok);

    body.append(input, catRow, info, actions);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const onKey = (e) => {
        if (e.key === "Escape" && !S.confirmOpen) {
            e.stopPropagation();
            closeSaveDialog();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask && !S.confirmOpen) closeSaveDialog();
    });
    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const d = { mask, onKey, target };
    S.saveDialog = d;

    const doSave = async () => {
        const name = (input.value || "").trim();
        if (!name) {
            input.focus();
            return toast("请输入保存名称", false);
        }
        const names = await pmKnownNames();
        if (names.includes(name)) {
            const yes = await confirmOverwrite(name);
            if (!yes) {
                input.focus();
                input.select();
                return;
            }
        }
        const category = catValue || PM_DEFAULT_CATEGORY;
        try {
            await apiPost("/prompt_manager/save", { name, text, category });
            _lastSaveCategory = category;
            pmItemsCacheAdd(name, category);
            toast(
                category === PM_DEFAULT_CATEGORY
                    ? `已保存: ${name}`
                    : `已保存到「${category}」: ${name}`
            );
            closeSaveDialog();
        } catch (e) {
            toast(e.message, false);
        }
    };

    ok.addEventListener("click", doSave);
    cancel.addEventListener("click", () => closeSaveDialog());
    const enterSave = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            doSave();
        }
    };
    input.addEventListener("keydown", enterSave);

    setTimeout(() => {
        input.focus();
        input.select();
    }, 30);
}
