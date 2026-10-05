// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[PromptManager] 前端扩展 JS 已加载");

const PM_VERSION = "1.4.45";

function toast(msg, ok = true) {
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

async function apiGet(url) {
    const res = await api.fetchApi(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
}

async function apiPost(url, body) {
    const res = await api.fetchApi(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
}

function findWidget(target) {
    if (!target) return null;
    if (target.widget) return target.widget;
    return target.node?.widgets?.find((w) => w.name === target.widgetName);
}

function getWidgetText(target) {
    if (target?.textarea && target.textarea.isConnected) return target.textarea.value ?? "";
    const w = resolveDeepestWidget(findWidget(target));
    if (!w) return "";
    const el = w.inputEl || w.element;
    if (el && el.tagName === "TEXTAREA") return el.value ?? "";
    return w.value ?? "";
}

function setWidgetText(target, text) {
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

let _pmDialog = null;

function closePromptDialog() {
    pmHideHoverTip();
    if (!_pmDialog) return;
    const d = _pmDialog;
    _pmDialog = null;
    closeSettingsMenu();
    try {
        if (d.onKey) document.removeEventListener("keydown", d.onKey, true);
        d.mask.remove();
    } catch (e) {

    }
}

function ensureDialogAlive(d) {
    return _pmDialog === d && d.mask.isConnected;
}

/* ===== 悬停预览: 鼠标停在列表某条上, 显示该提示词完整内容 ===== */
let _pmHoverTip = null;
let _pmHoverTimer = null;
const _pmHoverTexts = new Map();

function pmHideHoverTip() {
    if (_pmHoverTimer) {
        clearTimeout(_pmHoverTimer);
        _pmHoverTimer = null;
    }
    if (!_pmHoverTip) return;
    try {
        _pmHoverTip.remove();
    } catch (e) {
    }
    _pmHoverTip = null;
}

function pmPlaceHoverTip(box, anchor, refEl) {
    // 有列表参照时: 浮层与列表顶部对齐、和列表一样高, 贴在列表右侧 (放不下翻到左侧)
    if (refEl && refEl.getBoundingClientRect) {
        const lr = refEl.getBoundingClientRect();
        const pad = 12;
        const vw = (window && window.innerWidth) || 1280;
        const bw = box.offsetWidth || 380;
        let left = lr.right + 10;
        if (left + bw + pad > vw) left = lr.left - bw - 10;
        if (left < pad) left = Math.max(pad, Math.min(vw - bw - pad, lr.right - bw));
        box.style.left = `${Math.round(left)}px`;
        box.style.top = `${Math.round(lr.top)}px`;
        box.style.height = `${Math.round(lr.height)}px`;
        box.style.maxHeight = `${Math.round(lr.height)}px`;
        return;
    }
    const r = anchor.getBoundingClientRect
        ? anchor.getBoundingClientRect()
        : { left: 0, top: 0, right: 240, bottom: 40, width: 240, height: 30 };
    const pad = 12;
    const vw = (window && window.innerWidth) || 1280;
    const vh = (window && window.innerHeight) || 720;
    const bw = box.offsetWidth || 380;
    const bh = box.offsetHeight || 200;
    let left = r.right + 10;
    if (left + bw + pad > vw) left = r.left - bw - 10;
    if (left < pad) left = Math.max(pad, Math.min(vw - bw - pad, r.left));
    let top = r.top;
    if (top + bh + pad > vh) top = Math.max(pad, vh - bh - pad);
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
}

async function pmShowHoverTip(anchor, name, refEl) {
    const box = document.createElement("div");
    box.className = "pm-hover-tip";
    box.textContent = "加载中...";
    document.body.appendChild(box);
    _pmHoverTip = box;
    pmPlaceHoverTip(box, anchor, refEl);

    let text;
    if (_pmHoverTexts.has(name)) {
        text = _pmHoverTexts.get(name);
    } else {
        try {
            const data = await apiPost("/prompt_manager/load", { name });
            text = data.text ?? "";
            _pmHoverTexts.set(name, text);
        } catch (e) {
            text = null;
        }
    }
    // 期间鼠标已经移开或换了一条 → 丢弃这次结果
    if (_pmHoverTip !== box) return;
    if (text === null) {
        box.textContent = "读取失败";
    } else {
        box.textContent = text || "(空内容)";
    }
    pmPlaceHoverTip(box, anchor, refEl);
}

// 悬停 180ms 才显示, 快速掠过不打扰
function pmBindHoverPreview(el, name, refEl) {
    el.addEventListener("mouseenter", () => {
        pmHideHoverTip();
        _pmHoverTimer = setTimeout(() => {
            _pmHoverTimer = null;
            pmShowHoverTip(el, name, refEl);
        }, 180);
    });
    el.addEventListener("mouseleave", () => pmHideHoverTip());
}

let _pmSettingsMenu = null;

function closeSettingsMenu() {
    if (!_pmSettingsMenu) return;
    const m = _pmSettingsMenu;
    _pmSettingsMenu = null;
    try {
        document.removeEventListener("mousedown", m.onOutside, true);
        document.removeEventListener("click", m.onOutside, true);
        document.removeEventListener("keydown", m.onKey, true);
        m.remove();
    } catch (e) {

    }
}

// 顶栏 ⚙ 设置按钮: 点击弹出"提示词库"对话框 (导入/导出), 再点一次或 Esc / 点空白关闭
// 状态仍存 _pmSettingsMenu (含 mask/onKey/onOutside/remove/contains), 各处 Esc 优先级逻辑无需改动
function toggleSettingsMenu(anchor) {
    if (_pmSettingsMenu) {
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
        if (ev.key === "Escape" && _pmSettingsMenu === state) {
            ev.preventDefault();
            ev.stopPropagation();
            closeSettingsMenu();
        }
    };
    state.onOutside = (ev) => {
        if (_pmSettingsMenu !== state) return;
        if (mask.contains(ev.target) || (anchor && anchor.contains(ev.target))) return;
        closeSettingsMenu();
        // 从顶栏快捷浮层打开时, 空白点击把浮层一并收起
        if (_pmTopbarMenu && anchor && _pmTopbarMenu.contains(anchor)) closeTopbarMenu();
    };
    document.addEventListener("mousedown", state.onOutside, true);
    document.addEventListener("click", state.onOutside, true);
    document.addEventListener("keydown", state.onKey, true);
    _pmSettingsMenu = state;
}


async function openPromptDialog(target, mode = "load") {
    closePromptDialog();
    closeSaveDialog();
    ensureStyles();

    const mask = document.createElement("div");
    mask.className = "pm-mask";

    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-wide";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = mode === "delete" ? "删除提示词" : "提示词列表";
    const dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "pm-dialog-close pm-dup-btn";
    dupBtn.title = "排重复 (查找内容相同的提示词)";
    dupBtn.innerHTML = PM_ICONS.dup;
    dupBtn.addEventListener("mousedown", (e) => e.preventDefault());
    dupBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDuplicatesDialog(d);
    });

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "pm-dialog-close";
    plusBtn.title = "新建提示词 (手动添加一条)";
    plusBtn.innerHTML = PM_ICONS.plus;
    plusBtn.addEventListener("mousedown", (e) => e.preventDefault());
    plusBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNewPromptDialog(d);
    });

    const listBtn = document.createElement("button");
    listBtn.type = "button";
    listBtn.className = "pm-dialog-close";
    listBtn.title = "刷新列表 (重新读取提示词)";
    listBtn.innerHTML = PM_ICONS.refresh;
    listBtn.addEventListener("mousedown", (e) => e.preventDefault());
    listBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 原地刷新数据并重渲染, 不重建整个弹窗 (避免界面闪烁)
        reloadDialogItems(d);
    });

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "pm-dialog-close";
    exportBtn.title = "导出提示词库 (下载 JSON)";
    exportBtn.innerHTML = PM_ICONS.download;
    exportBtn.addEventListener("mousedown", (e) => e.preventDefault());
    exportBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportPrompts();
    });

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "pm-dialog-close";
    importBtn.title = "导入提示词库 (选择 JSON 文件)";
    importBtn.innerHTML = PM_ICONS.upload;
    importBtn.addEventListener("mousedown", (e) => e.preventDefault());
    importBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        importPrompts();
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closePromptDialog();
    });
    head.append(title, plusBtn, listBtn, importBtn, exportBtn, dupBtn, closeBtn);

    const searchWrap = document.createElement("div");
    searchWrap.className = "pm-dialog-search";
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "搜索名称或内容...";
    searchWrap.appendChild(search);

    const hint = document.createElement("div");
    hint.className = "pm-dialog-hint";
    hint.textContent =
        mode === "delete"
            ? "点击名称或右侧图标删除该提示词"
            : target
              ? "点击名称即可加载到当前文本框"
              : "点击名称复制内容到剪贴板 (在文本框工具条打开可直接加载)";

    const bodyRow = document.createElement("div");
    bodyRow.className = "pm-dialog-body-row";

    const catSide = document.createElement("div");
    catSide.className = "pm-cat-side";

    const catListWrap = document.createElement("div");
    catListWrap.className = "pm-cat-side-list";

    const catFoot = document.createElement("div");
    catFoot.className = "pm-cat-side-foot";

    catSide.append(catListWrap, catFoot);

    const listCol = document.createElement("div");
    listCol.className = "pm-list-col";

    const list = document.createElement("div");
    list.className = "pm-dialog-list";

    listCol.append(hint, list);
    bodyRow.append(catSide, listCol);
    dlg.append(head, searchWrap, bodyRow);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const onKey = (e) => {
        if (e.key === "Escape" && !_pmSettingsMenu && !_pmNewPromptOpen) {
            e.stopPropagation();
            closePromptDialog();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) closePromptDialog();
    });

    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const d = { mask, dlg, list, catBar: catListWrap, catFoot, search, mode, target, items: null, onKey, category: "", extraCats: [] };
    _pmDialog = d;

    list.addEventListener("scroll", pmHideHoverTip, { passive: true });
    search.addEventListener("input", () => renderDialogList(d));
    renderDialogList(d);

    await reloadDialogItems(d);
    setTimeout(() => search.focus(), 30);
}

async function reloadDialogItems(d) {
    // 服务器分类与提示词并行拉取, 保证分类栏每次刷新都是最新的
    // (否则 extraCats 只在弹窗打开时取一次, 删除/导入后左侧栏会缺分类)
    const serverP = pmServerCategories().catch(() => []);
    try {
        const data = await apiGet("/prompt_manager/all");
        if (!ensureDialogAlive(d)) return;
        d.items = data.items || [];
        pmItemsCacheReset(d.items);
    } catch (e) {

        try {
            const data = await apiGet("/prompt_manager/list");
            if (!ensureDialogAlive(d)) return;
            d.items = (data.names || []).map((n) => ({
                name: n,
                category: PM_DEFAULT_CATEGORY,
                preview: "",
                text_len: 0,
            }));
            pmItemsCacheReset(d.items);
        } catch (e2) {
            if (!ensureDialogAlive(d)) return;
            d.items = [];
            toast(`读取列表失败: ${e2.message}`, false);
        }
    }
    try {
        const server = await serverP;
        if (ensureDialogAlive(d)) {
            d.extraCats = server.filter(
                (c) => !(d.items || []).some((it) => pmCategoryOf(it) === c)
            );
        }
    } catch (e) {

    }
    renderCategoryBar(d);
    renderDialogList(d);
}

function renderCategoryBar(d) {
    if (!ensureDialogAlive(d)) return;
    const bar = d.catBar;
    bar.innerHTML = "";
    const items = d.items || [];
    const cats = [];
    const counts = new Map();
    for (const it of items) {
        const c = pmCategoryOf(it);
        if (!counts.has(c)) {
            counts.set(c, 0);
            cats.push(c);
        }
        counts.set(c, counts.get(c) + 1);
    }
    for (const c of d.extraCats || []) {
        if (!counts.has(c)) {
            counts.set(c, 0);
            cats.push(c);
        }
    }
    if (!items.length && !cats.length) return;
    if (d.category && !counts.has(d.category)) d.category = "";

    const makeTab = (label, value) => {
        const t = document.createElement("button");
        t.type = "button";
        t.className = "pm-tab" + (d.category === value ? " pm-tab-on" : "");
        t.textContent = label;
        t.addEventListener("click", () => {
            if (d.category === value) return;
            d.category = value;
            renderCategoryBar(d);
            renderDialogList(d);
        });
        return t;
    };

    bar.appendChild(makeTab("全部", ""));
    for (const c of cats) bar.appendChild(makeTab(c, c));

    if (d.catFoot) d.catFoot.innerHTML = "";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "pm-tab pm-tab-add";
    add.title = "新建分类";
    add.textContent = "+";
    add.addEventListener("click", async () => {
        const name = (await pmInputDialog("新建分类", "输入分类名称...", "") || "").trim();
        if (!name) return;
        try {
            await apiPost("/prompt_manager/categories", { name });
            if (!(d.extraCats || []).includes(name)) d.extraCats = [...(d.extraCats || []), name];
            d.category = name;
            renderCategoryBar(d);
            renderDialogList(d);
            toast(`已创建分类: ${name}`);
        } catch (e) {
            toast(e.message, false);
        }
    });
    (d.catFoot || bar).appendChild(add);

    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "pm-tab pm-tab-manage";
    manage.title = "分类管理 (改名 / 排序)";
    manage.innerHTML = PM_ICONS.gear;
    manage.addEventListener("click", async () => {
        await openCategoryManageDialog(d);
    });
    (d.catFoot || bar).appendChild(manage);
}

function renderDialogList(d) {
    if (!ensureDialogAlive(d)) return;
    const list = d.list;
    pmHideHoverTip();
    list.innerHTML = "";

    if (d.items === null) {
        const loading = document.createElement("div");
        loading.className = "pm-empty";
        loading.textContent = "加载中...";
        list.appendChild(loading);
        return;
    }

    const kw = (d.search.value || "").trim().toLowerCase();
    const kwItems = kw
        ? d.items.filter(
              (it) =>
                  (it.name || "").toLowerCase().includes(kw) ||
                  (it.preview || "").toLowerCase().includes(kw)
          )
        : d.items;
    const items = d.category
        ? kwItems.filter((it) => pmCategoryOf(it) === d.category)
        : kwItems;

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "pm-empty";
        empty.textContent = d.items.length
            ? "没有匹配的提示词"
            : "提示词库还是空的 — 在任意文本框里写好内容后点工具条的保存图标即可";
        list.appendChild(empty);
        return;
    }

    const groups = [];
    const byCat = new Map();
    for (const it of items) {
        const c = pmCategoryOf(it);
        if (!byCat.has(c)) {
            byCat.set(c, []);
            groups.push(c);
        }
        byCat.get(c).push(it);
    }

    for (const c of groups) {
        if (groups.length > 1 || (d.items.length && c !== PM_DEFAULT_CATEGORY)) {
            const gh = document.createElement("div");
            gh.className = "pm-cat-group";
            gh.textContent = `${c} (${byCat.get(c).length})`;
            list.appendChild(gh);
        }
        for (const it of byCat.get(c)) list.appendChild(makeDialogRow(d, it));
    }
}

