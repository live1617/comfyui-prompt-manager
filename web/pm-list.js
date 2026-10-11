// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 提示词列表弹窗: 加载 / 分页 / 分类栏 / 查重 / 新建 / 改名 / 移动 / 删除

import { PM_DEFAULT_CATEGORY, PM_ICONS, PM_PAGE_SIZE, apiGet, apiPost, copyToClipboard, pmCategoryOf, pmItemsCacheAdd, pmItemsCacheMerge, pmItemsCacheRemove, pmItemsCacheReset, pmKnownCategories, pmKnownItems, pmServerCategories, setWidgetText, suggestNameForCategory, toast } from "./pm-core.js";
import { closeSettingsMenu, pmChoiceDialog, pmInputDialog } from "./pm-dialogs.js";
import { pmBindHoverPreview, pmHideHoverTip } from "./pm-hover.js";
import { exportPrompts, importPrompts } from "./pm-io.js";
import { closeSaveDialog } from "./pm-save.js";
import { S } from "./pm-state.js";
import { ensureStyles } from "./pm-styles.js";
export function closePromptDialog() {
    pmHideHoverTip();
    if (!S.dialog) return;
    const d = S.dialog;
    S.dialog = null;
    closeSettingsMenu();
    try {
        if (d.onKey) document.removeEventListener("keydown", d.onKey, true);
        d.mask.remove();
    } catch (e) {

    }
}

export function ensureDialogAlive(d) {
    return S.dialog === d && d.mask.isConnected;
}

export async function openPromptDialog(target, mode = "load") {
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
        if (e.key === "Escape" && !S.settingsMenu && !_pmNewPromptOpen) {
            e.stopPropagation();
            closePromptDialog();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) closePromptDialog();
    });

    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const d = {
        mask, dlg, list, catBar: catListWrap, catFoot, search, mode, target,
        items: null, onKey, category: "", extraCats: [], serverCats: [],
        // 分页状态: offset 是已加载条数, hasMore 由服务端告知
        offset: 0, total: 0, hasMore: false, loading: false, q: "",
    };
    S.dialog = d;
    // 别的模块不必反向 import 本模块, 也能关它 / 原地刷新它 (打断模块环)
    d.close = closePromptDialog;
    d.reload = () => reloadDialogItems(d);

    list.addEventListener("scroll", () => {
        pmHideHoverTip();
        pmMaybeLoadMore(d);
    }, { passive: true });
    search.addEventListener("input", () => pmOnDialogSearchInput(d));
    renderDialogList(d);

    await reloadDialogItems(d);
    setTimeout(() => search.focus(), 30);
}

// 搜索: 先本地即时过滤 (输入不卡), 停手 250ms 后再问服务端要完整结果 (分页才准)
export let _pmSearchTimer = null;

export function pmOnDialogSearchInput(d) {
    renderDialogList(d);
    if (_pmSearchTimer) clearTimeout(_pmSearchTimer);
    _pmSearchTimer = setTimeout(() => {
        _pmSearchTimer = null;
        if (!ensureDialogAlive(d)) return;
        reloadDialogItems(d);
    }, 250);
}

export function pmMaybeLoadMore(d) {
    if (!d || !d.hasMore || d.loading) return;
    const el = d.list;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        reloadDialogItems(d, { reset: false });
    }
}

export function pmAllUrl(d, offset) {
    // 关键字 / 分类交给服务端过滤, offset+limit 分页; 服务端都支持, 老版本忽略这些参数也不影响
    const qs = [
        "offset=" + (offset || 0),
        "limit=" + PM_PAGE_SIZE,
        "q=" + encodeURIComponent((d.search && d.search.value ? d.search.value : "").trim()),
    ];
    if (d.category) qs.push("category=" + encodeURIComponent(d.category));
    return "/prompt_manager/all?" + qs.join("&");
}

