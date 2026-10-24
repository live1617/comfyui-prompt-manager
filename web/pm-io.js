// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 提示词库导入 / 导出 (JSON 文件)

import { api } from "../../scripts/api.js";
import { PM_DEFAULT_CATEGORY, apiGet, pmItemsCacheReset, toast } from "./pm-core.js";
import { S } from "./pm-state.js";
import { ensureStyles } from "./pm-styles.js";
export async function exportPrompts() {
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
export async function pmImportSubmit(body, isJson) {
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

export function pmImportSummary(t) {
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
export function pmRenameConflictsDialog(conflicts) {
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

export function importPrompts() {
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
export async function pmRefreshAfterImport() {
    try {
        // 管理面板开着 -> 让面板自己原地刷新 (走 S.dialog.reload, 不反向 import 列表模块)
        if (S.dialog && typeof S.dialog.reload === "function") {
            await S.dialog.reload();
            return;
        }
        // 没开面板 -> 只静默刷新工具栏用的缓存
        // 优先用轻量索引接口, 老版本没有就退回 /all
        let data = null;
        try {
            const idx = await apiGet("/prompt_manager/index");
            if (Array.isArray(idx.items)) data = idx;
        } catch (e) {
            // 旧版本没有 /index
        }
        if (!data) data = await apiGet("/prompt_manager/all");
        pmItemsCacheReset(data.items || []);
    } catch (e) {

    }
}