function makeDialogRow(d, item) {
    const row = document.createElement("div");
    row.className = "pm-item";
    row.title = item.name;

    const main = document.createElement("div");
    main.className = "pm-item-main";

    const nameEl = document.createElement("div");
    nameEl.className = "pm-item-name";
    nameEl.textContent = item.name;

    const preview = (item.preview || "").replace(/\s+/g, " ").trim();
    const truncated = (item.text_len || 0) > (item.preview || "").length;
    const prevEl = document.createElement("div");
    prevEl.className = "pm-item-preview";
    prevEl.textContent = preview ? preview + (truncated ? " …" : "") : "(空内容)";

    if (pmCategoryOf(item) !== PM_DEFAULT_CATEGORY) {
        const catEl = document.createElement("div");
        catEl.className = "pm-item-cat";
        catEl.textContent = pmCategoryOf(item);
        main.append(nameEl, catEl, prevEl);
    } else {
        main.append(nameEl, prevEl);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "pm-item-del";
    del.title = `删除 "${item.name}"`;
    del.innerHTML = PM_ICONS.del;
    del.addEventListener("mousedown", (e) => e.preventDefault());
    del.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await deletePromptWithConfirm(d, item.name);
    });

    const rn = document.createElement("button");
    rn.type = "button";
    rn.className = "pm-item-del pm-item-rename";
    rn.title = `重命名 "${item.name}"`;
    rn.innerHTML = PM_ICONS.edit;
    rn.addEventListener("mousedown", (e) => e.preventDefault());
    rn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await renamePromptWithDialog(d, item.name);
    });

    const mv = document.createElement("button");
    mv.type = "button";
    mv.className = "pm-item-del pm-item-move";
    mv.title = `移动 "${item.name}" 到其他分类`;
    mv.innerHTML = PM_ICONS.move;
    mv.addEventListener("mousedown", (e) => e.preventDefault());
    mv.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await openMoveDialog(d, item.name);
    });

    row.append(main, rn, mv, del);
    row.addEventListener("click", async () => {
        if (d.mode === "delete") {
            await deletePromptWithConfirm(d, item.name);
            return;
        }
        if (!d.target) {
            await copyPromptText(item.name);
            closePromptDialog();
            return;
        }
        await loadPromptInto(d.target, item.name);
        closePromptDialog();
    });
    pmBindHoverPreview(row, item.name, d.list);
    return row;
}

// 排重复: 找出内容完全相同的提示词, 每组保留一条、删除其余
async function openDuplicatesDialog(d) {
    let groups = [];
    try {
        const data = await apiGet("/prompt_manager/duplicates");
        groups = (data.groups || []).filter((g) => g.kind !== "name");
    } catch (e) {
        toast(`查重失败: ${e.message}`, false);
        return;
    }
    if (!groups.length) {
        toast("没有发现内容重复的提示词");
        return;
    }
    groups.forEach((g) => {
        g._keep = g.items[0].name;
    });

    ensureStyles();

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100003";

    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-dup";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const titleEl = document.createElement("div");
    titleEl.className = "pm-dialog-title";
    titleEl.textContent = `重复提示词 (${groups.length} 组)`;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", () => finish());
    head.append(titleEl, closeBtn);

    const hint = document.createElement("div");
    hint.className = "pm-dialog-hint";
    hint.textContent = "每组内容相同, 点「保留」选择要留下的那条, 其余会被删除";

    const listEl = document.createElement("div");
    listEl.className = "pm-dup-list";

    const summary = document.createElement("div");
    summary.className = "pm-dup-summary";

    const toDelete = () => {
        const names = [];
        groups.forEach((g) => {
            g.items.forEach((it) => {
                if (it.name !== g._keep) names.push(it.name);
            });
        });
        return names;
    };

    const updateSummary = () => {
        summary.textContent = `共 ${groups.length} 组重复内容, 可删除 ${toDelete().length} 条`;
    };

    const render = () => {
        listEl.innerHTML = "";
        groups.forEach((g) => {
            const card = document.createElement("div");
            card.className = "pm-dup-card";

            const prev = document.createElement("div");
            prev.className = "pm-dup-preview";
            prev.textContent = g.preview || "(空内容)";
            card.appendChild(prev);

            g.items.forEach((it) => {
                const row = document.createElement("div");
                row.className = "pm-dup-row";
                const on = g._keep === it.name;

                const pick = document.createElement("button");
                pick.type = "button";
                pick.className = "pm-dup-keep" + (on ? " pm-dup-keep-on" : "");
                pick.textContent = on ? "保留" : "保留此项";
                pick.addEventListener("click", () => {
                    g._keep = it.name;
                    render();
                    updateSummary();
                });

                const nm = document.createElement("span");
                nm.className = "pm-dup-name";
                nm.textContent = it.name;

                const cat = document.createElement("span");
                cat.className = "pm-dup-cat";
                cat.textContent = it.category || PM_DEFAULT_CATEGORY;

                row.append(pick, nm, cat);
                card.appendChild(row);
            });

            listEl.appendChild(card);
        });
    };

    const finish = () => {
        document.removeEventListener("keydown", onKey, true);
        mask.remove();
    };

    const onKey = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish();
        }
    };
    document.addEventListener("keydown", onKey, true);

    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pm-btn";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => finish());

    const go = document.createElement("button");
    go.type = "button";
    go.className = "pm-btn pm-btn-danger";
    go.textContent = "删除重复项";
    go.addEventListener("click", async () => {
        const names = toDelete();
        if (!names.length) {
            toast("没有可删除的条目");
            return;
        }
        const choice = await pmChoiceDialog(
            "删除重复提示词",
            `将删除 ${names.length} 条重复提示词, 每组保留你选中的那条。删除后不可恢复。`,
            ["取消", `删除 ${names.length} 条`],
            1
        );
        if (choice !== 1) return;
        try {
            const res = await apiPost("/prompt_manager/dedupe", { names });
            names.forEach(pmItemsCacheRemove);
            toast(`已删除 ${res.deleted ?? names.length} 条重复提示词`);
            finish();
            if (ensureDialogAlive(d)) await reloadDialogItems(d);
        } catch (e) {
            toast(e.message, false);
        }
    });

    actions.append(cancel, go);
    dlg.append(head, hint, listEl, summary, actions);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    render();
    updateSummary();
}

async function openCategoryManageDialog(d) {
    ensureStyles();
    let cats = [];
    try {
        const data = await apiGet("/prompt_manager/categories");
        cats = (data.categories || []).map((c) => c.name || c);
    } catch (e) {
        toast(`读取分类失败: ${e.message}`, false);
        return;
    }

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100002";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-sm";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = "分类管理 (改名 / 排序)";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        finish();
    });
    head.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";
    const hint = document.createElement("div");
    hint.className = "pm-dialog-hint";
    hint.style.padding = "0";
    hint.textContent = "✎ 改名，↑↓ 调整显示顺序";
    const listEl = document.createElement("div");
    listEl.className = "pm-cat-manage-list";
    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "pm-btn pm-btn-primary";
    done.textContent = "完成";
    done.addEventListener("click", () => finish());
    actions.append(done);

    body.append(hint, listEl, actions);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    _pmConfirmOpen = true;
    let closed = false;
    const finish = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey, true);
        _pmConfirmOpen = false;
        try {
            mask.remove();
        } catch (e) {
        }
        if (d && ensureDialogAlive(d)) reloadDialogItems(d);
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            finish();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) finish();
    });
    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const saveOrder = async () => {
        try {
            await apiPost("/prompt_manager/categories/order", { names: cats });
        } catch (e) {
            toast(e.message, false);
        }
    };

    const render = () => {
        listEl.innerHTML = "";
        if (!cats.length) {
            const empty = document.createElement("div");
            empty.className = "pm-empty";
            empty.textContent = "还没有分类";
            listEl.appendChild(empty);
            return;
        }
        cats.forEach((name, i) => {
            const row = document.createElement("div");
            row.className = "pm-cat-man-row";
            const label = document.createElement("span");
            label.className = "pm-cat-man-name";
            label.textContent = name;

            const mkBtn = (icon, tip, fn, disabled) => {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "pm-cat-man-btn";
                b.title = tip;
                b.innerHTML = icon;
                if (disabled) b.classList.add("pm-cat-man-btn-off");
                b.addEventListener("mousedown", (e) => e.preventDefault());
                b.addEventListener("click", fn);
                return b;
            };

            const renameBtn = mkBtn(PM_ICONS.edit, "改名", async () => {
                const nn = (await pmInputDialog("重命名分类", "输入新的分类名称...", name) || "").trim();
                if (!nn || nn === name) return;
                try {
                    await apiPost("/prompt_manager/categories/rename", {
                        old_name: name,
                        new_name: nn,
                    });
                    cats[i] = nn;
                    toast(`已改名: ${name} → ${nn}`);
                    render();
                } catch (e) {
                    toast(e.message, false);
                }
            });

            const upBtn = mkBtn(
                PM_ICONS.up,
                "上移",
                async () => {
                    if (i === 0) return;
                    const t = cats[i - 1];
                    cats[i - 1] = cats[i];
                    cats[i] = t;
                    render();
                    await saveOrder();
                },
                i === 0
            );
            const downBtn = mkBtn(
                PM_ICONS.down,
                "下移",
                async () => {
                    if (i === cats.length - 1) return;
                    const t = cats[i + 1];
                    cats[i + 1] = cats[i];
                    cats[i] = t;
                    render();
                    await saveOrder();
                },
                i === cats.length - 1
            );

            const delBtn = mkBtn(PM_ICONS.del, "删除分类", async () => {
                const choice = await pmChoiceDialog(
                    `删除分类「${name}」`,
                    "请选择删除方式 (该分类下的提示词如何处理):",
                    [
                        "删除分类和提示词",
                        `删除分类, 提示词保留到「${PM_DEFAULT_CATEGORY}」`,
                    ]
                );
                if (choice === null) return;
                try {
                    await apiPost("/prompt_manager/categories/delete", {
                        name,
                        mode: choice === 0 ? "delete_all" : "keep",
                    });
                    cats = cats.filter((c) => c !== name);
                    toast(
                        choice === 0
                            ? `已删除分类及其提示词: ${name}`
                            : `已删除分类: ${name} (提示词已移到「${PM_DEFAULT_CATEGORY}」)`
                    );
                    render();
                } catch (e) {
                    toast(e.message, false);
                }
            });

            row.append(label, renameBtn, upBtn, downBtn, delBtn);
            listEl.appendChild(row);
        });
    };
    render();
    setTimeout(() => done.focus(), 30);
}

async function openMoveDialog(d, name) {
    closeSaveDialog();
    ensureStyles();
    let current = PM_DEFAULT_CATEGORY;
    const items = await pmKnownItems();
    const hit = items.find((i) => i.name === name);
    if (hit) current = pmCategoryOf(hit);

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100002";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-sm";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = `移动「${name}」到分类`;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "取消 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        finish(null);
    });
    head.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";
    const hint = document.createElement("div");
    hint.className = "pm-dialog-hint";
    hint.style.padding = "0";
    hint.textContent = "点击目标分类即可移动";
    const tabs = document.createElement("div");
    tabs.className = "pm-cat-bar pm-move-cats";
    body.append(hint, tabs);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    _pmConfirmOpen = true;
    const finish = (v) => {
        document.removeEventListener("keydown", onKey, true);
        _pmConfirmOpen = false;
        try {
            mask.remove();
        } catch (e) {
        }
        return v;
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            finish(null);
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) finish(null);
    });
    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const renderTabs = async () => {
        tabs.innerHTML = "";
        const cats = await pmKnownCategories();
        for (const c of cats) {
            const t = document.createElement("button");
            t.type = "button";
            t.className = "pm-tab" + (c === current ? " pm-tab-on" : "");
            t.textContent = c === current ? `${c} (当前)` : c;
            t.addEventListener("click", async () => {
                if (c === current) return;
                try {
                    await apiPost("/prompt_manager/move", { name, category: c });
                    pmItemsCacheAdd(name, c);
                    current = c;
                    toast(`已移动: ${name} → 「${c}」`);
                    finish(true);
                    if (d && ensureDialogAlive(d)) await reloadDialogItems(d);
                } catch (e) {
                    toast(e.message, false);
                }
            });
            tabs.appendChild(t);
        }
        const add = document.createElement("button");
        add.type = "button";
        add.className = "pm-tab pm-tab-add";
        add.title = "新建分类";
        add.textContent = "+";
        add.addEventListener("click", async () => {
            const name2 = (await pmInputDialog("新建分类", "输入分类名称...", "") || "").trim();
            if (!name2) return;
            try {
                await apiPost("/prompt_manager/categories", { name: name2 });
            } catch (e) {
            }
            await renderTabs();
            const t = Array.from(tabs.children).find(
                (x) => x.textContent === name2
            );
            if (t) t.click();
        });
        tabs.appendChild(add);
    };
    await renderTabs();
    setTimeout(() => closeBtn.focus(), 30);
}

async function renamePromptWithDialog(d, name) {
    const newName = (await pmInputDialog("重命名提示词", "输入新的提示词名称...", name) || "").trim();
    if (!newName || newName === name) return;
    const items = await pmKnownItems();
    const hit = items.find((i) => i.name === name);
    const cat = hit ? pmCategoryOf(hit) : PM_DEFAULT_CATEGORY;
    try {
        await apiPost("/prompt_manager/rename", { name, new_name: newName });
        pmItemsCacheRemove(name);
        pmItemsCacheAdd(newName, cat);
        toast(`已改名: ${name} → ${newName}`);
        if (d && ensureDialogAlive(d)) await reloadDialogItems(d);
    } catch (e) {
        toast(e.message, false);
    }
}

async function deletePromptWithConfirm(d, name) {
    const choice = await pmChoiceDialog(
        `删除提示词「${name}」`,
        "删除后不可恢复, 确定要删除吗?",
        ["删除提示词"]
    );
    if (choice === null) return;
    try {
        await apiPost("/prompt_manager/delete", { name });
        toast(`已删除: ${name}`);
        pmItemsCacheRemove(name);
        if (ensureDialogAlive(d)) await reloadDialogItems(d);
    } catch (e) {
        toast(e.message, false);
    }
}

async function loadPromptInto(target, name) {
    try {
        const data = await apiPost("/prompt_manager/load", { name });
        if (target) setWidgetText(target, data.text);
        toast(`已加载: ${name}`);
        return true;
    } catch (e) {
        toast(e.message, false);
        return false;
    }
}

