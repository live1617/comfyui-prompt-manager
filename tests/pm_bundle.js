// 把 web/ 下的 ES 模块按依赖顺序拼成一段普通脚本, 供 vm 桩测试直接 runInContext
//
// 为什么要拼: ComfyUI 会把 web/ 里每个 .js 都当独立扩展 import, 浏览器自己解析
// import/export; 但 node 的 vm 不认模块语法。所以测试里按拓扑序拼成一个大字符串,
// 效果等价于浏览器加载完所有模块后的状态。
//
// 用法:
//   const { buildBundle } = require("./pm_bundle.js");
//   const src = buildBundle(path.join(__dirname, "..", "web"));
const fs = require("fs");
const path = require("path");

const ENTRY = "prompt_manager.js";

// 匹配: import { a, b as c } from "./x.js";  /  import X from "..."  /  import * as X
const IMPORT_RE = /import\s+(?:[\s\S]*?)\s+from\s*["']([^"']+)["'];?/g;

function readFile(p) {
    return fs.readFileSync(p, "utf8");
}

/** 抽出一个文件里 import 的本地模块名 (只保留 ./ 开头的相对路径) */
function localImports(src) {
    const out = [];
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
        const spec = m[1];
        if (spec.startsWith("./")) {  // 只认同目录的插件内部模块, ../../scripts/app.js 是 ComfyUI 的
            const base = path.basename(spec);
            if (!out.includes(base)) out.push(base);
        }
    }
    return out;
}

/** 抽出一个文件里 import 的名字列表 (用于 export 对账) */
function importedNames(src) {
    const out = [];
    const re = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g;
    let m;
    while ((m = re.exec(src))) {
        for (const raw of m[1].split(",")) {
            const t = raw.trim();
            if (!t) continue;
            const parts = t.split(/\s+as\s+/);
            out.push({ name: parts[0].trim(), from: m[2] });
        }
    }
    return out;
}

/** 抽出一个文件导出的名字 (export function/const/let/class 与 export { ... }) */
function exportedNames(src) {
    const out = new Set();
    const re1 = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re1.exec(src))) out.add(m[1]);
    const re2 = /export\s*\{([^}]*)\}/g;
    while ((m = re2.exec(src))) {
        for (const raw of m[1].split(",")) {
            const t = raw.trim();
            if (!t) continue;
            out.add(t.split(/\s+as\s+/).pop().trim());
        }
    }
    return out;
}

/** 从入口出发做 DFS, 返回拓扑序 (依赖在前) + 环检测 */
function resolveOrder(webDir) {
    const order = [];
    const seen = new Set();
    const stack = new Set();

    function visit(file, trail) {
        if (seen.has(file)) return;
        if (stack.has(file)) {
            throw new Error("模块循环依赖: " + trail.concat(file).join(" -> "));
        }
        stack.add(file);
        const full = path.join(webDir, file);
        if (!fs.existsSync(full)) {
            throw new Error(`入口 ${path.basename(trail[0] || file)} 引用了不存在的文件: ${file}`);
        }
        for (const dep of localImports(readFile(full))) visit(dep, trail.concat(file));
        stack.delete(file);
        seen.add(file);
        order.push(file);
    }

    visit(ENTRY, []);
    return order;
}

/**
 * 拼出可在 vm 里跑的脚本
 * @param {string} webDir web 目录绝对路径
 * @returns {{code: string, files: string[]}}
 */
function buildBundle(webDir) {
    const files = resolveOrder(webDir);
    const chunks = files.map((f) => {
        const raw = readFile(path.join(webDir, f));
        const stripped = raw
            // 去掉 import 语句 (含跨行的)
            .replace(/^import\s+[^;]*;/gm, "")
            // export function/const/... -> 普通声明
            .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, "")
            // export { a, b }; -> 删掉
            .replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
        return `/* ===== ${f} ===== */\n${stripped}`;
    });
    return { code: chunks.join("\n\n"), files };
}

module.exports = { buildBundle, localImports, importedNames, exportedNames, resolveOrder, ENTRY };
