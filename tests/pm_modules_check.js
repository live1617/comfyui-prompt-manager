// 拆分后的模块体检: 只做静态检查, 不需要浏览器
//
// 检查项:
//   1. import 的名字必须在目标文件里真的 export (漏 export 在浏览器里直接 ReferenceError)
//   2. 不能有循环依赖
//   3. 除入口文件外, 其它模块不许有顶层副作用
//      (ComfyUI 把每个 js 都单独 import 一次, 顺序不保证, 副作用只能集中在入口)
//   4. web 目录下的 js 必须都被入口引用到 (没有忘接的孤儿文件)
//   5. 拼接后的 bundle 语法能通过 vm 解析
//
// 用法: node pm_modules_check.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "web");
const {
    buildBundle,
    localImports,
    importedNames,
    exportedNames,
    resolveOrder,
    ENTRY,
} = require("./pm_bundle.js");

let failed = 0;
function check(cond, msg) {
    if (cond) {
        console.log(`  ✓ ${msg}`);
    } else {
        console.log(`  ✗ ${msg}`);
        failed++;
    }
}

console.log("模块体检: web/");

// --- 2. 循环依赖 ---
let order = [];
try {
    order = resolveOrder(WEB);
    check(true, `无循环依赖, 加载顺序: ${order.join(" -> ")}`);
} catch (e) {
    check(false, e.message);
}

// --- 1. import / export 对账 ---
const exportsOf = {};
for (const f of order) {
    exportsOf[f] = exportedNames(fs.readFileSync(path.join(WEB, f), "utf8"));
}
let badImports = [];
for (const f of order) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    for (const { name, from } of importedNames(src)) {
        if (from.startsWith("./")) {  // ../../scripts/app.js 是 ComfyUI 的, 不在本目录
            const target = path.basename(from);
            if (!exportsOf[target] || !exportsOf[target].has(name)) {
                badImports.push(`${f} 从 ${target} 引入的 ${name} 没有导出`);
            }
        }
    }
}
check(badImports.length === 0, badImports.length ? badImports.join("; ") : "所有 import 的名字都有对应 export");

// --- 4. 孤儿文件 ---
const allJs = fs.readdirSync(WEB).filter((f) => f.endsWith(".js"));
const orphans = allJs.filter((f) => f !== ENTRY && !order.includes(f));
check(orphans.length === 0, orphans.length ? `未被引用的孤儿文件: ${orphans.join(", ")}` : `web/ 下 ${allJs.length} 个 js 全部可达`);