// 返回 true/false, 让调用方能区分"复制成功"还是"被浏览器拦了"
async function copyToClipboard(text) {
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
function flashCopyButton(btn, text) {
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

// 顶栏入口打开的列表没有文本框目标, 点条目改为复制到剪贴板
async function copyPromptText(name) {
    try {
        const data = await apiPost("/prompt_manager/load", { name });
        const ok = await copyToClipboard(data.text ?? "");
        if (!ok) {
            toast("复制失败, 请手动选中文本复制", false);
            return false;
        }
        toast(`已复制到剪贴板: ${name}`);
        return true;
    } catch (e) {
        toast(e.message, false);
        return false;
    }
}

let _pmSaveDialog = null;
let _lastSaveCategory = "";
let _pmItemsCache = null;
let _pmConfirmOpen = false;

const PM_DEFAULT_CATEGORY = "默认";

function pmCategoryOf(item) {
    return (item && item.category) || PM_DEFAULT_CATEGORY;
}

async function pmKnownItems() {
    if (_pmItemsCache) return _pmItemsCache;
    try {
        const data = await apiGet("/prompt_manager/all");
        _pmItemsCache = (data.items || []).map((i) => ({
            name: i.name,
            category: pmCategoryOf(i),
        }));
    } catch (e) {
        try {
            const data = await apiGet("/prompt_manager/list");
            _pmItemsCache = (data.names || []).map((n) => ({
                name: n,
                category: PM_DEFAULT_CATEGORY,
            }));
        } catch (e2) {
            _pmItemsCache = [];
        }
    }
    return _pmItemsCache;
}

async function pmKnownNames() {
    return (await pmKnownItems()).map((i) => i.name);
}

async function pmKnownCategories() {
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

async function pmServerCategories() {
    try {
        const data = await apiGet("/prompt_manager/categories");
        return (data.categories || []).map((c) => c.name || c);
    } catch (e) {
        return [];
    }
}

function pmEscapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pmNamePrefix(category) {
    const cat = category || PM_DEFAULT_CATEGORY;
    return cat === PM_DEFAULT_CATEGORY ? "prompt" : cat;
}

async function suggestNameForCategory(category) {
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

function pmItemsCacheAdd(name, category) {
    if (!_pmItemsCache) _pmItemsCache = [];
    const cat = category || PM_DEFAULT_CATEGORY;
    const hit = _pmItemsCache.find((i) => i.name === name);
    if (hit) hit.category = cat;
    else _pmItemsCache.push({ name, category: cat });
}

function pmItemsCacheRemove(name) {
    if (!_pmItemsCache) return;
    _pmItemsCache = _pmItemsCache.filter((i) => i.name !== name);
}

function pmItemsCacheReset(items) {
    _pmItemsCache = (items || []).map((i) => ({
        name: i.name,
        category: pmCategoryOf(i),
    }));
}

function confirmOverwrite(name) {
    return new Promise((resolve) => {
        ensureStyles();
        _pmConfirmOpen = true;
        const mask = document.createElement("div");
        mask.className = "pm-mask";
        mask.style.zIndex = "100400";
        const dlg = document.createElement("div");
        dlg.className = "pm-dialog pm-dialog-sm";

        const head = document.createElement("div");
        head.className = "pm-dialog-head";
        const title = document.createElement("div");
        title.className = "pm-dialog-title";
        title.textContent = "名称已存在";
        head.appendChild(title);

        const body = document.createElement("div");
        body.className = "pm-dialog-body";
        const msg = document.createElement("div");
        msg.className = "pm-dialog-hint";
        msg.style.padding = "0";
        msg.textContent = `提示词 "${name}" 已存在, 保存会覆盖它原来的内容, 是否继续？`;

        const actions = document.createElement("div");
        actions.className = "pm-dialog-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "pm-btn";
        cancel.textContent = "取消";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "pm-btn pm-btn-primary";
        ok.textContent = "覆盖保存";
        actions.append(cancel, ok);
        body.append(msg, actions);
        dlg.append(head, body);
        mask.appendChild(dlg);
        document.body.appendChild(mask);

        const finish = (v) => {
            document.removeEventListener("keydown", onKey, true);
            _pmConfirmOpen = false;
            try {
                mask.remove();
            } catch (e) {
            }
            resolve(v);
        };
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                finish(false);
            }
        };
        document.addEventListener("keydown", onKey, true);
        cancel.addEventListener("click", () => finish(false));
        ok.addEventListener("click", () => finish(true));
        mask.addEventListener("mousedown", (e) => {
            if (e.target === mask) finish(false);
        });
        dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
        setTimeout(() => ok.focus(), 30);
    });
}

function pmChoiceDialog(title, message, options, dangerIndex) {
    const di = dangerIndex === undefined ? (options || []).length - 1 : dangerIndex;
    return new Promise((resolve) => {
        ensureStyles();
        const mask = document.createElement("div");
        mask.className = "pm-mask";
        mask.style.zIndex = "100004";
        const dlg = document.createElement("div");
        dlg.className = "pm-dialog pm-dialog-sm";

        const head = document.createElement("div");
        head.className = "pm-dialog-head";
        const titleEl = document.createElement("div");
        titleEl.className = "pm-dialog-title";
        titleEl.textContent = title;
        head.appendChild(titleEl);

        const body = document.createElement("div");
        body.className = "pm-dialog-body";
        const msg = document.createElement("div");
        msg.className = "pm-dialog-hint";
        msg.style.padding = "0";
        msg.style.whiteSpace = "normal";
        msg.textContent = message;

        const btns = document.createElement("div");
        btns.className = "pm-choice-btns";
        (options || []).forEach((label, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "pm-btn pm-choice-btn" + (i === di ? " pm-btn-danger" : "");
            b.textContent = label;
            b.addEventListener("click", () => finish(i));
            btns.appendChild(b);
        });

        const actions = document.createElement("div");
        actions.className = "pm-dialog-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "pm-btn";
        cancel.textContent = "取消";
        cancel.addEventListener("click", () => finish(null));
        actions.append(cancel);

        body.append(msg, btns, actions);
        dlg.append(head, body);
        mask.appendChild(dlg);
        document.body.appendChild(mask);

        let done = false;
        const finish = (v) => {
            if (done) return;
            done = true;
            document.removeEventListener("keydown", onKey, true);
            try {
                mask.remove();
            } catch (e) {
            }
            resolve(v);
        };
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                finish(null);
            }
        };
        document.addEventListener("keydown", onKey, true);
        mask.addEventListener("mousedown", (e) => {
            if (e.target === mask) finish(null);
        });
        setTimeout(() => cancel.focus(), 30);
    });
}

function pmInputDialog(title, placeholder, initial) {
    return new Promise((resolve) => {
        ensureStyles();
        const mask = document.createElement("div");
        mask.className = "pm-mask";
        mask.style.zIndex = "100400";
        const dlg = document.createElement("div");
        dlg.className = "pm-dialog pm-dialog-sm";

        const head = document.createElement("div");
        head.className = "pm-dialog-head";
        const titleEl = document.createElement("div");
        titleEl.className = "pm-dialog-title";
        titleEl.textContent = title;
        head.appendChild(titleEl);

        const body = document.createElement("div");
        body.className = "pm-dialog-body";
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = placeholder;
        input.value = initial || "";

        const actions = document.createElement("div");
        actions.className = "pm-dialog-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "pm-btn";
        cancel.textContent = "取消";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "pm-btn pm-btn-primary";
        ok.textContent = "确定";
        actions.append(cancel, ok);
        body.append(input, actions);
        dlg.append(head, body);
        mask.appendChild(dlg);
        document.body.appendChild(mask);

        let done = false;
        const finish = (v) => {
            if (done) return;
            done = true;
            document.removeEventListener("keydown", onKey, true);
            try {
                mask.remove();
            } catch (e) {
            }
            resolve(v);
        };
        const confirm = () => {
            const v = (input.value || "").trim();
            if (!v) {
                input.focus();
                return;
            }
            finish(v);
        };
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                finish(null);
            } else if (e.key === "Enter" && document.activeElement === input) {
                e.preventDefault();
                e.stopPropagation();
                confirm();
            }
        };
        document.addEventListener("keydown", onKey, true);
        cancel.addEventListener("click", () => finish(null));
        ok.addEventListener("click", confirm);
        mask.addEventListener("mousedown", (e) => {
            if (e.target === mask) finish(null);
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                confirm();
            }
        });
        setTimeout(() => {
            input.focus();
            input.select();
        }, 30);
    });
}

function closeSaveDialog() {
    if (!_pmSaveDialog) return;
    const d = _pmSaveDialog;
    _pmSaveDialog = null;
    try {
        if (d.onKey) document.removeEventListener("keydown", d.onKey, true);
        d.mask.remove();
    } catch (e) {

    }
}

// target: 节点 (从其文本框取内容); textOverride: 直接给定文本 (图库大图保存提示词用, target 传 null)
function saveWithDialog(target, textOverride) {
    closePromptDialog();
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
        if (e.key === "Escape" && !_pmConfirmOpen) {
            e.stopPropagation();
            closeSaveDialog();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask && !_pmConfirmOpen) closeSaveDialog();
    });
    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const d = { mask, onKey, target };
    _pmSaveDialog = d;

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

async function exportPrompts() {
    try {
        const res = await api.fetchApi("/prompt_manager/export");
        if (!res.ok) throw new Error("导出失败");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "prompt_manager_export.json";
        a.click();
        URL.revokeObjectURL(url);
        toast("导出成功");
    } catch (e) {
        toast(e.message, false);
    }
}

// 统一提交导入: isJson=true 走 JSON (改名后的条目), false 走 multipart 文件
async function pmImportSubmit(body, isJson) {
    const opt = { method: "POST" };
    if (isJson) {
        opt.headers = { "Content-Type": "application/json" };
        opt.body = JSON.stringify(body);
    } else {
        opt.body = body;
    }
    const res = await api.fetchApi("/prompt_manager/import", opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "导入失败");
    return data;
}

function pmImportSummary(t) {
    const parts = [];
    if (t.byContent) parts.push(`内容重复 ${t.byContent} 条`);
    if (t.byName) parts.push(`同名同内容 ${t.byName} 条`);
    if (t.byEmpty) parts.push(`无效 ${t.byEmpty} 条`);
    if (t.renameSkipped) parts.push(`未改名跳过 ${t.renameSkipped} 条`);
    if (t.added) {
        return `导入完成: 新增 ${t.added} 条${parts.length ? `, 跳过 ${parts.join(" / ")}` : ""}`;
    }
    return `没有新增: ${parts.join(" / ") || "文件中没有可用条目"}`;
}

// 同名但内容不同 → 弹窗让用户逐条改名; 返回改名后的条目数组 (null = 取消/全部跳过)
function pmRenameConflictsDialog(conflicts) {
    return new Promise((resolve) => {
        const list = Array.isArray(conflicts) ? conflicts : [];
        if (!list.length) {
            resolve([]);
            return;
        }
        ensureStyles();
        const mask = document.createElement("div");
        mask.className = "pm-mask";
        mask.style.zIndex = "100005";
        const dlg = document.createElement("div");
        dlg.className = "pm-dialog pm-dialog-conflict";

        const head = document.createElement("div");
        head.className = "pm-dialog-head";
        const titleEl = document.createElement("div");
        titleEl.className = "pm-dialog-title";
        titleEl.textContent = `名称冲突 (${list.length})`;
        head.appendChild(titleEl);

        const body = document.createElement("div");
        body.className = "pm-dialog-body pm-conflict-body";

        const hint = document.createElement("div");
        hint.className = "pm-dialog-hint";
        hint.textContent =
            "以下条目库里已有同名, 但内容不一样。改名后再导入, 留空表示跳过该条。";

        const listBox = document.createElement("div");
        listBox.className = "pm-conflict-list";
        const rows = [];
        list.forEach((c) => {
            const card = document.createElement("div");
            card.className = "pm-conflict-card";

            const nameLine = document.createElement("div");
            nameLine.className = "pm-conflict-name";
            nameLine.textContent = `原名: ${c.name || ""}`;

            const ex = document.createElement("div");
            ex.className = "pm-conflict-pre";
            ex.textContent = `库中: ${c.existing_preview || "(空)"}`;

            const inc = document.createElement("div");
            inc.className = "pm-conflict-pre";
            inc.textContent = `导入: ${c.incoming_preview || "(空)"}`;

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "留空 = 跳过该条";
            input.value = c.suggested || "";

            card.append(nameLine, ex, inc, input);
            listBox.appendChild(card);
            rows.push({ item: c, input });
        });

        body.append(hint, listBox);

        const actions = document.createElement("div");
        actions.className = "pm-dialog-actions pm-conflict-actions";
        const skipAll = document.createElement("button");
        skipAll.type = "button";
        skipAll.className = "pm-btn";
        skipAll.textContent = "全部跳过";
        skipAll.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
        });
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "pm-btn";
        cancel.textContent = "取消";
        cancel.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
        });
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "pm-btn pm-btn-primary";
        ok.textContent = "导入";
        ok.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            submit();
        });
        actions.append(skipAll, cancel, ok);

        dlg.append(head, body, actions);
        mask.appendChild(dlg);
        document.body.appendChild(mask);

        let done = false;
        const finish = (v) => {
            if (done) return;
            done = true;
            document.removeEventListener("keydown", onKey, true);
            try {
                mask.remove();
            } catch (e) {
            }
            resolve(v);
        };

        function submit() {
            const out = [];
            const seen = new Set();
            for (const r of rows) {
                const n = (r.input.value || "").trim();
                if (!n) continue;
                if (seen.has(n)) {
                    toast(`改名后有重复名称: ${n}`, false);
                    r.input.focus();
                    return;
                }
                seen.add(n);
                out.push({
                    name: n,
                    text: r.item.text || "",
                    category: r.item.category || PM_DEFAULT_CATEGORY,
                });
            }
            finish(out);
        }

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finish(null);
            } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                submit();
            }
        };
        document.addEventListener("keydown", onKey, true);
        mask.addEventListener("mousedown", (e) => {
            if (e.target === mask) finish(null);
        });
        dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

        const first = rows.length ? rows[0].input : null;
        setTimeout(() => {
            if (first) {
                first.focus();
                first.select();
            }
        }, 30);
    });
}

function importPrompts() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const form = new FormData();
        form.append("file", file);
        const t = { added: 0, byContent: 0, byName: 0, byEmpty: 0, renameSkipped: 0 };
        const collect = (d) => {
            t.added += d.imported || 0;
            t.byContent += d.skipped_content || 0;
            t.byName += d.skipped_name || 0;
            t.byEmpty += d.skipped_empty || 0;
        };
        try {
            const data = await pmImportSubmit(form, false);
            collect(data);
            // 同名但内容不同 → 提示改名, 改名后再提交一轮 (最多 3 轮)
            let pending = Array.isArray(data.conflicts) ? data.conflicts.slice() : [];
            let round = 0;
            while (pending.length && round < 3) {
                round += 1;
                const renamed = await pmRenameConflictsDialog(pending);
                if (!renamed) {
                    // 取消 / 全部跳过
                    t.renameSkipped += pending.length;
                    pending = [];
                    break;
                }
                const skippedHere = pending.length - renamed.length;
                t.renameSkipped += skippedHere;
                if (!renamed.length) {
                    pending = [];
                    break;
                }
                const next = await pmImportSubmit({ prompts: renamed }, true);
                collect(next);
                pending = Array.isArray(next.conflicts) ? next.conflicts.slice() : [];
            }
            if (pending.length) t.renameSkipped += pending.length;
            toast(pmImportSummary(t));
            // 导入后立即刷新一次列表 (面板开着就原地刷新, 没开就只刷新缓存)
            await pmRefreshAfterImport();
        } catch (e) {
            toast(e.message, false);
        }
    };
    input.click();
}

// 导入后统一刷新: 管理面板开着 → 原地重绘列表 + 分类栏; 否则静默刷新工具栏缓存
async function pmRefreshAfterImport() {
    try {
        const d = _pmDialog && ensureDialogAlive(_pmDialog) ? _pmDialog : null;
        if (d) {
            await reloadDialogItems(d);
            renderCategoryBar(d);
            renderDialogList(d);
            return;
        }
        const data = await apiGet("/prompt_manager/all");
        pmItemsCacheReset(data.items || []);
    } catch (e) {

    }
}