export async function reloadDialogItems(d, opts) {
    const reset = !opts || opts.reset !== false;
    if (d.loading) return;
    d.loading = true;
    if (reset) d.offset = 0;

    // 服务器分类与提示词并行拉取, 保证分类栏每次刷新都是最新的
    // (否则 extraCats 只在弹窗打开时取一次, 删除/导入后左侧栏会缺分类)
    const serverP = pmServerCategories().catch(() => []);
    let fullLoad = false;
    try {
        const data = await apiGet(pmAllUrl(d, d.offset || 0));
        if (!ensureDialogAlive(d)) return;
        const page = data.items || [];
        d.items = reset ? page : (d.items || []).concat(page);
        d.total = typeof data.total === "number" ? data.total : d.items.length;
        d.hasMore = !!data.has_more;
        d.offset = (d.offset || 0) + page.length;
        // 只有「无筛选且已取完」才算拿到全量, 这时才能刷新全局名称缓存
        fullLoad = !d.hasMore && !d.category && !(d.search && d.search.value || "").trim();
        if (fullLoad) pmItemsCacheReset(d.items);
        else pmItemsCacheMerge(page);
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
            d.total = d.items.length;
            d.hasMore = false;
            pmItemsCacheReset(d.items);
        } catch (e2) {
            if (!ensureDialogAlive(d)) return;
            d.items = [];
            toast(`读取列表失败: ${e2.message}`, false);
        }
    }
    d.loading = false;
    try {
        const server = await serverP;
        if (ensureDialogAlive(d)) {
            d.serverCats = server || [];
            d.extraCats = server.filter(
                (c) => !(d.items || []).some((it) => pmCategoryOf(it) === c)
            );
        }
    } catch (e) {

    }
    renderCategoryBar(d);
    renderDialogList(d);
}

export function renderCategoryBar(d) {
    if (!ensureDialogAlive(d)) return;
    const bar = d.catBar;
    bar.innerHTML = "";
    const items = d.items || [];
    const cats = [];
    const seen = new Set();
    // 分页后 d.items 只有当前分类/当前页, 分类栏要先以服务端的完整分类为准
    for (const c of d.serverCats || d.extraCats || []) {
        if (!seen.has(c)) {
            seen.add(c);
            cats.push(c);
        }
    }
    for (const it of items) {
        const c = pmCategoryOf(it);
        if (!seen.has(c)) {
            seen.add(c);
            cats.push(c);
        }
    }
    if (!items.length && !cats.length) return;
    if (d.category && !seen.has(d.category)) d.category = "";

    const makeTab = (label, value) => {
        const t = document.createElement("button");
        t.type = "button";
        t.className = "pm-tab" + (d.category === value ? " pm-tab-on" : "");
        t.textContent = label;
        t.addEventListener("click", () => {
            if (d.category === value) return;
            d.category = value;
            // 分类也交给服务端过滤 (分页后本地手上只有一部分数据)
            renderCategoryBar(d);
            renderDialogList(d);
            reloadDialogItems(d);
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

export function renderDialogList(d) {
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
        const kw2 = (d.search && d.search.value ? d.search.value : "").trim();
        const empty = document.createElement("div");
        empty.className = "pm-empty";
        empty.textContent =
            kw2 || d.category
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

    if (d.hasMore) {
        const more = document.createElement("div");
        more.className = "pm-list-more";
        more.style.cssText = "padding:12px 0 4px;text-align:center;";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pm-btn";
        btn.textContent = d.loading
            ? "加载中..."
            : `加载更多 (已显示 ${d.items.length} / 共 ${d.total})`;
        btn.addEventListener("click", () => reloadDialogItems(d, { reset: false }));
        more.appendChild(btn);
        list.appendChild(more);
    }
}

export function makeDialogRow(d, item) {
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
export async function openDuplicatesDialog(d) {
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

export async function openCategoryManageDialog(d) {
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

    S.confirmOpen = true;
    let closed = false;
    const finish = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey, true);
        S.confirmOpen = false;
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

export async function openMoveDialog(d, name) {
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

    S.confirmOpen = true;
    const finish = (v) => {
        document.removeEventListener("keydown", onKey, true);
        S.confirmOpen = false;
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

export async function renamePromptWithDialog(d, name) {
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

export async function deletePromptWithConfirm(d, name) {
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

export async function loadPromptInto(target, name) {
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

// 顶栏入口打开的列表没有文本框目标, 点条目改为复制到剪贴板
export async function copyPromptText(name) {
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

// 新建提示词弹窗: 不依赖画布上的文本框, 直接在管理面板里添加一条
export let _pmNewPromptOpen = false;

export async function openNewPromptDialog(d) {
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
