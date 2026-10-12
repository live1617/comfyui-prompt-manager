// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 基础设施: 版本号 / 接口封装 / 提示 / 控件读写 / 分类与名称 / 设置存取 / 图标

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let _pmItemsCache = null;
let _pmItemsCacheFull = false;
export const PM_VERSION = "1.4.65";

// 界面上显示的许可证 —— 必须与 pyproject.toml 的 license 一致
// (v1.4.60 之前设置对话框里写死了 "MIT License", 与实际的 GPL-3.0 不符)
export const PM_LICENSE = "GPL-3.0-or-later";

// 列表对话框每页条数: 库大了以后不再一次性把整表拉回来, 滚动到底自动加载下一页
export const PM_PAGE_SIZE = 300;

export function toast(msg, ok = true) {
    console.log(`[PromptManager] ${ok ? "✅" : "❌"} ${msg}`);

    // 大图查看器遮罩盖住了 ComfyUI 自带 toast, 这时用我们自己的高层级提示
    const coveredByViewer = !!document.querySelector?.(".pm-gallery-viewer");
    const tm = coveredByViewer ? null : app?.extensionManager;
    if (tm?.toast?.add) {
        tm.toast.add({
            severity: ok ? "info" : "error",
            summary: "Prompt Manager",
            detail: msg,
            life: 3000,
        });
        return;
    }

    let box = document.getElementById("pm-toast-box");
    if (!box) {
        box = document.createElement("div");
        box.id = "pm-toast-box";
        box.style.cssText =
            // 要高过图库大图查看器 (100300) / 保存对话框 (100320), 否则弹窗里操作看不到提示
            "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100500;" +
            "display:flex;flex-direction:column;gap:6px;pointer-events:none;";
        document.body.appendChild(box);
    }
    const item = document.createElement("div");
    item.textContent = `${ok ? "✅" : "❌"} ${msg}`;
    item.style.cssText =
        "padding:8px 14px;border-radius:6px;font-size:13px;color:#fff;" +
        `background:${ok ? "rgba(30,140,90,.95)" : "rgba(190,60,60,.95)"};` +
        "box-shadow:0 2px 10px rgba(0,0,0,.25);transition:opacity .3s;";
    box.appendChild(item);
    setTimeout(() => {
        item.style.opacity = "0";
        setTimeout(() => item.remove(), 300);
    }, 2600);
}

export async function apiGet(url) {
    const res = await api.fetchApi(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
}

export async function apiPost(url, body) {
    const res = await api.fetchApi(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
}

export function findWidget(target) {
    if (!target) return null;
    if (target.widget) return target.widget;
    return target.node?.widgets?.find((w) => w.name === target.widgetName);
}

export function getWidgetText(target) {
    if (target?.textarea && target.textarea.isConnected) return target.textarea.value ?? "";
    const w = resolveDeepestWidget(findWidget(target));
    if (!w) return "";
    const el = w.inputEl || w.element;
    if (el && el.tagName === "TEXTAREA") return el.value ?? "";
    return w.value ?? "";
}

export function setWidgetText(target, text) {
    if (target?.textarea && target.textarea.isConnected) {
        target.textarea.value = text;
        target.textarea.dispatchEvent(new Event("input", { bubbles: true }));
        app.graph.setDirtyCanvas(true, true);
        return;
    }
    const w = resolveDeepestWidget(findWidget(target));
    if (!w) return;
    w.value = text;
    const el = w.inputEl || w.element;
    if (el && el.tagName === "TEXTAREA") {
        el.value = text;

        el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    app.graph.setDirtyCanvas(true, true);
}

// 返回 true/false, 让调用方能区分"复制成功"还是"被浏览器拦了"
export async function copyToClipboard(text) {
    const fallback = () => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = !!document.execCommand("copy");
        } catch (e) {
            ok = false;
        }
        ta.remove();
        return ok;
    };
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            return fallback();
        }
    }
    return fallback();
}

