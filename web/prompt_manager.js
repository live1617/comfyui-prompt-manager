import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[PromptManager] 前端扩展 JS 已加载");

const PM_VERSION = "1.1.1";

function toast(msg, ok = true) {
    console.log(`[PromptManager] ${ok ? "✅" : "❌"} ${msg}`);

    const tm = app?.extensionManager;
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
            "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;" +
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
    if (!_pmDialog) return;
    const d = _pmDialog;
    _pmDialog = null;
    try {
        if (d.onKey) document.removeEventListener("keydown", d.onKey, true);
        d.mask.remove();
    } catch (e) {

    }
}

function ensureDialogAlive(d) {
    return _pmDialog === d && d.mask.isConnected;
}

async function openPromptDialog(target, mode = "load") {
    closePromptDialog();
    closeSaveDialog();
    ensureStyles();

    const mask = document.createElement("div");
    mask.className = "pm-mask";

    const dlg = document.createElement("div");
    dlg.className = "pm-dialog";

    const head = document.createElement("div");
    head.className = "pm-dialog-head";
    const title = document.createElement("div");
    title.className = "pm-dialog-title";
    title.textContent = mode === "delete" ? "删除提示词" : "提示词列表";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pm-dialog-close";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = PM_ICONS.close;
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closePromptDialog();
    });
    head.append(title, closeBtn);

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
            : "点击名称即可加载到当前文本框";

    const list = document.createElement("div");
    list.className = "pm-dialog-list";

    dlg.append(head, searchWrap, hint, list);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closePromptDialog();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) closePromptDialog();
    });

    dlg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    const d = { mask, dlg, list, search, mode, target, items: null, onKey };
    _pmDialog = d;

    search.addEventListener("input", () => renderDialogList(d));
    renderDialogList(d);

    await reloadDialogItems(d);
    setTimeout(() => search.focus(), 30);
}

async function reloadDialogItems(d) {
    try {
        const data = await apiGet("/prompt_manager/all");
        if (!ensureDialogAlive(d)) return;
        d.items = data.items || [];
    } catch (e) {

        try {
            const data = await apiGet("/prompt_manager/list");
            if (!ensureDialogAlive(d)) return;
            d.items = (data.names || []).map((n) => ({
                name: n,
                preview: "",
                text_len: 0,
            }));
        } catch (e2) {
            if (!ensureDialogAlive(d)) return;
            d.items = [];
            toast(`读取列表失败: ${e2.message}`, false);
        }
    }
    renderDialogList(d);
}

function renderDialogList(d) {
    if (!ensureDialogAlive(d)) return;
    const list = d.list;
    list.innerHTML = "";

    if (d.items === null) {
        const loading = document.createElement("div");
        loading.className = "pm-empty";
        loading.textContent = "加载中...";
        list.appendChild(loading);
        return;
    }

    const kw = (d.search.value || "").trim().toLowerCase();
    const items = kw
        ? d.items.filter(
              (it) =>
                  (it.name || "").toLowerCase().includes(kw) ||
                  (it.preview || "").toLowerCase().includes(kw)
          )
        : d.items;

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "pm-empty";
        empty.textContent = d.items.length
            ? "没有匹配的提示词"
            : "提示词库还是空的 — 在任意文本框里写好内容后点工具条的保存图标即可";
        list.appendChild(empty);
        return;
    }

    for (const it of items) list.appendChild(makeDialogRow(d, it));
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

    main.append(nameEl, prevEl);

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

    row.append(main, del);
    row.addEventListener("click", async () => {
        if (d.mode === "delete") {
            await deletePromptWithConfirm(d, item.name);
            return;
        }
        await loadPromptInto(d.target, item.name);
        closePromptDialog();
    });
    return row;
}