function makeSettingButton(label, onClick) {
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

let _pmTopbarBtn = null;
let _pmTopbarMenu = null;

function closeTopbarMenu() {
    if (!_pmTopbarMenu) return;
    const m = _pmTopbarMenu;
    _pmTopbarMenu = null;
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

// 新建提示词弹窗: 不依赖画布上的文本框, 直接在管理面板里添加一条
let _pmNewPromptOpen = false;

async function openNewPromptDialog(d) {
    closeSettingsMenu();
    ensureStyles();

    const cats = await pmKnownCategories();
    const initCat = (d && d.category) || cats[0] || PM_DEFAULT_CATEGORY;
    const suggested = await suggestNameForCategory(initCat);

    _pmNewPromptOpen = true;

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100004";

    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-new";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const titleEl = document.createElement("div");
    titleEl.className = "pm-dialog-title";
    titleEl.textContent = "新建提示词";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        finish();
    });
    head.append(titleEl, closeBtn);

    const body = document.createElement("div");
    body.className = "pm-dialog-body pm-new-body";

    const fieldBox = (labelText) => {
        const box = document.createElement("div");
        box.className = "pm-new-field";
        const lb = document.createElement("div");
        lb.className = "pm-new-label";
        lb.textContent = labelText;
        box.appendChild(lb);
        return box;
    };

    let nameTouched = false;
    const nameBox = fieldBox("名称");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "输入提示词名称...";
    nameInput.value = suggested;
    nameInput.addEventListener("input", () => {
        nameTouched = true;
    });
    nameBox.appendChild(nameInput);

    const catBox = fieldBox("分类");
    const catSel = document.createElement("select");
    for (const c of cats) {
        const op = document.createElement("option");
        op.value = c;
        op.textContent = c;
        catSel.appendChild(op);
    }
    catSel.value = initCat;
    catSel.addEventListener("change", async () => {
        if (nameTouched) return;
        nameInput.value = await suggestNameForCategory(catSel.value);
    });
    catBox.appendChild(catSel);

    const textBox = fieldBox("内容 (可留空)");
    const area = document.createElement("textarea");
    area.rows = 9;
    area.placeholder = "输入提示词内容...";
    textBox.appendChild(area);

    body.append(nameBox, catBox, textBox);

    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions pm-new-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "pm-btn";
    cancel.textContent = "取消";
    cancel.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        finish();
    });
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "pm-btn pm-btn-primary";
    ok.textContent = "保存";
    ok.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        doSave();
    });
    actions.append(cancel, ok);

    dlg.append(head, body, actions);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const onKey = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) finish();
    });
    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    function finish() {
        if (!_pmNewPromptOpen) return;
        _pmNewPromptOpen = false;
        document.removeEventListener("keydown", onKey, true);
        try {
            mask.remove();
        } catch (e) {

        }
    }

    async function doSave() {
        const name = (nameInput.value || "").trim();
        const category = (catSel.value || "").trim() || PM_DEFAULT_CATEGORY;
        if (!name) {
            toast("请先填写提示词名称", false);
            nameInput.focus();
            return;
        }
        try {
            await apiPost("/prompt_manager/save", {
                name,
                text: area.value || "",
                category,
            });
            toast(`已保存: ${name}`);
            pmItemsCacheAdd(name, category);
            finish();
            if (d && ensureDialogAlive(d)) {
                if (!(d.extraCats || []).includes(category)) {
                    d.extraCats = [...(d.extraCats || []), category];
                }
                await reloadDialogItems(d);
            }
        } catch (e) {
            toast(e.message, false);
        }
    }

    setTimeout(() => {
        nameInput.focus();
        nameInput.select();
    }, 30);
}

/* ===== 图库: 常驻缩略图窗口 (只能通过右上角 X 关闭) ===== */
const PM_GALLERY_KEY = "pm.gallery.settings";
const PM_GALLERY_LIMIT = 300;
let _pmGallery = null;
let _pmGalleryMenu = null;

function pmGallerySettings() {
    let s = {};
    try {
        s = JSON.parse(localStorage.getItem(PM_GALLERY_KEY) || "{}") || {};
    } catch (e) {
        s = {};
    }
    const paths = Array.isArray(s.paths)
        ? s.paths.filter((p) => typeof p === "string" && p.trim())
        : typeof s.path === "string" && s.path.trim()
          ? [s.path.trim()] // 旧版单路径设置迁移成列表
          : [];
    // 内置目录多选 (output / input 可同时勾选); 旧版单选 dir 自动迁移
    let dirs = Array.isArray(s.dirs)
        ? s.dirs.filter((d) => d === "output" || d === "input")
        : [];
    if (!Array.isArray(s.dirs)) {
        if (s.dir === "input") dirs = ["input"];
        else if (s.dir === "custom") dirs = []; // 旧版 custom: 只用自定义目录
        else dirs = ["output"]; // 从未设置 / 旧版 output
    }
    const useCustom =
        typeof s.useCustom === "boolean"
            ? s.useCustom
            : s.dir === "custom" || (dirs.length === 0 && paths.length > 0);
    return {
        dirs,
        paths,
        useCustom,
        // 兼容旧字段读取
        dir: useCustom && !dirs.length ? "custom" : dirs.length === 1 ? dirs[0] : "output",
        path: paths[0] || "",
        order: s.order === "name" ? "name" : "time",
        size: s.size === "s" || s.size === "l" ? s.size : "m",
    };
}

function pmSaveGallerySettings(s) {
    try {
        localStorage.setItem(PM_GALLERY_KEY, JSON.stringify(s));
    } catch (e) {
    }
}

function closeGalleryDialog() {
    closeGallerySettingsMenu();
    if (!_pmGallery) return;
    const g = _pmGallery;
    _pmGallery = null;
    try {
        g.mask.remove();
    } catch (e) {
    }
}

function closeGallerySettingsMenu() {
    if (!_pmGalleryMenu) return;
    const m = _pmGalleryMenu;
    _pmGalleryMenu = null;
    try {
        document.removeEventListener("mousedown", m.onOutside, true);
        document.removeEventListener("click", m.onOutside, true);
        document.removeEventListener("keydown", m.onKey, true);
        m.remove();
    } catch (e) {
    }
}

// 图库通用下拉菜单: 由头部按钮共用 (⚙目录 / 排序 / 缩略图大小)
// groups: [{ title: "分组名", options: [{ label, on, fn }] }]
function toggleGallerySettings(anchor, groups, onChange) {
    if (_pmGalleryMenu) {
        const same = _pmGalleryMenu._anchor === anchor;
        closeGallerySettingsMenu();
        if (same) return;
    }
    ensureStyles();
    const menu = document.createElement("div");
    menu.className = "pm-settings-menu";
    menu._anchor = anchor;

    (groups || []).forEach((grp) => {
        if (grp.title) {
            const t = document.createElement("div");
            t.className = "pm-settings-item pm-settings-label";
            t.textContent = grp.title;
            menu.appendChild(t);
        }
        (grp.options || []).forEach((o) => {
            const it = document.createElement("button");
            it.type = "button";
            it.className = "pm-settings-item";
            it.textContent = (o.on ? "✓ " : "    ") + o.label;
            it.addEventListener("mousedown", (e) => e.preventDefault());
            it.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeGallerySettingsMenu();
                o.fn();
                if (onChange) onChange();
            });
            menu.appendChild(it);
        });
    });

    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(r.right - mw, (window && window.innerWidth ? window.innerWidth : 1280) - mw - 8);
    let top = r.bottom + 6;
    const vh = window && window.innerHeight ? window.innerHeight : 720;
    if (top + mh > vh - 8) top = r.top - mh - 6;
    menu.style.left = `${Math.max(8, Math.round(left))}px`;
    menu.style.top = `${Math.max(8, Math.round(top))}px`;

    menu.onOutside = (ev) => {
        if (_pmGalleryMenu !== menu) return;
        if (menu.contains(ev.target) || anchor.contains(ev.target)) return;
        closeGallerySettingsMenu();
    };
    menu.onKey = (ev) => {
        if (ev.key === "Escape" && _pmGalleryMenu === menu) {
            ev.preventDefault();
            ev.stopPropagation();
            closeGallerySettingsMenu();
        }
    };
    document.addEventListener("mousedown", menu.onOutside, true);
    document.addEventListener("click", menu.onOutside, true);
    document.addEventListener("keydown", menu.onKey, true);
    _pmGalleryMenu = menu;
}

// 缩略图地址: 走自建的 thumb 接口 (服务端缓存 320px webp, 浏览器 immutable 缓存)
// 自定义目录 (type=custom) 时把根路径原样回传给后端
function pmRootArg(it) {
    return it && it.type === "custom" && it.root
        ? `&path=${encodeURIComponent(it.root)}`
        : "";
}

function pmThumbUrl(it) {
    const sub = it.subfolder || "";
    return (
        `/prompt_manager/thumb?type=${it.type || "output"}` +
        `&filename=${encodeURIComponent(it.name)}` +
        `&subfolder=${encodeURIComponent(sub)}&t=${it.mtime || 0}&v=${PM_VERSION}` +
        pmRootArg(it)
    );
}

// 大图查看的图片地址: 自定义目录走 thumb?full=1 (后端已做目录穿越校验)
function pmFullUrl(it) {
    if (!it) return "";
    if (it.type !== "custom") return it.url || "";
    const sub = it.subfolder || "";
    return (
        `/prompt_manager/thumb?type=custom` +
        `&filename=${encodeURIComponent(it.name)}` +
        `&subfolder=${encodeURIComponent(sub)}&full=1` +
        pmRootArg(it)
    );
}

// 大图查看: 点缩略图打开, 左侧大图 + 右侧元数据 (图片内嵌提示词), 支持左右切换
function openGalleryViewer(images, index) {
    if (!images || !images.length) return;
    ensureStyles();
    let i = Math.max(0, Math.min(index || 0, images.length - 1));
    const metaCache = new Map(); // key: type/name/subfolder/mtime -> meta

    const mask = document.createElement("div");
    mask.className = "pm-mask pm-gallery-viewer";
    mask.style.zIndex = "100300";

    const box = document.createElement("div");
    box.className = "pm-gallery-viewer-box";

    const closeX = document.createElement("button");
    closeX.type = "button";
    closeX.className = "pm-dialog-close pm-gallery-viewer-x";
    closeX.title = "关闭";
    closeX.innerHTML = PM_ICONS.close;
    closeX.addEventListener("click", (e) => {
        e.stopPropagation();
        mask.remove();
    });

    // ---- 左侧: 大图 ----
    const left = document.createElement("div");
    left.className = "pm-gallery-viewer-left";

    const img = document.createElement("img");
    img.className = "pm-gallery-viewer-img";
    img.decoding = "async";

    const cap = document.createElement("div");
    cap.className = "pm-gallery-viewer-cap";

    const mkNav = (label, tip, step, cls) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `pm-gallery-viewer-nav ${cls}`;
        b.title = tip;
        b.textContent = label;
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            i = (i + step + images.length) % images.length;
            show();
        });
        return b;
    };

    // ---- 右侧: 元数据面板 ----
    const side = document.createElement("div");
    side.className = "pm-gallery-viewer-side";

    const sideHead = document.createElement("div");
    sideHead.className = "pm-gallery-viewer-side-head";
    sideHead.textContent = "图片信息";

    const sideInfo = document.createElement("div");
    sideInfo.className = "pm-gallery-viewer-side-info";

    const sideBody = document.createElement("div");
    sideBody.className = "pm-gallery-viewer-side-body";

    // 底部固定参数栏 (不随提示词滚动, 始终贴着面板底边)
    const sideParams = document.createElement("div");
    sideParams.className = "pm-gallery-viewer-side-params";
    sideParams.style.display = "none";

    side.append(sideHead, sideInfo, sideBody, sideParams);

    const metaKey = (it) =>
        `${it.type || "output"}/${it.subfolder || ""}/${it.name}/${it.mtime || 0}`;

    const renderMeta = (meta) => {
        sideBody.innerHTML = "";
        if (meta.width && meta.height) {
            sideInfo.textContent =
                `${meta.width}×${meta.height}${meta.format ? ` · ${meta.format}` : ""}`;
        } else {
            sideInfo.textContent = "没有读到图片信息";
        }
        const prompts = (meta && meta.prompts) || [];
        if (!prompts.length) {
            const empty = document.createElement("div");
            empty.className = "pm-meta-empty";
            empty.textContent = meta.has_workflow
                ? "图片里有工作流数据, 但没有提取到提示词"
                : "图片里没有嵌入提示词数据";
            sideBody.appendChild(empty);
            renderMetaParams(meta);
            return;
        }
        prompts.forEach((p) => {
            const card = document.createElement("div");
            card.className = "pm-meta-card";

            const row = document.createElement("div");
            row.className = "pm-meta-row";

            const tag = document.createElement("span");
            tag.className = "pm-meta-tag";
            tag.textContent = p.label || "提示词";

            const sv = document.createElement("button");
            sv.type = "button";
            sv.className = "pm-meta-copy";
            sv.textContent = "保存提示词";
            sv.title = "把这条提示词保存到提示词库";
            sv.addEventListener("click", (e) => {
                e.stopPropagation();
                saveWithDialog(null, p.text || "");
            });

            const cp = document.createElement("button");
            cp.type = "button";
            cp.className = "pm-meta-copy";
            cp.textContent = "复制提示词";
            cp.addEventListener("click", async (e) => {
                e.stopPropagation();
                const ok = await copyToClipboard(p.text || "");
                if (ok) {
                    toast("提示词已复制到剪贴板");
                    flashCopyButton(cp, "已复制 ✓");
                } else {
                    toast("复制失败, 请手动选中文本复制", false);
                    flashCopyButton(cp, "复制失败 ✕");
                }
            });

            row.append(tag, sv, cp);

            const txt = document.createElement("div");
            txt.className = "pm-meta-text";
            txt.textContent = p.text || "";

            card.append(row, txt);
            sideBody.appendChild(card);
        });
        renderMetaParams(meta);
    };

    // 面板底部: 有生成参数就渲染到固定参数栏, 否则占位留空
    const renderMetaParams = (m) => {
        const params = (m && m.params) || [];
        sideParams.innerHTML = "";
        if (!params.length) {
            sideParams.style.display = "none";
            const reserve = document.createElement("div");
            reserve.className = "pm-meta-reserve";
            sideBody.appendChild(reserve);
            return;
        }
        const grid = document.createElement("div");
        grid.className = "pm-meta-params";
        params.forEach((p) => {
            const cell = document.createElement("div");
            cell.className = "pm-meta-param";
            const k = document.createElement("div");
            k.className = "pm-meta-param-k";
            k.textContent = p.label;
            const v = document.createElement("div");
            v.className = "pm-meta-param-v";
            v.textContent = p.value;
            cell.append(k, v);
            grid.appendChild(cell);
        });
        sideParams.appendChild(grid);
        sideParams.style.display = "";
    };

    let metaSeq = 0;
    const loadMeta = async (it) => {
        const key = metaKey(it);
        const cached = metaCache.get(key);
        if (cached) {
            renderMeta(cached);
            return;
        }
        const seq = ++metaSeq;
        sideInfo.textContent = "";
        sideBody.innerHTML = "";
        const loading = document.createElement("div");
        loading.className = "pm-meta-empty";
        loading.textContent = "正在读取图片信息...";
        sideBody.appendChild(loading);
        try {
            const meta = await apiGet(
                `/prompt_manager/meta?type=${it.type || "output"}` +
                    `&filename=${encodeURIComponent(it.name)}` +
                    `&subfolder=${encodeURIComponent(it.subfolder || "")}` +
                    pmRootArg(it)
            );
            metaCache.set(key, meta);
            if (seq === metaSeq) renderMeta(meta);
        } catch (e) {
            if (seq === metaSeq) {
                sideBody.innerHTML = "";
                const err = document.createElement("div");
                err.className = "pm-meta-empty";
                err.textContent = `读取失败: ${e.message}`;
                sideBody.appendChild(err);
            }
        }
    };

    const show = () => {
        const it = images[i];
        img.src = pmFullUrl(it);
        cap.textContent = `${i + 1}/${images.length} · ${it.name}`;
        loadMeta(it);
    };

    left.append(img, cap, mkNav("‹", "上一张", -1, "pm-gallery-prev"), mkNav("›", "下一张", 1, "pm-gallery-next"));
    box.append(closeX, left, side);
    mask.appendChild(box);
    mask.addEventListener("click", (e) => {
        if (e.target === mask) mask.remove();
    });
    show();
    document.body.appendChild(mask);
}

