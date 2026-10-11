// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// ComfyUI 顶栏入口按钮与快捷浮层 (列表 / 图库 / 提示词库)

import { app } from "../../scripts/app.js";
import { PM_ICONS } from "./pm-core.js";
import { closeSettingsMenu } from "./pm-dialogs.js";
import { openGalleryDialog } from "./pm-gallery.js";
import { exportPrompts, importPrompts } from "./pm-io.js";
import { openPromptDialog } from "./pm-list.js";
import { S } from "./pm-state.js";
import { ensureStyles } from "./pm-styles.js";
// 顶栏 ⚙ 设置按钮: 点击弹出"提示词库"对话框 (导入/导出), 再点一次或 Esc / 点空白关闭
// 状态仍存 S.settingsMenu (含 mask/onKey/onOutside/remove/contains), 各处 Esc 优先级逻辑无需改动
export function toggleSettingsMenu(anchor) {
    if (S.settingsMenu) {
        closeSettingsMenu();
        return;
    }
    ensureStyles();
    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100004";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-sm";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = "提示词库";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSettingsMenu();
    });
    head.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";
    const hint = document.createElement("div");
    hint.className = "pm-dialog-hint";
    hint.style.padding = "0 0 8px";
    hint.textContent = "备份或迁移你的提示词库:";
    body.appendChild(hint);

    const items = [
        [
            PM_ICONS.download,
            "导出提示词库",
            "把数据库中的全部提示词导出为 JSON 文件并下载",
            exportPrompts,
        ],
        [
            PM_ICONS.upload,
            "导入提示词库",
            "选择之前导出的 JSON 文件导入, 按内容判重: 库中已有相同内容(或同名)的条目会跳过, 只新增新内容",
            importPrompts,
        ],
    ];
    for (const [icon, t, d, fn] of items) {
        const it = document.createElement("button");
        it.type = "button";
        it.className = "pm-lib-item";
        const ic = document.createElement("span");
        ic.className = "pm-lib-item-icon";
        ic.innerHTML = icon;
        const txt = document.createElement("div");
        txt.className = "pm-lib-item-txt";
        const tt = document.createElement("div");
        tt.className = "pm-lib-item-t";
        tt.textContent = t;
        const dd = document.createElement("div");
        dd.className = "pm-lib-item-d";
        dd.textContent = d;
        txt.append(tt, dd);
        it.append(ic, txt);
        it.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeSettingsMenu();
            fn();
        });
        body.appendChild(it);
    }

    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const state = {
        mask,
        remove: () => mask.remove(),
        contains: (n) => mask.contains(n),
    };
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) closeSettingsMenu();
    });
    state.onKey = (ev) => {
        if (ev.key === "Escape" && S.settingsMenu === state) {
            ev.preventDefault();
            ev.stopPropagation();
            closeSettingsMenu();
        }
    };
    state.onOutside = (ev) => {
        if (S.settingsMenu !== state) return;
        if (mask.contains(ev.target) || (anchor && anchor.contains(ev.target))) return;
        closeSettingsMenu();
        // 从顶栏快捷浮层打开时, 空白点击把浮层一并收起
        if (S.topbarMenu && anchor && S.topbarMenu.contains(anchor)) closeTopbarMenu();
    };
    document.addEventListener("mousedown", state.onOutside, true);
    document.addEventListener("click", state.onOutside, true);
    document.addEventListener("keydown", state.onKey, true);
    S.settingsMenu = state;
}

export function makeSettingButton(label, onClick) {
    return function renderSettingButton() {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = "p-button p-component p-button-secondary";
        btn.style.cssText =
            "padding:6px 16px;border:none;border-radius:6px;cursor:pointer;" +
            "background:#3a3a3a;color:#fff;font-size:13px;";
        btn.addEventListener("mouseenter", () => {
            btn.style.background = "#4a4a4a";
        });
        btn.addEventListener("mouseleave", () => {
            btn.style.background = "#3a3a3a";
        });
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return btn;
    };
}



export function closeTopbarMenu() {
    if (!S.topbarMenu) return;
    const m = S.topbarMenu;
    S.topbarMenu = null;
    try {
        document.removeEventListener("mousedown", m.onOutside, true);
        document.removeEventListener("click", m.onOutside, true);
        document.removeEventListener("keydown", m.onKey, true);
        m.remove();
    } catch (e) {

    }
    // 浮层收起时连带收起设置菜单 (若还开着)
    closeSettingsMenu();
}

// 顶栏 ✏ 图标点击后的小浮层: 快捷按钮 (列表 / 图库 / 设置)
export function toggleTopbarMenu(anchor) {
    if (S.topbarMenu) {
        const same = S.topbarMenu._anchor === anchor;
        closeTopbarMenu();
        if (same) return;
    }
    ensureStyles();
    const pop = document.createElement("div");
    pop.className = "pm-topbar-pop";
    pop._anchor = anchor;

    const mkBtn = (icon, tip, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pm-topbar-pop-btn";
        b.title = tip;
        b.innerHTML = icon;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeTopbarMenu();
            onClick();
        });
        return b;
    };

    const listBtn = mkBtn(PM_ICONS.list, "提示词列表", () => openPromptDialog(null, "load"));
    const galleryBtn = mkBtn(PM_ICONS.gallery, "图库", () => openGalleryDialog());

    const gearBtn = document.createElement("button");
    gearBtn.type = "button";
    gearBtn.className = "pm-topbar-pop-btn";
    gearBtn.title = "提示词库 (导入 / 导出)";
    gearBtn.innerHTML = PM_ICONS.gear;
    gearBtn.addEventListener("mousedown", (e) => e.preventDefault());
    gearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSettingsMenu(gearBtn);
    });

    pop.append(listBtn, galleryBtn, gearBtn);
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${Math.max(8, top)}px`;

    pop.onOutside = (ev) => {
        if (S.topbarMenu !== pop) return;
        // 点击设置菜单本身 (非菜单项) 时保持浮层, 让设置菜单自己的逻辑处理
        if (S.settingsMenu && S.settingsMenu.contains(ev.target)) return;
        if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
        closeTopbarMenu();
    };
    pop.onKey = (ev) => {
        if (ev.key === "Escape" && S.topbarMenu === pop && !S.settingsMenu) {
            ev.preventDefault();
            ev.stopPropagation();
            closeTopbarMenu();
        }
    };
    // 同时监听 mousedown 和 click, 保证点空白一定能收起
    document.addEventListener("mousedown", pop.onOutside, true);
    document.addEventListener("click", pop.onOutside, true);
    document.addEventListener("keydown", pop.onKey, true);
    S.topbarMenu = pop;
}

// 把「提示词管理器」✏ 入口挂到 ComfyUI 顶栏 (设置按钮组前面), 挂不上时退回旧版菜单栏
export function installTopbarButton(attempt = 0) {
    if (S.topbarBtn?.isConnected) return true;

    const btn = document.createElement("button");
    btn.id = "pm-topbar-btn";
    btn.type = "button";
    btn.className = "pm-topbar-btn";
    btn.title = "提示词管理器 (列表 / 设置 / 排重复)";
    btn.innerHTML = PM_ICONS.trigger;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleTopbarMenu(btn);
    });
    S.topbarBtn = btn;

    const group = app.menu?.settingsGroup?.element;
    if (group?.isConnected) {
        group.before(btn);
        return true;
    }
    const legacy = document.querySelector(".comfyui-menu");
    if (legacy) {
        legacy.appendChild(btn);
        return true;
    }
    if (attempt < 100) {
        setTimeout(() => installTopbarButton(attempt + 1), 300);
    }
    return false;
}
