// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 节点文本框内的迷你工具条 + 插件设置对话框

import { app } from "../../scripts/app.js";
import { PM_ICONS, PM_LICENSE, PM_MIN_OPACITY, PM_VERSION, applyPmSettings, isTextWidget, pmSettings, resolveDeepestWidget, savePmSettings } from "./pm-core.js";
import { closeSaveDialog, saveWithDialog } from "./pm-save.js";
import { openPromptDialog } from "./pm-list.js";
import { S } from "./pm-state.js";
import { ensureStyles } from "./pm-styles.js";
export function injectToolbars(node, attempt = 0) {
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

export function makeToolbarButtons(target) {
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

export function addToolbar(node, widget) {
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
            // 失败就把登记撤掉: 子图里的节点实例化时 DOM 还没渲染, 7 次重试可能全落空,
            // 撤掉后 sweepTextareas 还能再来一次 (之前会永久标记为已处理 -> 再也不挂)
            delete node._pmToolbars[key];
            console.warn(
                `[PromptManager] 未能挂进文本框 (widget: ${widget.name})`
            );
        }
    });
}

export const PM_POSITIONS = [
    ["tl", "左上"],
    ["tr", "右上"],
    ["bl", "左下 (默认)"],
    ["br", "右下"],
];

export function openSettingsDialog() {
    if (S.dialog) S.dialog.close();
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
    ver.textContent = `Prompt Manager v${PM_VERSION} · ${PM_LICENSE}`;
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

export function createToolbarElement(actions) {
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

export function findTextWidgetEl(node, widget) {

    const w = resolveDeepestWidget(widget);
    const direct = w.inputEl || w.element;
    if (direct && direct.isConnected) {
        if (direct.tagName === "TEXTAREA") return direct;
        // 新版前端的 widget.element 往往是包裹容器, 真正的 textarea 在它里面。
        // 只在容器里恰好只有一个 textarea 时才认 (多个的话无法判断是哪一个, 交给 sweep 反查)
        try {
            const inner = direct.querySelectorAll ? direct.querySelectorAll("textarea") : [];
            if (inner.length === 1) return inner[0];
        } catch (e) {

        }
    }

    let nodeEl = null;
    try {
        nodeEl = document.querySelector(`[data-node-id="${node.id}"]`);
    } catch (e) {

    }
    // 新版 ComfyUI 的节点 DOM 上没有 data-node-id (实测), 这里找不到是正常的,
    // 交给调用方 / sweepTextareas 用其它途径找
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

export function tryMountToolbar(node, widget, el) {
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

export async function mountToolbar(node, widget, el) {
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

export function keepToolbarMounted(node, widget, el) {
    const timer = setInterval(() => {
        if (el.isConnected) return;
        if (!node.graph) {
            clearInterval(timer);
            return;
        }
        tryMountToolbar(node, widget, el);
    }, 1500);
}

export function addToolbarToTextarea(node, ta) {
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

// ---- 遍历所有图 (根图 + 子图) ----
// 子图内部的节点不在 app.graph 里, 拿 id 去根图查是查不到的 —— 这正是子图里
// 工具条一直不显示的原因。app.graph.subgraphs 是 Map<id, Subgraph>,
// 真正装节点的图是 Subgraph.graph; 另外当前打开的子图在 app.canvas.subgraph。
export function pmAllGraphs() {
    const out = [];
    const seen = new Set();
    const visit = (g) => {
        if (!g || seen.has(g)) return;
        seen.add(g);
        out.push(g);
        let subs = null;
        try {
            subs = g.subgraphs;
        } catch (e) {
            return;
        }
        if (!subs) return;
        let arr = [];
        try {
            if (Array.isArray(subs)) arr = subs;
            else if (typeof subs.forEach === "function") {
                arr = [];
                subs.forEach((v) => arr.push(v));
            }
        } catch (e) {
            arr = [];
        }
        for (const s of arr) {
            if (!s) continue;
            // Subgraph 对象用 .graph 拿内部图; 万一传进来的是图本身(有 _nodes)也能兜住
            visit(s.graph || (s._nodes ? s : null));
        }
    };
    try {
        visit(app.graph);
    } catch (e) {

    }
    try {
        const cur = app.canvas && app.canvas.subgraph;
        if (cur) visit(cur.graph || null);
    } catch (e) {

    }
    return out;
}

// ---- 按 textarea 反查它属于哪个节点 (跨所有图) ----
export function pmFindNodeByTextarea(ta) {
    for (const g of pmAllGraphs()) {
        for (const n of g._nodes || []) {
            for (const w of n.widgets || []) {
                let r = null;
                try {
                    r = resolveDeepestWidget(w);
                } catch (e) {
                    continue;
                }
                if (!r) continue;
                if (r.inputEl === ta || r.element === ta) {
                    return { node: n, widget: w };
                }
                const el = r.element;
                try {
                    if (el && typeof el.contains === "function" && el.contains(ta)) {
                        return { node: n, widget: w };
                    }
                } catch (e) {

                }
            }
        }
    }
    return null;
}

export function sweepTextareas() {
    try {
        const tas = document.querySelectorAll(
            "[data-node-id] textarea, .dom-widget textarea"
        );
        for (const ta of tas) {
            if (!ta.isConnected || ta._pmToolbarMounted) continue;
            const nodeEl = ta.closest("[data-node-id]");
            const domWidget = ta.closest(".dom-widget");
            if (!nodeEl && !domWidget) continue;

            // ① 老版 DOM: 按 data-node-id 在根图里查
            const nodeId = nodeEl ? parseInt(nodeEl.dataset.nodeId, 10) : NaN;
            let node = Number.isFinite(nodeId)
                ? app.graph?.getNodeById?.(nodeId)
                : null;
            let widget = null;
            if (node) {
                widget = (node.widgets || []).find((w) => {
                    const r = resolveDeepestWidget(w);
                    return r.inputEl === ta || r.element === ta;
                });
            }
            // ② 新版 DOM 没有 data-node-id, 且子图里的节点不在根图 —— 反查所有图
            if (!node || !widget) {
                const found = pmFindNodeByTextarea(ta);
                if (found) {
                    node = found.node;
                    widget = found.widget;
                }
            }
            if (!node) continue;
            if (widget) {
                addToolbar(node, widget);
            } else {
                addToolbarToTextarea(node, ta);
            }
        }
    } catch (e) {}
}