// 选择文件夹对话框: 走后端的 /prompt_manager/dirs 逐级浏览本机目录
function pmBrowseDirDialog(startPath, onPick) {
    ensureStyles();
    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100005";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-sm";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const hTitle = document.createElement("div");
    hTitle.className = "pm-dialog-title";
    hTitle.textContent = "选择文件夹";
    head.appendChild(hTitle);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";

    const cur = document.createElement("div");
    cur.className = "pm-dir-path";
    const list = document.createElement("div");
    list.className = "pm-dirlist";
    const hint = document.createElement("div");
    hint.className = "pm-dialog-hint";
    hint.style.padding = "0";
    hint.textContent = "双击文件夹进入, 点「选择此目录」确定";

    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions";
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "pm-btn pm-btn-primary";
    pickBtn.textContent = "选择此目录";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pm-btn";
    cancelBtn.textContent = "取消";
    actions.append(pickBtn, cancelBtn);

    body.append(cur, list, hint, actions);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    let path = startPath || "";
    const close = () => {
        document.removeEventListener("keydown", onKey, true);
        try {
            mask.remove();
        } catch (e) {
        }
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            close();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) close();
    });
    cancelBtn.addEventListener("click", close);
    pickBtn.addEventListener("click", () => {
        close();
        if (path && onPick) onPick(path);
    });

    const go = async (p) => {
        path = p;
        cur.textContent = path || "我的电脑";
        list.innerHTML = "";
        const loading = document.createElement("div");
        loading.className = "pm-dir-empty";
        loading.textContent = "读取中...";
        list.appendChild(loading);
        try {
            const data = await apiGet(
                `/prompt_manager/dirs?path=${encodeURIComponent(path)}`
            );
            list.innerHTML = "";
            if (data.parent) {
                const up = document.createElement("div");
                up.className = "pm-dir-item pm-dir-up";
                up.textContent = `↑ 返回上一级 (${data.parent})`;
                up.addEventListener("dblclick", () => go(data.parent));
                up.addEventListener("click", () => go(data.parent));
                list.appendChild(up);
            }
            const dirs = data.dirs || [];
            if (!dirs.length) {
                const empty = document.createElement("div");
                empty.className = "pm-dir-empty";
                empty.textContent = "没有子文件夹";
                list.appendChild(empty);
            }
            dirs.forEach((d) => {
                const el = document.createElement("div");
                el.className = "pm-dir-item";
                el.textContent = d.name;
                el.addEventListener("click", () => go(d.path));
                el.addEventListener("dblclick", () => {
                    close();
                    if (onPick) onPick(d.path);
                });
                list.appendChild(el);
            });
        } catch (e) {
            list.innerHTML = "";
            const err = document.createElement("div");
            err.className = "pm-dir-empty";
            err.textContent = `读取失败: ${e.message}`;
            list.appendChild(err);
        }
    };
    go(path);
}

// 图库设置对话框: 图片目录 (输出 / 输入 / 自定义路径)
function openGallerySettingsDialog(onApply) {
    ensureStyles();
    const s = pmGallerySettings();
    const checked = { output: false, input: false }; // 内置目录可任意勾选组合
    s.dirs.forEach((d) => {
        if (d === "output" || d === "input") checked[d] = true;
    });
    let useCustom = s.useCustom; // 自定义目录列表是否启用
    let customPaths = s.paths.slice(); // 支持添加多个不同路径的文件夹一起扫描

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100004";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-sm";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const hTitle = document.createElement("div");
    hTitle.className = "pm-dialog-title";
    hTitle.textContent = "图库设置";
    head.appendChild(hTitle);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";

    const label = document.createElement("div");
    label.className = "pm-settings-item pm-settings-label";
    label.textContent = "图片目录";
    body.appendChild(label);

    const rows = document.createElement("div");
    rows.className = "pm-dir-rows";
    const opts = [
        ["output", "输出目录 (ComfyUI output)"],
        ["input", "输入目录 (ComfyUI input)"],
        ["custom", "自定义目录 (可添加多个文件夹)"],
    ];

    // 自定义目录区: 左侧列表 + 右侧 添加文件夹 / 移除选中
    const customWrap = document.createElement("div");
    customWrap.className = "pm-dir-custom";

    const pathList = document.createElement("select");
    pathList.className = "pm-dir-list";
    pathList.multiple = true;
    pathList.size = 5;

    const syncList = () => {
        pathList.innerHTML = "";
        customPaths.forEach((p) => {
            const o = document.createElement("option");
            o.value = p;
            o.textContent = p;
            pathList.appendChild(o);
        });
    };
    syncList();

    const btnCol = document.createElement("div");
    btnCol.className = "pm-dir-btns";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "pm-btn";
    addBtn.textContent = "添加文件夹...";
    addBtn.addEventListener("mousedown", (e) => e.preventDefault());
    addBtn.addEventListener("click", () => {
        pmBrowseDirDialog(customPaths[customPaths.length - 1] || "", (p) => {
            if (customPaths.indexOf(p) >= 0) {
                toast("该目录已在列表里", false);
                return;
            }
            customPaths.push(p);
            syncList();
            useCustom = true; // 添加目录即视为勾选自定义
            sync();
        });
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "pm-btn";
    delBtn.textContent = "移除选中";
    delBtn.addEventListener("mousedown", (e) => e.preventDefault());
    delBtn.addEventListener("click", () => {
        // 真浏览器走 selectedOptions; 桩环境/兜底走 children + option.selected
        const sel = pathList.selectedOptions
            ? Array.from(pathList.selectedOptions).map((o) => o.value)
            : Array.from(pathList.children)
                  .filter((o) => o.selected)
                  .map((o) => o.value);
        if (!sel.length) {
            toast("先在列表里选中要移除的目录", false);
            return;
        }
        customPaths = customPaths.filter((p) => sel.indexOf(p) < 0);
        syncList();
    });
    btnCol.append(addBtn, delBtn);
    customWrap.append(pathList, btnCol);

    // 三个来源都是勾选式, 可任意组合 (输出 / 输入 / 自定义列表)
    const sync = () => {
        Array.prototype.forEach.call(rows.children, (row, i) => {
            const key = opts[i][0];
            const on = key === "custom" ? useCustom : checked[key];
            row.textContent = (on ? "✓ " : "    ") + opts[i][1];
            row.className = "pm-settings-item pm-dir-row" + (on ? " pm-dir-row-on" : "");
        });
        customWrap.style.display = useCustom ? "flex" : "none";
    };
    opts.forEach(([key, text]) => {
        const row = document.createElement("button");
        row.type = "button";
        row.addEventListener("mousedown", (e) => e.preventDefault());
        row.addEventListener("click", () => {
            if (key === "custom") useCustom = !useCustom;
            else checked[key] = !checked[key];
            sync();
        });
        rows.appendChild(row);
    });
    sync();

    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pm-btn pm-btn-primary";
    okBtn.textContent = "确定";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pm-btn";
    cancelBtn.textContent = "取消";
    actions.append(okBtn, cancelBtn);

    body.append(rows, customWrap, actions);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const close = () => {
        document.removeEventListener("keydown", onKey, true);
        try {
            mask.remove();
        } catch (e) {
        }
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            close();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) close();
    });
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", () => {
        const dirs = [];
        if (checked.output) dirs.push("output");
        if (checked.input) dirs.push("input");
        if (useCustom && !customPaths.length) {
            toast("自定义目录至少要添加一个文件夹", false);
            return;
        }
        if (!dirs.length && !useCustom) {
            toast("至少要勾选一个目录来源", false);
            return;
        }
        pmSaveGallerySettings({
            ...pmGallerySettings(),
            dirs,
            useCustom,
            dir: useCustom && !dirs.length ? "custom" : dirs.length === 1 ? dirs[0] : "output",
            path: useCustom ? customPaths[0] : "",
            paths: useCustom ? customPaths.slice() : [],
        });
        close();
        if (onApply) onApply();
    });
}

async function openGalleryDialog() {
    if (_pmGallery) {
        try {
            _pmGallery.mask.remove();
        } catch (e) {
        }
    }
    ensureStyles();

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    mask.style.zIndex = "100002";

    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-gallery";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";

    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = "图库";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "pm-dialog-close pm-gallery-refresh";
    refreshBtn.title = "刷新 (重新扫描图片)";
    refreshBtn.innerHTML = PM_ICONS.refresh;
    refreshBtn.addEventListener("mousedown", (e) => e.preventDefault());
    refreshBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        load(true); // 刷新按钮: 强制重新扫盘
    });

    // 排序按钮: 点击在 最新在前 / 按名称 之间切换 (原 ⚙ 设置里的排序项)
    const orderBtn = document.createElement("button");
    orderBtn.type = "button";
    orderBtn.className = "pm-dialog-close pm-gallery-order";
    orderBtn.innerHTML = PM_ICONS.sort;
    orderBtn.addEventListener("mousedown", (e) => e.preventDefault());
    orderBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = pmGallerySettings();
        toggleGallerySettings(orderBtn, [
            {
                title: "排序",
                options: [
                    {
                        label: "最新在前",
                        on: s.order === "time",
                        fn: () => pmSaveGallerySettings({ ...pmGallerySettings(), order: "time" }),
                    },
                    {
                        label: "按名称",
                        on: s.order === "name",
                        fn: () => pmSaveGallerySettings({ ...pmGallerySettings(), order: "name" }),
                    },
                ],
            },
        ], () => {
            syncHeadBtns();
            load(); // 快照 key 含 order, 换序会自动重扫
        });
    });

    // 缩略图按钮: 点击循环 小 → 中 → 大 (原 ⚙ 设置里的缩略图项)
    const sizeBtn = document.createElement("button");
    sizeBtn.type = "button";
    sizeBtn.className = "pm-dialog-close pm-gallery-size";
    sizeBtn.innerHTML = PM_ICONS.thumbs;
    sizeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    sizeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = pmGallerySettings();
        const pick = (v) => ({
            label: v === "s" ? "小" : v === "l" ? "大" : "中",
            on: s.size === v,
            fn: () => pmSaveGallerySettings({ ...pmGallerySettings(), size: v }),
        });
        toggleGallerySettings(sizeBtn, [
            { title: "缩略图", options: [pick("s"), pick("m"), pick("l")] },
        ], () => {
            syncHeadBtns();
            render(); // 只改布局, 不需要重新扫盘
        });
    });

    const syncHeadBtns = () => {
        const s = pmGallerySettings();
        orderBtn.title = `排序: ${s.order === "name" ? "按名称" : "最新在前"} (点击选择)`;
        sizeBtn.title = `缩略图: ${s.size === "s" ? "小" : s.size === "l" ? "大" : "中"} (点击选择)`;
    };
    syncHeadBtns();

    const setBtn = document.createElement("button");
    setBtn.type = "button";
    setBtn.className = "pm-dialog-close pm-gallery-set";
    setBtn.title = "设置 (图片目录)";
    setBtn.innerHTML = PM_ICONS.gear;
    setBtn.addEventListener("mousedown", (e) => e.preventDefault());
    setBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGallerySettingsDialog(() => load(true));
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close pm-gallery-close";
    closeBtn.title = "关闭";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeGalleryDialog();
    });
    head.append(title, orderBtn, sizeBtn, refreshBtn, setBtn, closeBtn);

    const grid = document.createElement("div");
    grid.className = "pm-gallery-grid";

    const foot = document.createElement("div");
    foot.className = "pm-gallery-foot";

    dlg.append(head, grid, foot);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const g = { mask, dlg, grid, foot, title, images: [] };
    _pmGallery = g;

    // 分批渲染: 一次只往网格里放 BATCH 张, 滚动接近底部再补下一批
    // (几百张同时并发请求 /view 的预览转码会把 ComfyUI 卡死)
    const BATCH = 40;
    let rendered = 0;

    const dirLabel = (s) => {
        const parts = [];
        if (s.dirs.indexOf("output") >= 0) parts.push("输出目录");
        if (s.dirs.indexOf("input") >= 0) parts.push("输入目录");
        if (s.useCustom && s.paths.length) {
            parts.push(
                s.paths.length > 1 ? `自定义目录 (${s.paths.length} 个文件夹)` : s.paths[0]
            );
        }
        return parts.join(" + ") || "输出目录";
    };

    const updateFoot = () => {
        const s = pmGallerySettings();
        const dirName = dirLabel(s);
        const n = g.images.length;
        if (!n) {
            foot.textContent = `共 0 张 · ${dirName}`;
            return;
        }
        const total = g.total || n;
        const head = g.truncated
            ? `仅显示最近 ${n} 张 / 共 ${total} 张`
            : `共 ${total} 张`;
        foot.textContent =
            rendered < n
                ? `${head} · 已显示 ${rendered} 张 · ${dirName}`
                : `${head} · ${dirName}`;
    };

    // 图片被移入回收站后: 把它从列表和网格里摘掉, 并补一张顶上空位
    // (不整体重画, 避免滚动位置被重置)
    const removeGalleryItem = (item, cellEl) => {
        const idx = g.images.indexOf(item);
        if (idx >= 0) g.images.splice(idx, 1);
        if (typeof g.total === "number" && g.total > 0) g.total -= 1;
        if (cellEl) {
            try {
                cellEl.remove();
            } catch (e) {
                if (cellEl.parentNode && cellEl.parentNode.removeChild) {
                    cellEl.parentNode.removeChild(cellEl);
                }
            }
        }
        rendered = Math.max(0, rendered - 1);
        updateFoot();
        title.textContent = `图库 (${g.images.length})`;
        // 后面还有没渲染的图 -> 补一张进来; 最后一批不足时再补
        if (rendered < g.images.length) renderBatch();
        syncRowHeight();
        fillIfRoom();
    };

    const makeCell = (it, i) => {
        const cell = document.createElement("div");
        cell.className = "pm-gallery-cell";
        cell.title = it.name;

        const img = document.createElement("img");
        img.className = "pm-gallery-img";
        img.loading = "lazy";
        img.decoding = "async";
        // 缩略图走自己的 /prompt_manager/thumb (生成一次落盘缓存 + 浏览器永久缓存),
        // 大图查看时才加载原图
        img.src = pmThumbUrl(it);
        img.alt = it.name;
        img.onerror = () => {
            img.classList.add("pm-gallery-err");
        };

        // 每张图右上角一个删除按钮: 确认后调后端把文件移入系统回收站
        const del = document.createElement("button");
        del.type = "button";
        del.className = "pm-gallery-del";
        del.title = `删除 "${it.name}" 到回收站`;
        del.innerHTML = PM_ICONS.del;
        del.addEventListener("mousedown", (e) => e.preventDefault());
        del.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation(); // 不要触发看图
            const choice = await pmChoiceDialog(
                "删除图片",
                `「${it.name}」将被移入回收站, 可以在回收站里还原。`,
                ["取消", "移入回收站"],
                1
            );
            if (choice !== 1) return;
            del.disabled = true;
            try {
                await apiPost("/prompt_manager/trash", {
                    type: it.type || "output",
                    filename: it.name,
                    subfolder: it.subfolder || "",
                    path: it.root || "",
                });
                removeGalleryItem(it, cell);
                toast(`已移到回收站: ${it.name}`);
            } catch (err) {
                del.disabled = false;
                toast(`删除失败: ${err.message}`, false);
            }
        });

        cell.append(img, del);
        // 删除后 g.images 里剩下的元素会整体前移, 所以这里的下标要现算
        cell.addEventListener("click", () => {
            const idx = g.images.indexOf(it);
            openGalleryViewer(g.images, idx < 0 ? 0 : idx);
        });
        return cell;
    };

    const renderBatch = () => {
        const end = Math.min(rendered + BATCH, g.images.length);
        for (; rendered < end; rendered++) {
            grid.appendChild(makeCell(g.images[rendered], rendered));
        }
        updateFoot();
    };

    // 首屏/补批后如果网格还没被填满 (没有滚动条), 继续补 —— 否则滚动事件永远不触发
    const fillIfRoom = () => {
        if (rendered >= g.images.length) return;
        const sh = grid.scrollHeight;
        const ch = grid.clientHeight;
        if (typeof sh !== "number" || typeof ch !== "number" || sh <= 0 || ch <= 0) return;
        if (sh <= ch + 40) {
            renderBatch();
            const raf = window.requestAnimationFrame || setTimeout;
            raf(fillIfRoom, 0);
        }
    };

    const onScroll = () => {
        showScrollbar();
        if (rendered >= g.images.length) return;
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 260) {
            renderBatch();
        }
        fillIfRoom();
    };
    grid.addEventListener("scroll", onScroll, { passive: true });

    // 滚动条: 平时隐藏, 鼠标划过网格 / 滚滚轮时才显示
    let sbTimer = null;
    const showScrollbar = () => {
        grid.classList.add("pm-scroll-visible");
        if (sbTimer) clearTimeout(sbTimer);
        sbTimer = setTimeout(() => {
            grid.classList.remove("pm-scroll-visible");
            sbTimer = null;
        }, 1100);
    };
    grid.addEventListener("wheel", showScrollbar, { passive: true });
    grid.addEventListener("mouseenter", showScrollbar);

    // 行高 = 列宽: 保证缩略图卡片是正方形。
    // 不用 aspect-ratio / padding-top 纯 CSS 方案 —— 实测部分浏览器内核在
    // "自动行高 grid + aspect-ratio 格子 / 百分比 padding" 下会把格子高度塌陷成横条。
    // 这里直接实测第一格的列宽, 写进 grid-auto-rows, 所有内核行为一致。
    const syncRowHeight = () => {
        if (_pmGallery !== g) return;
        const first = grid.querySelector(".pm-gallery-cell");
        if (!first) {
            grid.style.gridAutoRows = "";
            return;
        }
        const w = first.getBoundingClientRect().width;
        if (typeof w === "number" && w > 0) {
            grid.style.gridAutoRows = `${Math.round(w)}px`;
        }
    };
    window.addEventListener("resize", syncRowHeight);

    const render = () => {
        const s = pmGallerySettings();
        grid.className = `pm-gallery-grid pm-gallery-${s.size}`;
        grid.innerHTML = "";
        rendered = 0;
        if (!g.images.length) {
            const empty = document.createElement("div");
            empty.className = "pm-gallery-empty";
            empty.textContent = "这个目录里还没有图片";
            grid.appendChild(empty);
            updateFoot();
            return;
        }
        renderBatch();
        syncRowHeight();
        fillIfRoom();
        syncRowHeight();
    };

    // refresh=true 时强制服务端重新扫盘, 否则走服务端 10 秒内的列表快照
    const load = async (force) => {
        const s = pmGallerySettings();
        title.textContent = "图库 (扫描中...)";
        foot.textContent = "正在扫描...";
        grid.className = `pm-gallery-grid pm-gallery-${s.size}`;
        grid.innerHTML = "";
        const scanning = document.createElement("div");
        scanning.className = "pm-gallery-empty";
        scanning.textContent = "正在扫描图片...";
        grid.appendChild(scanning);
        try {
            const q =
                `/prompt_manager/gallery?dirs=${encodeURIComponent(JSON.stringify(s.dirs))}` +
                `&paths=${encodeURIComponent(JSON.stringify(s.useCustom ? s.paths : []))}` +
                `&order=${s.order}&limit=${PM_GALLERY_LIMIT}${force ? "&refresh=1" : ""}`;
            const data = await apiGet(q);
            if (_pmGallery !== g) return;
            if (data && data.ok === false) {
                // 自定义目录不存在 / 读不了: 明确提示, 引导回设置改路径
                g.images = [];
                g.total = 0;
                render();
                title.textContent = "图库";
                foot.textContent = data.error || "目录无法访问";
                toast(`无法打开目录: ${data.error || "未知错误"}`, false);
                return;
            }
            g.images = data.images || [];
            g.total = data.total || g.images.length;
            g.truncated = !!data.truncated;
            render();
            title.textContent = `图库 (${g.images.length})`;
        } catch (e) {
            if (_pmGallery !== g) return;
            title.textContent = "图库";
            foot.textContent = `扫描失败: ${e.message}`;
            toast(`图库扫描失败: ${e.message}`, false);
        }
    };

    await load();
}

