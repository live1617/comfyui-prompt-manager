// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 通用对话框原语: 选择 / 输入 / 覆盖确认 / 目录浏览

import { apiGet } from "./pm-core.js";
import { ensureStyles } from "./pm-styles.js";
import { S } from "./pm-state.js";
export function confirmOverwrite(name) {
    return new Promise((resolve) => {
        ensureStyles();
        S.confirmOpen = true;
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
            S.confirmOpen = false;
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

// zIndex 可覆盖: 从大图查看器 (100300) 里弹确认框时必须比它高, 否则看不见
export function pmChoiceDialog(title, message, options, dangerIndex, zIndex) {
    const di = dangerIndex === undefined ? (options || []).length - 1 : dangerIndex;
    return new Promise((resolve) => {
        ensureStyles();
        const mask = document.createElement("div");
        mask.className = "pm-mask";
        mask.style.zIndex = String(zIndex || 100004);
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

export function pmInputDialog(title, placeholder, initial) {
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

// 选择文件夹对话框: 走后端的 /prompt_manager/dirs 逐级浏览本机目录
export function pmBrowseDirDialog(startPath, onPick) {
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

// 关闭顶栏 ⚙ 提示词库菜单 (状态存在 S.settingsMenu; 由 topbar 创建, 这里只负责关)
export function closeSettingsMenu() {
    if (!S.settingsMenu) return;
    const m = S.settingsMenu;
    S.settingsMenu = null;
    try {
        document.removeEventListener("mousedown", m.onOutside, true);
        document.removeEventListener("click", m.onOutside, true);
        document.removeEventListener("keydown", m.onKey, true);
        m.remove();
    } catch (e) {

    }
}