// --- 3. 顶层副作用只在入口 ---
// 只看缩进 0 的语句: 函数调用 / setInterval / app.registerExtension 等
const SIDE_EFFECT = /^(?!function|const|let|var|class|import|export|\/|\*|\}|\)|;)(?:[A-Za-z_$][\w$.]*\s*\(|setInterval\(|setTimeout\()/;
let sideFiles = [];
for (const f of order) {
    if (f === ENTRY) continue;
    const lines = fs.readFileSync(path.join(WEB, f), "utf8").split("\n");
    const hit = lines.find((l) => SIDE_EFFECT.test(l));
    if (hit) sideFiles.push(`${f}: ${hit.trim().slice(0, 60)}`);
}
check(sideFiles.length === 0, sideFiles.length ? `非入口模块有顶层副作用: ${sideFiles.join(" / ")}` : "非入口模块都没有顶层副作用");

// --- 5. bundle 能被 vm 解析 ---
let code = "";
try {
    code = buildBundle(WEB).code;
    new vm.Script(code, { filename: "bundle.js" });
    check(true, `拼接后 ${code.split("\n").length} 行, 语法可解析`);
} catch (e) {
    check(false, `拼接后语法错误: ${e.message}`);
}

// --- 6. 用到但没 import 的项目符号 ---
// 测试跑的是拼接后的 bundle (所有符号在同一作用域), 所以「忘了 import」在测试里不会暴露,
// 到了浏览器里才是 ReferenceError。这里按命名约定 (PM_ / pmXxx / _pmXxx / 状态对象 S) 反查。
const PROJ_SYM = /(?<![\w$.])(?:_pm[A-Za-z][\w$]*|pm[A-Z][\w$]*|PM[A-Z_][\w$]*|S)(?![\w$])/g;
let missing = [];
for (const f of order) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    const declared = new Set(exportedNames(src));
    // 本文件里的其它顶层声明 (没 export 的也算本地可用)
    for (const m of src.matchAll(/^\s*(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        declared.add(m[1]);
    }
    for (const { name } of importedNames(src)) declared.add(name);
    const used = new Set((src.match(PROJ_SYM) || []));
    for (const u of used) {
        if (!declared.has(u)) missing.push(`${f} 用了 ${u} 但没 import`);
    }
}
check(missing.length === 0, missing.length ? missing.join("; ") : "各模块用到的项目符号都有 import 或本地声明");

// --- 7. ComfyUI 外部依赖 (app / api) 同样必须显式 import ---
// (拆模块时最容易漏的就是这两个: 它们不是插件内部符号, 上面的检查覆盖不到;
//  浏览器里 window.app 有时存在有时不存在, 漏了 import 会变成"某些机器上才报错")
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const missExt = [];
for (const f of order) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    for (const [name, from] of [["app", "../../scripts/app.js"], ["api", "../../scripts/api.js"]]) {
        if (!new RegExp("(?<![\\w$.])" + name + "\\.").test(src)) continue;
        const imported = new RegExp(
            "import\\s*\\{[^}]*\\b" + name + "\\b[^}]*\\}\\s*from\\s*[\"']" + escapeRe(from) + "[\"']"
        ).test(src);
        const local = new RegExp("^\\s*(?:const|let|var|function)\\s+" + name + "\\b", "m").test(src);
        if (!imported && !local) missExt.push(`${f} 用了 ${name}. 但没 import`);
    }
}
check(missExt.length === 0, missExt.length ? missExt.join("; ") : "app / api 都有显式 import");

// --- 8. import 了却没用 (拆分后最容易堆积的垃圾) ---
const deadImports = [];
for (const f of order) {
    const raw = fs.readFileSync(path.join(WEB, f), "utf8");
    const body = raw
        .split("\n")
        .filter((l) => !l.startsWith("import "))
        .join("\n");
    for (const m of raw.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?$/gm)) {
        for (const n of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
            if (!new RegExp("(?<![\\w$.])" + escapeRe(n) + "\\b").test(body)) {
                deadImports.push(`${f}: ${n}`);
            }
        }
    }
}
check(
    deadImports.length === 0,
    deadImports.length ? "死 import: " + deadImports.join(", ") : "没有 import 了却不用的符号"
);

// --- 附加: 入口必须保留 registerExtension ---
const entrySrc = fs.readFileSync(path.join(WEB, ENTRY), "utf8");
check(/app\.registerExtension\(/.test(entrySrc), "入口仍持有 app.registerExtension");

// --- 9. 跨模块导出符号对账 (不依赖命名约定) ---
// 第 6 项按 pmXxx/PM_ 命名约定反查, 漏掉了不带前缀的符号 (v1.4.65 真实事故:
// pm-toolbar.js 用了 pm-list.js 的 openPromptDialog 却没 import, 浏览器里点列表按钮
// 直接 ReferenceError, 而 bundle 测试里所有符号同作用域根本测不出来)。
// 这里换个思路: 只要这个名字被【任何模块 export 过】, 其它模块用它就必须 import 或本地声明。
const crossMiss = [];
for (const f of order) {
    const raw = fs.readFileSync(path.join(WEB, f), "utf8");
    const body = raw
        .split("\n")
        .filter((l) => !l.startsWith("import "))
        .join("\n"); // import 行本身含标识符, 不算「使用」
    const declared = new Set(exportedNames(raw));
    for (const m of raw.matchAll(/^\s*(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        declared.add(m[1]);
    }
    for (const { name } of importedNames(raw)) declared.add(name);
    // 其它模块导出、且本文件没声明的名字
    const foreign = new Set();
    for (const g of order) {
        if (g === f) continue;
        for (const n of exportsOf[g]) foreign.add(n);
    }
    for (const n of foreign) {
        if (declared.has(n)) continue;
        if (new RegExp("(?<![\\w$.])" + escapeRe(n) + "(?![\\w$])").test(body)) {
            crossMiss.push(`${f} 用了 ${n} 但没 import`);
        }
    }
}
check(
    crossMiss.length === 0,
    crossMiss.length ? crossMiss.join("; ") : "跨模块引用的导出符号都有显式 import"
);

console.log(failed ? `\n模块体检失败 ${failed} 项` : "\n模块体检全部通过");
process.exit(failed ? 1 : 0);