// 按钮就地反馈: 短暂改成"已复制 ✓"再还原, 避免只靠 toast 看不见
export function flashCopyButton(btn, text) {
    const old = btn.textContent;
    const clr = btn.style.borderColor;
    const bg = btn.style.background;
    const col = btn.style.color;
    btn.textContent = text;
    btn.disabled = true;
    btn.style.borderColor = "#6b9b78";
    btn.style.background = "rgba(90,200,120,.18)";
    btn.style.color = "#bceac6";
    setTimeout(() => {
        btn.textContent = old;
        btn.disabled = false;
        btn.style.borderColor = clr;
        btn.style.background = bg;
        btn.style.color = col;
    }, 1300);
}

export const PM_DEFAULT_CATEGORY = "默认";

export function pmCategoryOf(item) {
    return (item && item.category) || PM_DEFAULT_CATEGORY;
}

export async function pmKnownItems() {
    // 只有在缓存是完整列表时才直接用 (列表对话框分页后缓存可能只是第一页)
    if (_pmItemsCache && _pmItemsCacheFull) return _pmItemsCache;
    try {
        const data = await apiGet("/prompt_manager/all");
        _pmItemsCache = (data.items || []).map((i) => ({
            name: i.name,
            category: pmCategoryOf(i),
        }));
        _pmItemsCacheFull = true;
    } catch (e) {
        try {
            const data = await apiGet("/prompt_manager/list");
            _pmItemsCache = (data.names || []).map((n) => ({
                name: n,
                category: PM_DEFAULT_CATEGORY,
            }));
            _pmItemsCacheFull = true;
        } catch (e2) {
            _pmItemsCache = [];
        }
    }
    return _pmItemsCache;
}

export async function pmKnownNames() {
    return (await pmKnownItems()).map((i) => i.name);
}

export async function pmKnownCategories() {
    let server = [];
    try {
        const data = await apiGet("/prompt_manager/categories");
        server = (data.categories || []).map((c) => c.name || c);
    } catch (e) {
    }
    const set = new Set(server);
    for (const i of _pmItemsCache || []) set.add(pmCategoryOf(i));
    set.add(PM_DEFAULT_CATEGORY);
    return Array.from(set).sort((a, b) => {
        if (a === PM_DEFAULT_CATEGORY) return -1;
        if (b === PM_DEFAULT_CATEGORY) return 1;
        return a.localeCompare(b, "zh");
    });
}

export async function pmServerCategories() {
    try {
        const data = await apiGet("/prompt_manager/categories");
        return (data.categories || []).map((c) => c.name || c);
    } catch (e) {
        return [];
    }
}

export function pmEscapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pmNamePrefix(category) {
    const cat = category || PM_DEFAULT_CATEGORY;
    return cat === PM_DEFAULT_CATEGORY ? "prompt" : cat;
}