// 顶栏 ✏ 图标点击后的小浮层: 快捷按钮 (列表 / 图库 / 设置)
function toggleTopbarMenu(anchor) {
    if (_pmTopbarMenu) {
        const same = _pmTopbarMenu._anchor === anchor;
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
        if (_pmTopbarMenu !== pop) return;
        // 点击设置菜单本身 (非菜单项) 时保持浮层, 让设置菜单自己的逻辑处理
        if (_pmSettingsMenu && _pmSettingsMenu.contains(ev.target)) return;
        if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
        closeTopbarMenu();
    };
    pop.onKey = (ev) => {
        if (ev.key === "Escape" && _pmTopbarMenu === pop && !_pmSettingsMenu) {
            ev.preventDefault();
            ev.stopPropagation();
            closeTopbarMenu();
        }
    };
    // 同时监听 mousedown 和 click, 保证点空白一定能收起
    document.addEventListener("mousedown", pop.onOutside, true);
    document.addEventListener("click", pop.onOutside, true);
    document.addEventListener("keydown", pop.onKey, true);
    _pmTopbarMenu = pop;
}

// 把「提示词管理器」✏ 入口挂到 ComfyUI 顶栏 (设置按钮组前面), 挂不上时退回旧版菜单栏
function installTopbarButton(attempt = 0) {
    if (_pmTopbarBtn?.isConnected) return true;

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
    _pmTopbarBtn = btn;

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
            if (_pmDialog && _pmDialog.target?.node === this) closePromptDialog();
            if (_pmSaveDialog && _pmSaveDialog.target?.node === this) closeSaveDialog();
            if (onRemoved) return onRemoved.apply(this, arguments);
        };
    },
});