async function deletePromptWithConfirm(d, name) {
    if (!confirm(`确定删除提示词 "${name}" 吗？此操作不可撤销。`)) return;
    try {
        await apiPost("/prompt_manager/delete", { name });
        toast(`已删除: ${name}`);
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

let _pmSaveDialog = null;
let _lastSaveName = "";

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

function saveWithDialog(target) {
    closePromptDialog();
    closeSaveDialog();
    ensureStyles();

    const text = getWidgetText(target);
    if (!text.trim()) {
        toast("文本框是空的, 没有内容可保存", false);
        return;
    }

    const mask = document.createElement("div");
    mask.className = "pm-mask";
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
    input.value = _lastSaveName;
    const info = document.createElement("div");
    info.className = "pm-dialog-hint";
    info.textContent = `将保存当前文本 (共 ${text.length} 个字符), 同名会覆盖`;
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

    body.append(input, info, actions);
    dlg.append(head, body);
    mask.appendChild(dlg);
    document.body.appendChild(mask);

    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closeSaveDialog();
        }
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("mousedown", (e) => {
        if (e.target === mask) closeSaveDialog();
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
        try {
            await apiPost("/prompt_manager/save", { name, text });
            _lastSaveName = name;
            toast(`已保存: ${name}`);
            closeSaveDialog();
        } catch (e) {
            toast(e.message, false);
        }
    };

    ok.addEventListener("click", doSave);
    cancel.addEventListener("click", () => closeSaveDialog());
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            doSave();
        }
    });

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

function importPrompts() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const form = new FormData();
        form.append("file", file);
        try {
            const res = await api.fetchApi("/prompt_manager/import", {
                method: "POST",
                body: form,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "导入失败");
            toast(`导入完成: 新增/更新 ${data.imported} 条, 跳过 ${data.skipped} 条`);
        } catch (e) {
            toast(e.message, false);
        }
    };
    input.click();
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

app.registerExtension({
    name: "PromptManager.GlobalToolbar",

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
            tooltip: "选择之前导出的 JSON 文件导入, 同名提示词会被覆盖",
        },
    ],

    beforeRegisterNodeDef(nodeType, nodeData) {
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
            PM_ICONS.list,
            "提示词列表 (点击名称即加载)",
            () => openPromptDialog(target, "load"),
        ],

        [
            PM_ICONS.save,
            "保存当前文本到提示词库",
            () => saveWithDialog(target),
        ],
        [
            PM_ICONS.del,
            "删除提示词 (在列表中选择)",
            () => openPromptDialog(target, "delete"),
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

const PM_ICONS = {

    trigger: svgIcon(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`),

    list: svgIcon(
        `<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>` +
            `<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>`
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

    close: svgIcon(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),

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
@keyframes pm-pop{from{transform:translateY(6px) scale(.98);opacity:.6}to{transform:none;opacity:1}}
.pm-dialog-head{display:flex;align-items:center;gap:10px;padding:12px 14px;
    border-bottom:1px solid #343434;background:#282828;}
.pm-dialog-title{flex:1;font-size:14px;font-weight:600;letter-spacing:.3px;}
.pm-dialog-close{all:unset;box-sizing:border-box;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#b6b6b6;
    transition:background .15s ease,color .15s ease;}
.pm-dialog-close:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-dialog-close svg,.pm-item-del svg{width:15px;height:15px;}
.pm-dialog-search{padding:10px 14px 6px;}
.pm-dialog-search input,.pm-dialog-body input{width:100%;box-sizing:border-box;padding:7px 10px;
    font-size:13px;color:#e8e8e8;background:#1b1b1b;border:1px solid #3d3d3d;border-radius:7px;
    outline:none;transition:border-color .15s ease;}
.pm-dialog-search input:focus,.pm-dialog-body input:focus{border-color:#6b6b6b;}
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
.pm-empty{padding:30px 12px;text-align:center;font-size:12.5px;color:#7d7d7d;line-height:1.7;}
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
    trigger.addEventListener("click", (e) => e.stopPropagation());
    pill.appendChild(trigger);

    actions.forEach(([icon, tip, cb], i) => {

        if (i === 1) {
            const divider = document.createElement("span");
            divider.className = "pm-actions-divider";
            pill.appendChild(divider);
        }
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

