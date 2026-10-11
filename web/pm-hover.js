// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 悬停预览浮层: 鼠标停在条目上先加载内容再显示

import { apiPost } from "./pm-core.js";
/* ===== 悬停预览: 鼠标停在列表某条上, 显示该提示词完整内容 ===== */
export let _pmHoverTip = null;

export let _pmHoverTimer = null;

export const _pmHoverTexts = new Map();

export function pmHideHoverTip() {
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

export function pmPlaceHoverTip(box, anchor, refEl) {
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

export async function pmShowHoverTip(anchor, name, refEl) {
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
export function pmBindHoverPreview(el, name, refEl) {
    el.addEventListener("mouseenter", () => {
        pmHideHoverTip();
        _pmHoverTimer = setTimeout(() => {
            _pmHoverTimer = null;
            pmShowHoverTip(el, name, refEl);
        }, 180);
    });
    el.addEventListener("mouseleave", () => pmHideHoverTip());
}