export async function suggestNameForCategory(category) {
    const prefix = pmNamePrefix(category);
    const items = await pmKnownItems();
    const cat = category || PM_DEFAULT_CATEGORY;
    const same = items.filter((i) => pmCategoryOf(i) === cat);
    const re = new RegExp("^" + pmEscapeRegExp(prefix) + "_(\\d{4})$");
    let max = 0;
    for (const i of same) {
        const m = re.exec(i.name || "");
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const used = new Set(items.map((i) => i.name));
    let n = max + 1;
    let name = `${prefix}_${String(n).padStart(4, "0")}`;
    while (used.has(name)) {
        n += 1;
        name = `${prefix}_${String(n).padStart(4, "0")}`;
    }
    return name;
}

export function pmItemsCacheAdd(name, category) {
    if (!_pmItemsCache) _pmItemsCache = [];
    const cat = category || PM_DEFAULT_CATEGORY;
    const hit = _pmItemsCache.find((i) => i.name === name);
    if (hit) hit.category = cat;
    else _pmItemsCache.push({ name, category: cat });
}

export function pmItemsCacheRemove(name) {
    if (!_pmItemsCache) return;
    _pmItemsCache = _pmItemsCache.filter((i) => i.name !== name);
}

export function pmItemsCacheReset(items) {
    _pmItemsCache = (items || []).map((i) => ({
        name: i.name,
        category: pmCategoryOf(i),
    }));
    _pmItemsCacheFull = true;
}

// 分页/筛选结果是局部数据: 只往里补, 不标记为完整
export function pmItemsCacheMerge(items) {
    if (!_pmItemsCache) _pmItemsCache = [];
    for (const i of items || []) {
        const cat = pmCategoryOf(i);
        const hit = _pmItemsCache.find((x) => x.name === i.name);
        if (hit) hit.category = cat;
        else _pmItemsCache.push({ name: i.name, category: cat });
    }
}

export function resolveDeepestWidget(widget) {
    let target = widget;
    try {
        if (typeof widget?.resolveDeepest === "function") {
            const deepest = widget.resolveDeepest();
            if (deepest && deepest.widget) target = deepest.widget;
        }
    } catch (e) {

    }
    return target;
}

export function isTextWidget(widget) {
    if (!widget) return false;
    const w = resolveDeepestWidget(widget);
    if (w.type === "customtext" || w.type === "string") return true;
    if (w.type === "STRING" && w.options?.multiline) return true;
    const el = w.inputEl || w.element || widget.inputEl || widget.element;
    if (el && el.tagName === "TEXTAREA") return true;
    return false;
}

export function svgIcon(paths, filled = false) {
    return (
        `<svg viewBox="0 0 24 24" width="20" height="20" ` +
        `fill="${filled ? "currentColor" : "none"}" stroke="currentColor" ` +
        `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
    );
}

// 铅笔图标路径 (trigger / edit 共用)
export const PM_ICON_PENCIL =
    `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`;

export const PM_ICONS = {
    trigger: svgIcon(PM_ICON_PENCIL),

    list: svgIcon(
        `<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>` +
            `<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>`
    ),

    dup: svgIcon(
        `<rect x="9" y="9" width="11" height="11" rx="2"/>` +
            `<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`
    ),

    save: svgIcon(
        `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>` +
            `<path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>` +
            `<path d="M7 3v4a1 1 0 0 0 1 1h7"/>`
    ),

    del: svgIcon(
        `<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>` +
            `<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>` +
            `<path d="M10 11v6"/><path d="M14 11v6"/>`
    ),
    move: svgIcon(
        `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>` +
            `<path d="m12 10v6"/><path d="m9 13 3-3 3 3"/>`
    ),
    edit: svgIcon(PM_ICON_PENCIL),
    up: svgIcon(`<path d="m6 15 6-6 6 6"/>`),
    down: svgIcon(`<path d="m6 9 6 6 6-6"/>`),

    gallery: svgIcon(`<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`),
    sort: svgIcon(`<path d="m3 16 3 3 3-3"/><path d="M6 19V8"/><path d="m21 8-3-3-3 3"/><path d="M18 5v11"/>`),
    thumbs: svgIcon(`<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>`),
    // 导出/导入用与 ⚙ 完全相同的画法 (纯 path, 同一 svgIcon 线描风格)
    upload: svgIcon(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>`),
    download: svgIcon(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>`),
    close: svgIcon(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),

    plus: svgIcon(`<path d="M12 5v14"/><path d="M5 12h14"/>`),

    refresh: svgIcon(
        `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>` +
            `<path d="M21 3v5h-5"/>` +
            `<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>` +
            `<path d="M3 21v-5h5"/>`
    ),

    gear: svgIcon(
        `<circle cx="12" cy="12" r="3"/>` +
            `<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`
    ),
};

export const PM_SETTINGS_KEY = "pm_toolbar_settings";

export const PM_DEFAULT_SETTINGS = { opacity: 0.55, position: "bl" };

export const PM_MIN_OPACITY = 0.35;

export function loadPmSettings() {
    let s;
    try {
        s = {
            ...PM_DEFAULT_SETTINGS,
            ...JSON.parse(localStorage.getItem(PM_SETTINGS_KEY) || "{}"),
        };
    } catch (e) {
        s = { ...PM_DEFAULT_SETTINGS };
    }

    if (typeof s.opacity !== "number" || s.opacity < PM_MIN_OPACITY) {
        s.opacity = PM_DEFAULT_SETTINGS.opacity;
    }
    return s;
}

export let pmSettings = loadPmSettings();

export function applyPmSettings() {
    document.documentElement.style.setProperty(
        "--pm-icon-opacity",
        String(pmSettings.opacity)
    );
    document.documentElement.dataset.pmPos = pmSettings.position;
}

export function savePmSettings() {
    try {
        localStorage.setItem(PM_SETTINGS_KEY, JSON.stringify(pmSettings));
    } catch (e) {

    }
}