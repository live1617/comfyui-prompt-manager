// 用 acorn 找出 web/ 下"声明后从未被读取"的标识符候选 (辅助分析工具, 不是断言测试)
// 依赖是可选的: 没装 acorn 就跳过, 不让本地/CI 因环境差异失败
let acorn, walk;
try {
    acorn = require("acorn");
    walk = require("acorn-walk");
} catch (e) {
    console.log("跳过未使用标识符扫描: 未找到 acorn / acorn-walk");
    console.log("(装上后可运行: npm i -D acorn acorn-walk)");
    process.exit(0);
}
const fs = require("fs");
const path = require("path");

const { buildBundle } = require("./pm_bundle.js");
const src = buildBundle(path.join(__dirname, "..", "web")).code;
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "module", locations: true });

// 统计每个名字的 Identifier 节点数 (全文件近似, 阴影变量可能漏报但不会误报"仅用1次")
const counts = new Map();
walk.full(ast, (n) => {
    if (n.type === "Identifier") {
        counts.set(n.name, (counts.get(n.name) || 0) + 1);
    }
});

const declared = [];
walk.full(ast, (n) => {
    const add = (name, kind, loc) => {
        if (!name || counts.get(name) > 1) return;
        declared.push({ name, kind, line: loc ? loc.start.line : 0 });
    };
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init) {
        add(n.id.name, "var", n.id.loc);
    }
    if (n.type === "FunctionDeclaration" && n.id) add(n.id.name, "fn", n.id.loc);
});

// 函数参数: 单独收集 (参数不计入上面的 init 分支)
walk.full(ast, (n) => {
    if (
        (n.type === "FunctionDeclaration" ||
            n.type === "FunctionExpression" ||
            n.type === "ArrowFunctionExpression") &&
        n.params
    ) {
        for (const p of n.params) {
            if (p.type === "Identifier" && counts.get(p.name) <= 1) {
                declared.push({ name: p.name, kind: "param", line: p.loc.start.line });
            }
        }
    }
    if (n.type === "CatchClause" && n.param && n.param.type === "Identifier") {
        // catch(e) 空 catch 是本项目有意为之, 不算冗余, 跳过
    }
});

// 过滤: 回调参数常用 _ 前缀约定; 还有对象解构属性 shorthand 会算进 counts 两次, 已在上面规避
const seen = new Set();
for (const d of declared) {
    const k = d.name + "@" + d.line;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`${d.kind.padEnd(6)} ${d.name.padEnd(28)} 第${d.line}行`);
}
console.log(`\n共 ${seen.size} 个候选`);
