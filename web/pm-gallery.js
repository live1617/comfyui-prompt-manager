// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 图库: 网格弹窗 / 大图查看器 / 缩略图与设置 / 目录浏览

import { app } from "../../scripts/app.js";
import { PM_ICONS, PM_VERSION, apiGet, apiPost, copyToClipboard, flashCopyButton, toast } from "./pm-core.js";
import { pmBrowseDirDialog, pmChoiceDialog } from "./pm-dialogs.js";
import { saveWithDialog } from "./pm-save.js";
import { ensureStyles } from "./pm-styles.js";
/* ===== 图库: 常驻缩略图窗口 (只能通过右上角 X 关闭) ===== */
export const PM_GALLERY_KEY = "pm.gallery.settings";

// 图库缩略图显示上限: 0 = 全部 (不限); 默认 300
export const PM_GALLERY_LIMIT = 300;

export const PM_GALLERY_LIMITS = [
    [100, "100 张"],
    [300, "300 张"],
    [500, "500 张"],
    [1000, "1000 张"],
    [0, "全部 (不限)"],
];

export let _pmGallery = null;

export let _pmGalleryMenu = null;

export function pmGallerySettings() {
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
        // 缩略图显示上限 (0 = 不限)
        limit: PM_GALLERY_LIMITS.some(([v]) => v === s.limit)
            ? s.limit
            : PM_GALLERY_LIMIT,
    };
}

export function pmSaveGallerySettings(s) {
    try {
        localStorage.setItem(PM_GALLERY_KEY, JSON.stringify(s));
    } catch (e) {
    }
}

export function closeGalleryDialog() {
    closeGallerySettingsMenu();
    if (!_pmGallery) return;
    const g = _pmGallery;
    _pmGallery = null;
    try {
        g.mask.remove();
    } catch (e) {
    }
}