function resolveDeepestWidget(widget) {
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

function isTextWidget(widget) {
    if (!widget) return false;
    const w = resolveDeepestWidget(widget);
    if (w.type === "customtext" || w.type === "string") return true;
    if (w.type === "STRING" && w.options?.multiline) return true;
    const el = w.inputEl || w.element || widget.inputEl || widget.element;
    if (el && el.tagName === "TEXTAREA") return true;
    return false;
}

function injectToolbars(node, attempt = 0) {
    if (!node || node._pmInjected) return;
    const widgets = node.widgets;

    if (!widgets || !widgets.length) {
        if (attempt < 30) {
            setTimeout(() => injectToolbars(node, attempt + 1), 50);
        }
        return;
    }
    const textWidgets = widgets.filter((w) => isTextWidget(w));
    if (!textWidgets.length) {

        if (attempt < 2) {
            setTimeout(() => {
                node._pmInjected = false;
                injectToolbars(node, attempt + 1);
            }, 500);
        } else {
            node._pmInjected = true;
        }
        return;
    }
    node._pmInjected = true;
    for (const widget of textWidgets) {
        try {
            addToolbar(node, widget);
        } catch (e) {
            console.error("[PromptManager] 工具条创建失败", e);
        }
    }
}

function makeToolbarButtons(target) {
    return [
        [
            PM_ICONS.save,
            "保存当前文本到提示词库",
            () => saveWithDialog(target),
        ],
        [
            PM_ICONS.list,
            "提示词列表 (点击名称即加载)",
            () => openPromptDialog(target, "load"),
        ],
    ];
}

function addToolbar(node, widget) {
    if (!node || !widget) return;
    node._pmToolbars = node._pmToolbars || {};
    const key = widget.name || widget.id || `w${(node.widgets || []).indexOf(widget)}`;
    if (node._pmToolbars[key]) return;
    node._pmToolbars[key] = true;

    const target = { node, widget, widgetName: widget.name };
    const toolbar = createToolbarElement(makeToolbarButtons(target));
    mountToolbar(node, widget, toolbar.el).then((ok) => {
        if (ok) {
            keepToolbarMounted(node, widget, toolbar.el);
        } else {
            console.warn(
                `[PromptManager] 未能挂进文本框 (widget: ${widget.name})`
            );
        }
    });
}

function svgIcon(paths, filled = false) {
    return (
        `<svg viewBox="0 0 24 24" width="20" height="20" ` +
        `fill="${filled ? "currentColor" : "none"}" stroke="currentColor" ` +
        `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
    );
}

// 铅笔图标路径 (trigger / edit 共用)
const PM_ICON_PENCIL =
    `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`;

const PM_ICONS = {
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

const PM_SETTINGS_KEY = "pm_toolbar_settings";
const PM_DEFAULT_SETTINGS = { opacity: 0.55, position: "bl" };

const PM_MIN_OPACITY = 0.35;

function loadPmSettings() {
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

let pmSettings = loadPmSettings();

function applyPmSettings() {
    document.documentElement.style.setProperty(
        "--pm-icon-opacity",
        String(pmSettings.opacity)
    );
    document.documentElement.dataset.pmPos = pmSettings.position;
}

function savePmSettings() {
    try {
        localStorage.setItem(PM_SETTINGS_KEY, JSON.stringify(pmSettings));
    } catch (e) {

    }
}

applyPmSettings();

const PM_POSITIONS = [
    ["tl", "左上"],
    ["tr", "右上"],
    ["bl", "左下 (默认)"],
    ["br", "右下"],
];

function openSettingsDialog() {
    closePromptDialog();
    closeSaveDialog();
    ensureStyles();

    const mask = document.createElement("div");
    mask.className = "pm-mask";
    const dlg = document.createElement("div");
    dlg.className = "pm-dialog pm-dialog-set";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = "工具条设置";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSettings();
    });
    head.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "pm-dialog-body";

    const opRow = document.createElement("div");
    opRow.className = "pm-set-row";
    const opLabel = document.createElement("span");
    opLabel.className = "pm-set-label";
    opLabel.textContent = "透明度";
    const opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.min = String(Math.round(PM_MIN_OPACITY * 100));
    opSlider.max = "100";
    opSlider.step = "5";
    opSlider.value = String(Math.round(pmSettings.opacity * 100));
    const opVal = document.createElement("span");
    opVal.className = "pm-set-val";
    opVal.textContent = `${opSlider.value}%`;
    opRow.append(opLabel, opSlider, opVal);
    opSlider.addEventListener("input", () => {
        pmSettings.opacity = Number(opSlider.value) / 100;
        opVal.textContent = `${opSlider.value}%`;
        applyPmSettings();
    });
    opSlider.addEventListener("change", savePmSettings);

    const posRow = document.createElement("div");
    posRow.className = "pm-set-row";
    const posLabel = document.createElement("span");
    posLabel.className = "pm-set-label";
    posLabel.textContent = "位置";
    const posGroup = document.createElement("div");
    posGroup.className = "pm-positions";
    const radios = [];
    for (const [value, label] of PM_POSITIONS) {
        const opt = document.createElement("label");
        opt.className = "pm-pos-opt";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "pm-position";
        radio.value = value;
        radio.checked = pmSettings.position === value;
        radio.addEventListener("change", () => {
            if (!radio.checked) return;
            pmSettings.position = value;
            applyPmSettings();
            savePmSettings();
        });

        opt.append(radio, document.createTextNode(label));
        posGroup.appendChild(opt);
        radios.push(radio);
    }
    posRow.append(posLabel, posGroup);

    const info = document.createElement("div");
    info.className = "pm-dialog-hint";
    info.textContent = "设置即时生效并自动保存, 对所有文本框的工具条生效";
    info.style.padding = "0";

    const ver = document.createElement("div");
    ver.className = "pm-dialog-hint";
    ver.textContent = `Prompt Manager v${PM_VERSION} · MIT License`;
    ver.style.padding = "0";

    const actions = document.createElement("div");
    actions.className = "pm-dialog-actions";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "pm-btn pm-btn-primary";
    ok.textContent = "完成";
    ok.addEventListener("click", () => closeSettings());
    actions.appendChild(ok);

    body.append(opRow, posRow, info, ver, actions);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closeSettings();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) closeSettings();
    });
    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    function closeSettings() {
        document.removeEventListener("keydown", onKey, true);
        savePmSettings();
        mask.remove();
    }
}

function ensureStyles() {
    if (document.getElementById("pm-toolbar-style")) return;
    const style = document.createElement("style");
    style.id = "pm-toolbar-style";
    style.textContent = `
/* ===== 节点内工具条 ===== */
/* 默认: 直接挂在文本框容器内部, 绝对定位到左下角
   显示位置由 html[data-pm-pos] 控制 (设置面板可调) */
.pm-toolbar{position:absolute;left:8px;bottom:8px;z-index:20;pointer-events:none;}
html[data-pm-pos="tl"] .pm-toolbar{left:8px;top:8px;bottom:auto;}
html[data-pm-pos="tr"] .pm-toolbar{left:auto;right:8px;top:8px;bottom:auto;}
html[data-pm-pos="br"] .pm-toolbar{left:auto;right:8px;top:auto;bottom:8px;}
.pm-pill{position:absolute;left:0;bottom:0;display:flex;align-items:center;
    height:28px;max-width:30px;overflow:hidden;
    background:transparent;border:none;box-shadow:none;border-radius:14px;
    transition:max-width .22s ease,opacity .22s ease,background .22s ease;
    opacity:var(--pm-icon-opacity,.55);   /* 平时半透明, 可用该变量整体调透明度 */
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.65));  /* 轮廓阴影: 低透明度下也能看清 */
    pointer-events:auto;}
/* 悬停展开: 向右展开 + 完全不透明 + 出现浅底以承载按钮组 */
.pm-pill:hover{max-width:260px;opacity:1;background:rgba(24,24,24,.88);
    border:1px solid rgba(120,120,120,.45);box-shadow:0 2px 8px rgba(0,0,0,.35);}
/* 位置在右侧时: 锚点贴右、展开方向翻转向左 */
html[data-pm-pos="tr"] .pm-pill,html[data-pm-pos="br"] .pm-pill{left:auto;right:0;flex-direction:row-reverse;}
.pm-pill button{all:unset;box-sizing:border-box;width:0;opacity:0;overflow:hidden;
    text-align:center;height:26px;cursor:pointer;color:#d8d8d8;
    border-radius:13px;transition:width .18s ease,opacity .18s ease,background .15s ease,transform .15s ease;}
.pm-pill button svg{display:block;margin:0 auto;}
.pm-pill:hover button{width:30px;opacity:1;}
.pm-pill button:hover{background:rgba(255,255,255,.12);color:#fff;transform:scale(1.12);}
.pm-pill button:active{transform:scale(.95);}
.pm-pill .pm-trigger{width:28px;opacity:1;color:#d0d0d0;}
.pm-pill .pm-trigger:hover{background:transparent;color:#fff;}
/* 分组分隔线 (展开时才显示) */
.pm-actions-divider{flex:0 0 auto;width:0;height:14px;background:rgba(255,255,255,.25);
    margin:0;opacity:0;transition:width .18s ease,opacity .18s ease,margin .18s ease;}
.pm-pill:hover .pm-actions-divider{width:1px;margin:0 3px;opacity:1;}

/* ===== 对话框 (列表 / 保存) ===== */
.pm-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);
    display:flex;align-items:center;justify-content:center;animation:pm-fade .14s ease;}
@keyframes pm-fade{from{opacity:0}to{opacity:1}}
.pm-dialog{width:460px;max-width:92vw;max-height:76vh;display:flex;flex-direction:column;
    background:#242424;border:1px solid #3d3d3d;border-radius:12px;overflow:hidden;
    box-shadow:0 16px 48px rgba(0,0,0,.6);color:#e8e8e8;
    font-family:inherit;animation:pm-pop .16s ease;}
.pm-dialog-sm{width:360px;}
.pm-dialog-set{width:430px;}
.pm-dialog-wide{width:560px;height:800px;min-height:0;}
.pm-dialog-body-row{flex:1;display:flex;min-height:0;height:100%;overflow:hidden;}
.pm-cat-side{flex:0 0 112px;display:flex;flex-direction:column;min-height:0;
    border-right:1px solid #343434;background:#1e1e1e;}
.pm-cat-side-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;
    padding:10px 6px;overflow-y:auto;}
.pm-cat-side-list::-webkit-scrollbar{width:6px;}
.pm-cat-side-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:3px;}
.pm-cat-side-foot{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;
    gap:2px;padding:6px;border-top:1px solid #343434;}
.pm-cat-side-foot .pm-tab{width:100%;text-align:center;font-size:13px;}
.pm-cat-side .pm-tab{display:block;width:100%;text-align:left;padding:7px 10px;font-size:12px;
    border-radius:6px;}
.pm-cat-side .pm-tab-on{background:rgba(47,111,221,.24);color:#fff;}
.pm-cat-side .pm-tab-on::after{content:"";position:absolute;left:8px;right:8px;bottom:1px;
    height:2px;border-radius:2px;background:#2f6fdd;}
.pm-cat-side .pm-tab-add,.pm-cat-side .pm-tab-manage{text-align:center;}
.pm-cat-side-foot .pm-tab-manage{width:100%;}
.pm-list-col{flex:1;min-width:0;display:flex;flex-direction:column;}
.pm-list-col .pm-dialog-hint{padding:6px 14px 4px;}
.pm-list-col .pm-dialog-list{flex:1;}
.pm-dialog-dup{width:520px;height:520px;min-height:0;display:flex;flex-direction:column;}
.pm-dup-btn:hover{background:rgba(47,111,221,.24);color:#9fd0ff;}
.pm-dup-list{flex:1;min-height:0;overflow-y:auto;padding:8px 12px;
    display:flex;flex-direction:column;gap:8px;}
.pm-dup-list::-webkit-scrollbar{width:8px;}
.pm-dup-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-dup-card{border:1px solid #343434;border-radius:8px;padding:8px 10px;background:#242424;
    display:flex;flex-direction:column;gap:5px;}
.pm-dup-preview{font-size:11.5px;color:#8b8b8b;line-height:1.5;max-height:34px;overflow:hidden;}
.pm-dup-row{display:flex;align-items:center;gap:8px;}
.pm-dup-keep{all:unset;box-sizing:border-box;min-width:64px;text-align:center;padding:3px 8px;
    border:1px solid #3d3d3d;border-radius:6px;color:#9a9a9a;font-size:11.5px;cursor:pointer;}
.pm-dup-keep:hover{border-color:#6b6b6b;color:#ddd;}
.pm-dup-keep-on{background:#2f6fdd;border-color:#2f6fdd;color:#fff;}
.pm-dup-keep-on:hover{background:#3d7ce8;color:#fff;}
.pm-dup-name{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pm-dup-cat{font-size:11px;color:#7c7c7c;flex:0 0 auto;}
.pm-dup-summary{padding:7px 14px;font-size:11.5px;color:#8b8b8b;border-top:1px solid #343434;}
.pm-hover-tip{position:fixed;z-index:100200;max-width:420px;max-height:60vh;overflow:auto;
    padding:10px 12px;background:#1f1f1f;border:1px solid #454545;border-radius:10px;
    color:#e2e2e2;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;
    box-shadow:0 12px 32px rgba(0,0,0,.6);pointer-events:none;animation:pm-fade .12s ease;}
.pm-hover-tip::-webkit-scrollbar{width:8px;}
.pm-hover-tip::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-topbar-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;
    justify-content:center;width:34px;height:34px;flex:0 0 auto;margin:0 2px;padding:0;
    border-radius:8px;cursor:pointer;color:var(--fg-color,#e8e8e8);
    transition:background .15s ease,color .15s ease;}
.pm-topbar-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-topbar-btn svg{width:18px;height:18px;}
.pm-topbar-pop{position:fixed;z-index:100100;display:flex;align-items:center;gap:2px;padding:4px;
    background:#2c2c2c;border:1px solid #3d3d3d;border-radius:9px;
    box-shadow:0 10px 30px rgba(0,0,0,.55);animation:pm-pop .12s ease;}
.pm-topbar-pop-btn{all:unset;box-sizing:border-box;width:30px;height:30px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#c8c8c8;
    transition:background .12s ease,color .12s ease;}
.pm-topbar-pop-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-topbar-pop-btn svg{width:16px;height:16px;}
@keyframes pm-pop{from{transform:translateY(6px) scale(.98);opacity:.6}to{transform:none;opacity:1}}
.pm-dialog-head{display:flex;align-items:center;gap:10px;padding:12px 14px;
    border-bottom:1px solid #343434;background:#282828;}
.pm-dialog-title{flex:1;font-size:14px;font-weight:600;letter-spacing:.3px;}
.pm-dialog-close{all:unset;box-sizing:border-box;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#b6b6b6;
    transition:background .15s ease,color .15s ease;}
.pm-dialog-close:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-dialog-gallery{width:94vw;height:92vh;min-height:0;
    display:flex;flex-direction:column;}
.pm-gallery-grid{flex:1;min-height:0;overflow-y:auto;padding:12px;
    display:grid;gap:10px;align-content:start;
    grid-template-columns:repeat(auto-fill,minmax(170px,1fr));}
.pm-gallery-grid.pm-gallery-s{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;}
.pm-gallery-grid.pm-gallery-l{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
/* 滚动条: 平时完全隐藏, 鼠标划过网格或滚滚轮时才显示 */
.pm-gallery-grid{scrollbar-width:thin;scrollbar-color:transparent transparent;}
.pm-gallery-grid.pm-scroll-visible,.pm-gallery-grid:hover{scrollbar-color:rgba(255,255,255,.38) transparent;}
.pm-gallery-grid::-webkit-scrollbar{width:10px;}
.pm-gallery-grid::-webkit-scrollbar-track{background:transparent;}
.pm-gallery-grid::-webkit-scrollbar-thumb{background:transparent;border:2px solid transparent;
    border-radius:6px;background-clip:padding-box;transition:background .18s ease;}
.pm-gallery-grid.pm-scroll-visible::-webkit-scrollbar-thumb,
.pm-gallery-grid:hover::-webkit-scrollbar-thumb{background:rgba(255,255,255,.38);
    background-clip:padding-box;border:2px solid transparent;border-radius:6px;}
.pm-gallery-cell{position:relative;border:1px solid #343434;border-radius:8px;overflow:hidden;
    background:#000;cursor:pointer;transition:border-color .15s ease;}
.pm-gallery-cell:hover{border-color:#2f6fdd;}
/* 正方形不靠 CSS 技巧 (aspect-ratio / padding-top 在部分内核的自动行高 grid 里会把
   格子高度塌陷成横条), 由 JS 把 grid-auto-rows 设成实测列宽, 行高=列宽必为正方形 */
/* contain: 图片完整显示居中, 不足处黑色填充 (不裁剪) */
.pm-gallery-img{width:100%;height:100%;object-fit:contain;display:block;background:#000;}
.pm-gallery-img.pm-gallery-err{opacity:.22;}
/* 缩略图右下角的删除按钮 (移入回收站): 默认隐藏, 鼠标移到该缩略图上才显示 */
.pm-gallery-del{all:unset;box-sizing:border-box;position:absolute;bottom:4px;right:4px;
    width:24px;height:24px;display:flex;align-items:center;justify-content:center;
    border-radius:6px;cursor:pointer;color:#f0f0f0;background:rgba(0,0,0,.55);
    opacity:0;visibility:hidden;pointer-events:none;
    transition:background .15s ease,color .15s ease,opacity .15s ease,visibility .15s ease;}
.pm-gallery-cell:hover .pm-gallery-del,
.pm-gallery-del:focus-visible{opacity:1;visibility:visible;pointer-events:auto;}
.pm-gallery-del:hover{background:#c02d2d;color:#fff;opacity:1;visibility:visible;pointer-events:auto;}
.pm-gallery-del:disabled{opacity:.4;cursor:default;}
.pm-gallery-del svg{width:14px;height:14px;}
.pm-gallery-empty{grid-column:1/-1;padding:40px 0;text-align:center;color:#7c7c7c;font-size:12.5px;}
/* 图库设置对话框: 目录选择行 + 自定义路径 + 文件夹浏览列表 */
.pm-dir-rows{display:flex;flex-direction:column;gap:2px;}
.pm-dir-row{text-align:left;width:100%;}
.pm-dir-row-on{color:#8ab4ff;}
/* 自定义目录列表: 左侧多选列表 + 右侧按钮列 */
.pm-dir-custom{display:flex;gap:8px;align-items:stretch;margin-top:6px;}
.pm-dir-list{flex:1;min-width:0;background:#1b1b1b;color:#e8e8e8;border:1px solid #3a3a3a;
    border-radius:6px;padding:4px;font-size:12px;font-family:inherit;}
.pm-dir-list option{padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-dir-btns{display:flex;flex-direction:column;gap:6px;justify-content:center;}
.pm-dir-path{font-size:11.5px;color:#9a9a9a;word-break:break-all;}
.pm-dirlist{max-height:260px;overflow:auto;border:1px solid #3a3a3a;border-radius:6px;
    padding:4px;background:#171717;}
.pm-dir-item{padding:5px 8px;border-radius:5px;cursor:pointer;font-size:12.5px;color:#ccc;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pm-dir-item:hover{background:#2b2b2b;color:#fff;}
.pm-dir-up{color:#8ab4ff;}
.pm-dir-empty{padding:10px;text-align:center;color:#7c7c7c;font-size:12.5px;}
.pm-gallery-foot{flex:0 0 auto;padding:7px 14px;font-size:11.5px;color:#8b8b8b;
    border-top:1px solid #343434;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* 查看器窗口固定大小, 不随图片比例跳动 */
.pm-gallery-viewer-box{position:relative;width:94vw;height:92vh;display:flex;
    flex-direction:row;align-items:stretch;gap:12px;padding:10px;}
.pm-gallery-viewer-left{position:relative;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;
    align-items:stretch;gap:8px;justify-content:center;}
.pm-gallery-viewer-img{flex:1 1 auto;min-height:0;width:100%;object-fit:contain;border-radius:8px;
    background:#111;box-shadow:0 12px 40px rgba(0,0,0,.7);}
.pm-gallery-viewer-cap{flex:0 0 auto;font-size:12px;color:#c8c8c8;max-width:100%;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;text-align:center;}
.pm-gallery-viewer-x{position:absolute;top:2px;right:2px;z-index:2;background:rgba(0,0,0,.45);}
.pm-gallery-viewer-nav{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);
    width:34px;height:52px;display:flex;align-items:center;justify-content:center;font-size:24px;
    border-radius:8px;cursor:pointer;color:#ddd;background:rgba(0,0,0,.35);}
.pm-gallery-viewer-side{flex:0 0 300px;display:flex;flex-direction:column;
    background:#232323;border:1px solid #3a3a3a;border-radius:10px;overflow:hidden;}
.pm-gallery-viewer-side-head{flex:0 0 auto;padding:9px 12px 7px;font-size:13px;color:#eee;
    font-weight:600;border-bottom:1px solid #383838;}
.pm-gallery-viewer-side-info{flex:0 0 auto;padding:6px 12px;font-size:11.5px;color:#8fd0a0;}
.pm-gallery-viewer-side-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;
    padding:8px 12px 12px;}
.pm-gallery-viewer-side-params{flex:0 0 auto;display:flex;flex-direction:column;
    padding:9px 12px 12px;border-top:1px solid #383838;background:#232323;}
.pm-meta-card{background:#2b2b2b;border:1px solid #3d3d3d;border-radius:8px;
    padding:8px 10px;margin-bottom:8px;flex:1 1 0;min-height:110px;
    display:flex;flex-direction:column;overflow:hidden;}
.pm-meta-row{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 8px;margin-bottom:6px;}
.pm-meta-tag{display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;
    color:#9fd0ff;background:rgba(80,140,255,.14);border:1px solid rgba(80,140,255,.3);}
.pm-meta-copy{all:unset;box-sizing:border-box;flex:0 0 auto;padding:3px 9px;font-size:11px;
    border:1px solid #4a4a4a;border-radius:6px;color:#a8d8b0;cursor:pointer;white-space:nowrap;}
.pm-meta-copy:hover{border-color:#6b9b78;background:rgba(90,200,120,.12);color:#bceac6;}
.pm-meta-text{flex:1 1 auto;min-height:0;font-size:12px;color:#cfcfcf;line-height:1.6;white-space:pre-wrap;
    word-break:break-word;overflow-y:auto;padding-right:2px;}
.pm-meta-text::-webkit-scrollbar{width:6px;}
.pm-meta-text::-webkit-scrollbar-thumb{background:#454545;border-radius:3px;}
.pm-meta-reserve{flex:0 0 96px;margin-bottom:8px;}
.pm-meta-params{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.pm-meta-param{background:#2b2b2b;border:1px solid #3d3d3d;border-radius:8px;
    padding:7px 10px;min-width:0;}
.pm-meta-param-k{font-size:10.5px;color:#8b8b8b;margin-bottom:3px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-meta-param-v{font-size:12.5px;font-weight:700;color:#f0f0f0;word-break:break-all;}
.pm-meta-empty{padding:26px 4px;text-align:center;color:#7c7c7c;font-size:12px;line-height:1.7;}
.pm-gallery-viewer-nav:hover{background:rgba(47,111,221,.55);color:#fff;}
.pm-gallery-viewer-nav.pm-gallery-prev{left:10px;}
.pm-gallery-viewer-nav.pm-gallery-next{right:10px;}
.pm-settings-label{font-size:11px;color:#7c7c7c;cursor:default;padding:4px 10px 2px;}
.pm-settings-label:hover{background:transparent;color:#7c7c7c;}
.pm-settings-menu{position:fixed;z-index:100100;min-width:190px;padding:5px;
    background:#2c2c2c;border:1px solid #3d3d3d;border-radius:9px;
    box-shadow:0 10px 30px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:2px;
    animation:pm-pop .12s ease;}
.pm-settings-item{all:unset;box-sizing:border-box;padding:8px 12px;font-size:12.5px;
    color:#e0e0e0;border-radius:6px;cursor:pointer;white-space:nowrap;text-align:left;
    transition:background .12s ease,color .12s ease;}
.pm-settings-item:hover{background:#2f6fdd;color:#fff;}
/* 提示词库对话框 (顶栏 ⚙) 里的导入/导出卡片: 中性灰, 不带彩色 */
.pm-lib-item{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;
    background:#2b2b2b;border:1px solid #3d3d3d;border-radius:8px;padding:10px 12px;
    margin-bottom:8px;cursor:pointer;transition:background .15s ease,border-color .15s ease;}
.pm-lib-item:hover{background:rgba(255,255,255,.06);border-color:#4f4f4f;}
.pm-lib-item-icon{flex:0 0 26px;width:26px;height:26px;display:flex;align-items:center;
    justify-content:center;border-radius:6px;color:#b6b6b6;background:rgba(255,255,255,.05);}
.pm-lib-item-icon svg{width:15px;height:15px;}
.pm-lib-item:hover .pm-lib-item-icon{color:#fff;}
.pm-lib-item-txt{min-width:0;}
.pm-lib-item-t{font-size:13px;color:#e0e0e0;font-weight:600;margin-bottom:2px;}
.pm-lib-item-d{font-size:11px;color:#8b8b8b;line-height:1.5;}
.pm-dialog-close svg,.pm-item-del svg{width:15px;height:15px;}
.pm-dialog-search{padding:10px 14px 6px;}
.pm-dialog-body input,.pm-dialog-body textarea,.pm-dialog-body select{width:100%;box-sizing:border-box;padding:7px 10px;
    font-size:13px;color:#e8e8e8;background:#1b1b1b;border:1px solid #3d3d3d;border-radius:7px;
    outline:none;transition:border-color .15s ease;font-family:inherit;}
.pm-dialog-body input:focus,.pm-dialog-body textarea:focus,.pm-dialog-body select:focus{border-color:#6b6b6b;}
.pm-dialog-new{width:520px;max-width:92vw;}
.pm-new-field{margin-bottom:12px;}
.pm-new-label{font-size:11.5px;color:#8b8b8b;margin-bottom:5px;}
.pm-new-body textarea{resize:vertical;min-height:120px;line-height:1.5;}
.pm-new-actions{padding:0 14px 14px;}
.pm-dialog-conflict{width:560px;max-width:92vw;max-height:80vh;}
.pm-conflict-body{flex:1;min-height:0;}
.pm-conflict-list{flex:1;min-height:0;overflow-y:auto;padding:2px;
    display:flex;flex-direction:column;gap:8px;}
.pm-conflict-list::-webkit-scrollbar{width:8px;}
.pm-conflict-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-conflict-card{border:1px solid #343434;border-radius:8px;padding:8px 10px;background:#2a2a2a;
    display:flex;flex-direction:column;gap:5px;}
.pm-conflict-name{font-size:12.5px;color:#ededed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-conflict-pre{font-size:11.5px;color:#8b8b8b;line-height:1.5;max-height:32px;overflow:hidden;}
.pm-conflict-actions{padding:0 14px 14px;}
.pm-dialog-hint{padding:2px 14px 8px;font-size:11.5px;color:#8b8b8b;}
.pm-dialog-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px;}
.pm-dialog-body .pm-dialog-hint{padding:0;}
.pm-dialog-actions{display:flex;justify-content:flex-end;gap:8px;}
.pm-btn{padding:6px 18px;border-radius:7px;border:1px solid #3d3d3d;background:#333;
    color:#ddd;cursor:pointer;font-size:13px;transition:background .15s ease,border-color .15s ease;}
.pm-btn:hover{background:#3f3f3f;}
.pm-btn-primary{background:#2f6fdd;border-color:#2f6fdd;color:#fff;}
.pm-btn-primary:hover{background:#3d7ce8;}
.pm-dialog-list{flex:1;overflow-y:auto;padding:4px 8px 10px;}
.pm-dialog-list::-webkit-scrollbar{width:8px;}
.pm-dialog-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-dialog-list::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28);}
.pm-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;
    cursor:pointer;transition:background .12s ease;}
.pm-item:hover{background:rgba(255,255,255,.08);}
.pm-item-main{flex:1;min-width:0;}
.pm-item-name{font-size:13px;color:#ededed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-item-preview{font-size:11.5px;color:#8a8a8a;margin-top:2px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-item-del{all:unset;box-sizing:border-box;flex:0 0 auto;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#8a8a8a;
    opacity:0;transition:opacity .15s ease,background .15s ease,color .15s ease;}
.pm-item:hover .pm-item-del{opacity:1;}
.pm-item-del:hover{background:rgba(220,80,80,.22);color:#ff8a8a;}
.pm-item-move:hover{background:rgba(47,111,221,.22);color:#9fd0ff;}
.pm-item-rename:hover{background:rgba(90,200,120,.2);color:#8ee6a5;}
.pm-move-cats{max-height:200px;overflow-y:auto;padding:2px;}
.pm-move-cats::-webkit-scrollbar{width:8px;}
.pm-move-cats::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-move-cats .pm-tab{display:inline-block;margin:2px;}
.pm-item-cat{display:inline-block;align-self:flex-start;margin-top:3px;padding:1px 7px;
    font-size:11px;color:#9a9a9a;background:rgba(255,255,255,.07);
    border:1px solid rgba(255,255,255,.08);border-radius:5px;}
.pm-empty{padding:30px 12px;text-align:center;font-size:12.5px;color:#7d7d7d;line-height:1.7;}
.pm-cat-bar{display:flex;align-items:center;gap:2px;padding:0 14px 6px;overflow-x:auto;}
.pm-cat-bar::-webkit-scrollbar{height:0;}
.pm-tab{all:unset;box-sizing:border-box;position:relative;padding:6px 11px;font-size:12.5px;
    color:#9a9a9a;cursor:pointer;white-space:nowrap;border-radius:6px;
    transition:color .15s ease,background .15s ease;}
.pm-tab:hover{color:#e8e8e8;background:rgba(255,255,255,.06);}
.pm-tab-on{color:#fff;}
.pm-tab-on::after{content:"";position:absolute;left:9px;right:9px;bottom:-2px;height:2px;
    border-radius:2px;background:#2f6fdd;}
.pm-tab-add{color:#8a8a8a;font-size:14px;padding:6px 9px;}
.pm-tab-add:hover{color:#9fd0ff;}
.pm-tab-manage{display:flex;align-items:center;padding:6px 8px;color:#8a8a8a;}
.pm-tab-manage:hover{color:#fff;}
.pm-tab-manage svg{width:13px;height:13px;}
.pm-cat-manage-list{max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;
    padding:2px;}
.pm-cat-manage-list::-webkit-scrollbar{width:8px;}
.pm-cat-manage-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-cat-man-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;
    background:#2a2a2a;border:1px solid #3d3d3d;}
.pm-cat-man-row:hover{border-color:#5a5a5a;}
.pm-cat-man-name{flex:1;min-width:0;font-size:12.5px;color:#e8e8e8;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-cat-man-btn{all:unset;box-sizing:border-box;flex:0 0 auto;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#b6b6b6;
    transition:background .15s ease,color .15s ease;}
.pm-cat-man-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-cat-man-btn svg{width:14px;height:14px;}
.pm-cat-man-btn-off{opacity:.3;cursor:default;}
.pm-cat-man-btn-off:hover{background:transparent;color:#b6b6b6;}
.pm-choice-btns{display:flex;flex-direction:column;gap:6px;}
.pm-choice-btn{width:100%;}
.pm-btn-danger{background:#b33;border-color:#b33;color:#fff;}
.pm-btn-danger:hover{background:#c44;}
.pm-save-cats{padding:0;flex:1;min-width:0;margin-left:-8px;display:flex;flex-wrap:wrap;
    row-gap:2px;max-height:96px;overflow-y:auto;}
.pm-save-cats::-webkit-scrollbar{width:6px;}
.pm-save-cats::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:3px;}
.pm-save-cats .pm-tab{padding:5px 10px;font-size:12px;}
.pm-cat-group{padding:8px 10px 4px;font-size:11.5px;color:#9fd0ff;letter-spacing:.3px;}
.pm-save-row{display:flex;align-items:center;gap:8px;}
.pm-save-label{flex:0 0 36px;font-size:12.5px;color:#bbb;}
.pm-save-row input{flex:1;min-width:0;}
/* ===== 工具条设置面板 ===== */
.pm-set-row{display:flex;align-items:center;gap:10px;font-size:13px;color:#ddd;}
.pm-set-label{flex:0 0 auto;width:56px;color:#bbb;white-space:nowrap;}
.pm-set-row input[type="range"]{flex:1;accent-color:#2f6fdd;cursor:pointer;}
.pm-set-val{flex:0 0 42px;text-align:right;color:#9fd0ff;font-size:12.5px;font-variant-numeric:tabular-nums;}
.pm-positions{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1;min-width:0;}
.pm-pos-opt{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;
    gap:8px;font-size:12.5px;color:#ccc;cursor:pointer;white-space:nowrap;
    padding:6px 10px;border:1px solid #3d3d3d;border-radius:7px;
    transition:border-color .15s ease,background .15s ease;}
.pm-pos-opt input{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:#2f6fdd;}
.pm-pos-opt:hover{border-color:#5a5a5a;}
.pm-pos-opt:has(input:checked){border-color:#2f6fdd;background:rgba(47,111,221,.18);color:#fff;}
.pm-pos-opt input{accent-color:#2f6fdd;margin:0;}
`;
    document.head.appendChild(style);
}

function createToolbarElement(actions) {
    ensureStyles();

    const wrap = document.createElement("div");
    wrap.className = "pm-toolbar";

    const pill = document.createElement("div");
    pill.className = "pm-pill";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "pm-trigger";
    trigger.title = "提示词工具";
    trigger.innerHTML = PM_ICONS.trigger;
    trigger.addEventListener("mousedown", (e) => e.preventDefault());
    trigger.addEventListener("click", (e) => e.stopPropagation());
    pill.appendChild(trigger);

    actions.forEach(([icon, tip, cb]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = tip;
        btn.innerHTML = icon;

        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            cb();
        });
        pill.appendChild(btn);
    });

    const gearDivider = document.createElement("span");
    gearDivider.className = "pm-actions-divider";
    pill.appendChild(gearDivider);
    const gearBtn = document.createElement("button");
    gearBtn.type = "button";
    gearBtn.className = "pm-gear";
    gearBtn.title = "工具条设置 (透明度 / 显示位置)";
    gearBtn.innerHTML = PM_ICONS.gear;
    gearBtn.addEventListener("mousedown", (e) => e.preventDefault());
    gearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsDialog();
    });
    pill.appendChild(gearBtn);

    wrap.appendChild(pill);
    return { el: wrap, pill };
}

function findTextWidgetEl(node, widget) {

    const w = resolveDeepestWidget(widget);
    const direct = w.inputEl || w.element;
    if (direct && direct.tagName === "TEXTAREA" && direct.isConnected) return direct;

    let nodeEl = null;
    try {
        nodeEl = document.querySelector(`[data-node-id="${node.id}"]`);
    } catch (e) {

    }
    if (!nodeEl) return null;

    const allText = (node.widgets || []).filter(
        (x) => !x.hidden && x.type !== "hidden" && isTextWidget(x)
    );
    let idx = allText.indexOf(widget);
    if (idx === -1) {

        idx = allText.findIndex((x) => resolveDeepestWidget(x) === w);
    }
    if (idx === -1 && widget.sourceNodeId && widget.sourceWidgetName) {

        idx = allText.findIndex(
            (x) =>
                x.sourceNodeId === widget.sourceNodeId &&
                x.sourceWidgetName === widget.sourceWidgetName
        );
    }
    if (idx === -1 && widget.name) {
        idx = allText.findIndex((x) => x.name === widget.name);
    }

    const prime = Array.from(nodeEl.querySelectorAll("textarea.p-textarea"));
    const tas = prime.length ? prime : Array.from(nodeEl.querySelectorAll("textarea"));
    if (idx >= 0 && idx < tas.length) return tas[idx];

    return tas.find((ta) => !ta._pmToolbarMounted) || null;
}

function tryMountToolbar(node, widget, el) {
    if (!widget) return false;

    const ta = findTextWidgetEl(node, widget);
    let host = null;

    if (ta) {
        host = ta.closest(".p-floatlabel, [class*='floatlabel']") || ta.parentElement;
    } else {

        let p = (widget.inputEl || widget.element)?.parentElement || null;
        while (p) {
            if (p.classList && p.classList.contains("dom-widget")) {
                host = p;
                break;
            }
            p = p.parentElement;
        }
    }

    if (!host) return false;

    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    if (el.parentElement !== host) host.appendChild(el);
    if (ta) ta._pmToolbarMounted = true;
    el.classList.remove("pm-anchor");
    el.style.zIndex = "20";
    return true;
}

async function mountToolbar(node, widget, el) {
    const delays = [0, 80, 200, 400, 800, 1500, 2500];
    for (const d of delays) {
        if (d) await new Promise((r) => setTimeout(r, d));
        if (tryMountToolbar(node, widget, el)) {
            console.log(
                `[PromptManager] 工具条已挂载 (节点: ${node.title || node.type}, 控件: ${widget.name})`
            );
            return true;
        }
    }
    return false;
}

function keepToolbarMounted(node, widget, el) {
    const timer = setInterval(() => {
        if (el.isConnected) return;
        if (!node.graph) {
            clearInterval(timer);
            return;
        }
        tryMountToolbar(node, widget, el);
    }, 1500);
}

function addToolbarToTextarea(node, ta) {
    if (!node || !ta || !ta.isConnected) return;
    const host = ta.closest(".p-floatlabel, [class*='floatlabel']") || ta.parentElement;
    if (!host) return;
    if (host.querySelector(".pm-toolbar")) return;
    const toolbar = createToolbarElement(makeToolbarButtons({ node, textarea: ta }));
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(toolbar.el);
    ta._pmToolbarMounted = true;
    toolbar.el.classList.remove("pm-anchor");
    toolbar.el.style.zIndex = "20";
    const timer = setInterval(() => {
        if (toolbar.el.isConnected) return;
        if (!node.graph || !ta.isConnected) {
            clearInterval(timer);
            return;
        }
        const h =
            ta.closest(".p-floatlabel, [class*='floatlabel']") || ta.parentElement;
        if (h && !h.querySelector(".pm-toolbar")) {
            if (getComputedStyle(h).position === "static")
                h.style.position = "relative";
            h.appendChild(toolbar.el);
        }
    }, 1500);
}

function sweepTextareas() {
    try {
        const tas = document.querySelectorAll(
            "[data-node-id] textarea, .dom-widget textarea"
        );
        for (const ta of tas) {
            if (!ta.isConnected || ta._pmToolbarMounted) continue;
            const nodeEl = ta.closest("[data-node-id]");
            const domWidget = ta.closest(".dom-widget");
            if (!nodeEl && !domWidget) continue;
            const nodeId = nodeEl ? parseInt(nodeEl.dataset.nodeId, 10) : NaN;
            const node = Number.isFinite(nodeId)
                ? app.graph?.getNodeById?.(nodeId)
                : null;
            if (!node) continue;
            const widget = (node.widgets || []).find((w) => {
                const r = resolveDeepestWidget(w);
                return r.inputEl === ta || r.element === ta;
            });
            if (widget) {
                addToolbar(node, widget);
            } else {
                addToolbarToTextarea(node, ta);
            }
        }
    } catch (e) {}
}

setInterval(sweepTextareas, 1500);

