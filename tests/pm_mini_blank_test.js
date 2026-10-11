// 迷你桩: 验证"空白处点击"能否关闭顶栏浮层和设置菜单
const fs = require("fs"), vm = require("vm"), path = require("path");
const { buildBundle } = require("./pm_bundle.js");
const src = buildBundle(path.join(__dirname, "..", "web")).code;

function El(tag) {
    this.tagName = tag; this.children = []; this.style = { cssText: "" };
    this._listeners = {}; this.className = ""; this.parentElement = null; this.isConnected = true;
    this.addEventListener = (t, fn) => { (this._listeners[t] = this._listeners[t] || []).push(fn); };
    this.removeEventListener = (t, fn) => { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); };
    this.dispatchEvent = (ev) => { ev.target = ev.target || this; (this._listeners[ev.type] || []).slice().forEach((f) => f(ev)); };
    this.contains = (n) => { let c = n; while (c) { if (c === this) return true; c = c.parentElement; } return false; };
    this.appendChild = (c) => { c.parentElement = this; this.children.push(c); c.isConnected = true; };
    this.append = (...cs) => cs.forEach((c) => this.appendChild(c));
    this.remove = () => { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; } this.isConnected = false; };
    this.getBoundingClientRect = () => ({ left: 0, top: 0, right: 30, bottom: 30, width: 30, height: 30 });
    Object.defineProperty(this, "offsetWidth", { value: 100 });
    Object.defineProperty(this, "offsetHeight", { value: 40 });
}
const body = new El("body");
// 模拟 ComfyUI: body 下有画布等元素, 空白点击的 target 是叶子节点
const canvas = new El("canvas");
body.appendChild(canvas);
const __origDispatch = El.prototype.dispatchEvent;
const documentStub = new El("document");
documentStub.body = body;
documentStub.head = new El("head");
documentStub.documentElement = new El("html");
documentStub.documentElement.style.setProperty = () => {};
documentStub.documentElement.dataset = {};
documentStub.getElementById = () => null;
documentStub.createElement = (tag) => new El(tag);
documentStub.querySelector = () => null;

const sandbox = {
    document: documentStub,
    window: { innerWidth: 1920, innerHeight: 1080, addEventListener: () => {}, matchMedia: () => ({ matches: false }) },
    app: { registerExtension: (e) => { sandbox.app._ext = e; } },
    api: { fetchApi: async () => ({ ok: true, json: async () => ({ items: [] }), blob: async () => ({}) }) },
    LiteGraph: {}, console,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    Blob: function () {}, FormData: function () {},
    navigator: { clipboard: { writeText: async () => {} } },
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "pm.js" });

const pop = () => vm.runInContext("!!S.topbarMenu", sandbox);
const set = () => vm.runInContext("!!S.settingsMenu", sandbox);
const click = (expr) => vm.runInContext(`${expr}.dispatchEvent({type:"click",preventDefault(){},stopPropagation(){}})`, sandbox);

sandbox.app._ext.setup();
click("S.topbarBtn");
console.log("1. 点 ✏ -> popover open:", pop());
click("S.topbarMenu.children[2]"); // ⚙
console.log("2. 点 ⚙ -> settings:", set(), "| popover:", pop());

// 模拟空白处点击: target = canvas (叶子节点), mousedown + click 都发
const blankMousedown = { type: "mousedown", target: canvas, preventDefault() {}, stopPropagation() {} };
const blankClick = { type: "click", target: canvas, preventDefault() {}, stopPropagation() {} };
console.log("mousedown 监听器数量:", (documentStub._listeners["mousedown"] || []).length);
(documentStub._listeners["mousedown"] || []).forEach((f, i) => {
    try { f(blankMousedown); } catch (e) { console.log("handler", i, "err:", e.message); }
});
console.log("after mousedown -> settings:", set(), "| popover:", pop());

// 再测: 只有 popover 时点空白
click("S.topbarBtn");
console.log("4a. 重新打开 -> popover:", pop(), "| mousedown 监听器:", (documentStub._listeners["mousedown"] || []).length);
const h0 = documentStub._listeners["mousedown"][0];
sandbox.__blank = canvas;
console.log("  dispatch 前 S.topbarMenu:", vm.runInContext("!!S.topbarMenu", sandbox), "| 监听器数组:", documentStub._listeners["mousedown"].length, "| 是函数:", typeof h0 === "function");
console.log("  contains(canvas):", vm.runInContext("S.topbarMenu.contains(__blank)", sandbox), "| anchor.contains:", vm.runInContext("S.topbarMenu._anchor.contains(__blank)", sandbox), "| _anchor===btn:", vm.runInContext("S.topbarMenu._anchor === S.topbarBtn", sandbox));
vm.runInContext("const __oc = closeTopbarMenu; closeTopbarMenu = function (...a) { console.log('  [closeTopbarMenu 被调用]'); return __oc(...a); };", sandbox);
const __origOutside = documentStub._listeners["mousedown"][0];
documentStub._listeners["mousedown"][0] = (ev) => {
    console.log("  [pop.onOutside fire]");
    try { __origOutside(ev); console.log("  [pop.onOutside 完成]"); }
    catch (e) { console.log("  [pop.onOutside 异常]", e.message); }
};
console.log("  替换监听器并 dispatch:");
documentStub.dispatchEvent = function (ev) {
    const ls = this._listeners[ev.type] || [];
    console.log("  [dispatch]", ev.type, "监听器数:", ls.length);
    ls.slice().forEach((f, i) => {
        try { f(ev); } catch (e) { console.log("  [dispatch] handler", i, "异常:", e.message); }
    });
};
documentStub.dispatchEvent({ type: "mousedown", target: canvas, preventDefault() {}, stopPropagation() {} });
console.log("  mousedown 后:", vm.runInContext("!!S.topbarMenu", sandbox));

// 再测: 设置菜单开着、popover 已关 (模拟异常残留), 点空白也能收
click("S.topbarBtn");
click("S.topbarMenu.children[2]");
vm.runInContext("closeTopbarMenu()", sandbox); // 强制只留设置菜单
console.log("5. 残留设置菜单:", set(), "| popover:", pop());
documentStub.dispatchEvent({ type: "mousedown", target: canvas, preventDefault() {}, stopPropagation() {} });
documentStub.dispatchEvent({ type: "click", target: canvas, preventDefault() {}, stopPropagation() {} });
console.log("6. 空白点击后 -> settings:", set(), "| popover:", pop());
process.exit(0);