export function closeGallerySettingsMenu() {
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
export function toggleGallerySettings(anchor, groups, onChange) {
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
export function pmRootArg(it) {
    return it && it.type === "custom" && it.root
        ? `&path=${encodeURIComponent(it.root)}`
        : "";
}

export function pmThumbUrl(it) {
    const sub = it.subfolder || "";
    return (
        `/prompt_manager/thumb?type=${it.type || "output"}` +
        `&filename=${encodeURIComponent(it.name)}` +
        `&subfolder=${encodeURIComponent(sub)}&t=${it.mtime || 0}&v=${PM_VERSION}` +
        pmRootArg(it)
    );
}

// 大图查看的图片地址: 自定义目录走 thumb?full=1 (后端已做目录穿越校验)
export function pmFullUrl(it) {
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
export function openGalleryViewer(images, index) {
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

    // 图片自带工作流 / 生成参数时, 这里给出「回填画布」的两个动作
    const sideActions = document.createElement("div");
    sideActions.className = "pm-meta-actions";
    sideActions.style.display = "none";

    const btnLoadWf = document.createElement("button");
    btnLoadWf.type = "button";
    btnLoadWf.className = "pm-meta-copy";
    btnLoadWf.textContent = "载入此图工作流";
    btnLoadWf.title = "把这张图内嵌的工作流回填到画布 (会替换当前画布内容)";
    btnLoadWf.addEventListener("click", async (e) => {
        e.stopPropagation();
        await loadWorkflowOf(images[i]);
    });

    const btnApplyParams = document.createElement("button");
    btnApplyParams.type = "button";
    btnApplyParams.className = "pm-meta-copy";
    btnApplyParams.textContent = "参数套到画布";
    btnApplyParams.title = "只取种子/步数/CFG/降噪/采样/调度, 写到当前画布的采样器节点上";
    btnApplyParams.addEventListener("click", (e) => {
        e.stopPropagation();
        applyParamsToGraph(((currentMeta || {}).params) || []);
    });

    sideActions.append(btnLoadWf, btnApplyParams);

    const sideBody = document.createElement("div");
    sideBody.className = "pm-gallery-viewer-side-body";

    // 底部固定参数栏 (不随提示词滚动, 始终贴着面板底边)
    const sideParams = document.createElement("div");
    sideParams.className = "pm-gallery-viewer-side-params";
    sideParams.style.display = "none";

    side.append(sideHead, sideInfo, sideActions, sideBody, sideParams);

    const metaKey = (it) =>
        `${it.type || "output"}/${it.subfolder || ""}/${it.name}/${it.mtime || 0}`;

    // 参数 key -> 采样器节点上对应的 widget 名
    const PM_PARAM_WIDGETS = {
        seed: ["seed", "noise_seed"],
        steps: ["steps"],
        cfg: ["cfg"],
        denoise: ["denoise"],
        sampler: ["sampler_name"],
        scheduler: ["scheduler"],
    };

    // 只取生成参数, 写到当前画布的采样器节点上 (不动工作流结构)
    const applyParamsToGraph = (params) => {
        const g = app && app.graph;
        const nodes = (g && g._nodes) || [];
        if (!nodes.length) {
            toast("画布上还没有节点", false);
            return;
        }
        let hits = 0;
        for (const n of nodes) {
            const t = String((n && n.type) || "");
            if (!/sampler/i.test(t)) continue;
            for (const p of params || []) {
                const names = PM_PARAM_WIDGETS[p.key];
                if (!names) continue;
                for (const w of n.widgets || []) {
                    if (names.indexOf(w.name) < 0) continue;
                    const num = Number(p.value);
                    // 采样器 widget 本来就是 number; 超大种子会有浮点精度损失, 但这里没有更好的选择
                    w.value =
                        typeof w.value === "number" && !Number.isNaN(num) ? num : p.value;
                    hits++;
                }
            }
        }
        if (!hits) {
            toast("画布上没找到采样器节点", false);
            return;
        }
        try {
            g.setDirtyCanvas(true, true);
        } catch (e) {
        }
        toast(`已把 ${hits} 个参数套到画布上的采样器`);
    };

    const loadWorkflowOf = async (it) => {
        if (!app || typeof app.loadGraphData !== "function") {
            toast("当前 ComfyUI 不支持载入工作流", false);
            return;
        }
        const yes = await pmChoiceDialog(
            "载入工作流",
            "会用这张图内嵌的工作流替换当前画布的内容, 画布上未保存的改动会丢失。",
            ["载入并替换"],
            0,
            100400 // 要高过大图查看器 (100300)
        );
        if (yes !== 0) return;
        try {
            const data = await apiGet(
                `/prompt_manager/workflow?type=${it.type || "output"}` +
                    `&filename=${encodeURIComponent(it.name)}` +
                    `&subfolder=${encodeURIComponent(it.subfolder || "")}` +
                    pmRootArg(it)
            );
            if (!data || !data.workflow) {
                toast("这张图里没有可载入的工作流", false);
                return;
            }
            app.loadGraphData(data.workflow);
            toast("已把这张图的工作流载入画布");
            mask.remove();
        } catch (e) {
            toast(`载入工作流失败: ${e.message}`, false);
        }
    };

    let currentMeta = null;

    const renderMeta = (meta) => {
        currentMeta = meta || null;
        const hasWf = !!(meta && meta.has_workflow);
        const hasParams = ((meta && meta.params) || []).length > 0;
        sideActions.style.display = hasWf || hasParams ? "" : "none";
        btnLoadWf.style.display = hasWf ? "" : "none";
        btnApplyParams.style.display = hasParams ? "" : "none";

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

// 图库设置对话框: 图片目录 (输出 / 输入 / 自定义路径)
export function openGallerySettingsDialog(onApply) {
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

export async function openGalleryDialog() {
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

    // 缩略图按钮: 尺寸 (小/中/大) + 显示上限 (原 ⚙ 设置里的缩略图项)
    const sizeBtn = document.createElement("button");
    sizeBtn.type = "button";
    sizeBtn.className = "pm-dialog-close pm-gallery-size";
    sizeBtn.innerHTML = PM_ICONS.thumbs;
    sizeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    sizeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = pmGallerySettings();
        let needReload = false; // 改上限要重新请求后端, 改尺寸只需重排
        const pick = (v) => ({
            label: v === "s" ? "小" : v === "l" ? "大" : "中",
            on: s.size === v,
            fn: () => pmSaveGallerySettings({ ...pmGallerySettings(), size: v }),
        });
        const pickLimit = (v, label) => ({
            label,
            on: s.limit === v,
            fn: () => {
                pmSaveGallerySettings({ ...pmGallerySettings(), limit: v });
                needReload = true;
            },
        });
        toggleGallerySettings(sizeBtn, [
            { title: "缩略图", options: [pick("s"), pick("m"), pick("l")] },
            {
                title: "显示上限",
                options: PM_GALLERY_LIMITS.map(([v, label]) => pickLimit(v, label)),
            },
        ], () => {
            syncHeadBtns();
            if (needReload) load(); // 上限变了要按新上限重新取图
            else render(); // 只改布局, 不需要重新扫盘
        });
    });

    const syncHeadBtns = () => {
        const s = pmGallerySettings();
        const lim = PM_GALLERY_LIMITS.find(([v]) => v === s.limit);
        orderBtn.title = `排序: ${s.order === "name" ? "按名称" : "最新在前"} (点击选择)`;
        sizeBtn.title =
            `缩略图: ${s.size === "s" ? "小" : s.size === "l" ? "大" : "中"}` +
            ` · 上限 ${lim ? lim[1] : s.limit} (点击选择)`;
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
                `&order=${s.order}&limit=${s.limit}${force ? "&refresh=1" : ""}`;
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
