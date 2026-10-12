// vm 桩环境测试 comfyui-prompt-manager 前端 (web/prompt_manager.js)
// 用法: node pm_vm_test.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");

// 前端源码: web/ 下多个 ES 模块, 用 pm_bundle.js 按依赖顺序拼成一段普通脚本
const { buildBundle } = require("./pm_bundle.js");
const WEB_DIR = path.join(__dirname, "..", "web");

/* ---------- DOM 桩 ---------- */
class StubEl {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this._listeners = {};
        this.className = "";
        this._html = "";
        this.textContent = "";
        this.type = "";
        this.title = "";
        this.id = "";
        this.placeholder = "";
        this.value = "";
        this.style = { cssText: "", setProperty() {}, removeProperty() {} };
        this.dataset = {};
        this._rect = { left: 100, top: 100, right: 300, bottom: 130, width: 200, height: 30 };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() {
        let n = this;
        while (n.parentNode) n = n.parentNode;
        return n === documentStub.body || n === documentStub.head || n === documentStub;
    }
    get classList() {
        const self = this;
        return {
            add: (...c) => {
                const s = new Set(self.className.split(/\s+/).filter(Boolean));
                c.forEach((x) => s.add(x));
                self.className = [...s].join(" ");
            },
            remove: (...c) => {
                const s = self.className.split(/\s+/).filter(Boolean).filter((x) => !c.includes(x));
                self.className = s.join(" ");
            },
            contains: (c) => self.className.split(/\s+/).includes(c),
        };
    }
    appendChild(ch) {
        if (ch.parentNode) ch.parentNode._removeChild(ch);
        ch.parentNode = this;
        this.children.push(ch);
        return ch;
    }
    append(...cs) { cs.forEach((c) => this.appendChild(c)); }
    _removeChild(ch) {
        const i = this.children.indexOf(ch);
        if (i >= 0) this.children.splice(i, 1);
        ch.parentNode = null;
    }
    remove() { if (this.parentNode) this.parentNode._removeChild(this); }
    contains(x) { let n = x; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
    dispatch(t, ev) {
        ev = ev || {};
        ev.target = ev.target || this;
        ev.preventDefault = ev.preventDefault || (() => {});
        ev.stopPropagation = ev.stopPropagation || (() => {});
        (this._listeners[t] || []).slice().forEach((f) => f.call(this, ev));
    }
    click() {
        if (typeof this.onclick === "function") {
            this.onclick({ preventDefault() {}, stopPropagation() {} });
        }
        this.dispatch("click");
    }
    focus() {}
    select() {}
    getBoundingClientRect() { return this._rect; }
    get offsetWidth() { return this._rect.width; }
    get offsetHeight() { return this._rect.height; }
    set innerHTML(v) {
        this._html = String(v);
        this.children.slice().forEach((c) => (c.parentNode = null));
        this.children = [];
    }
    get innerHTML() { return this._html; }
    _find(pred) {
        for (const c of this.children) {
            if (pred(c)) return c;
            const r = c._find(pred);
            if (r) return r;
        }
        return null;
    }
    _findAll(pred, out) {
        for (const c of this.children) {
            if (pred(c)) out.push(c);
            c._findAll(pred, out);
        }
        return out;
    }
    closest(sel) {
        let n = this;
        while (n) {
            if (_matchesSel(n, sel)) return n;
            n = n.parentNode;
        }
        return null;
    }
    querySelector(sel) {
        if (sel.startsWith("#")) return this._find((c) => c.id === sel.slice(1));
        if (sel.startsWith(".")) return this._find((c) => c.classList.contains(sel.slice(1)));
        return this._find((c) => c.tagName === sel.toUpperCase());
    }
    querySelectorAll(sel) {
        const pred = sel.startsWith("#")
            ? (c) => c.id === sel.slice(1)
            : sel.startsWith(".")
              ? (c) => c.classList.contains(sel.slice(1))
              : (c) => c.tagName === sel.toUpperCase();
        return this._findAll(pred, []);
    }
}

// 简易选择器匹配 (够 closest 用: .class / tag / [data-x] / [class*=y] / 逗号组合)
function _matchesSel(el, sel) {
    if (!el || !el.tagName) return false;
    if (sel.includes(",")) {
        return sel.split(",").some((s) => _matchesSel(el, s.trim()));
    }
    if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
    let m = /^\[class\*=["']?([^"'\]]+)["']?\]$/.exec(sel);
    if (m) return String(el.className || "").indexOf(m[1]) >= 0;
    m = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(sel);
    if (m) {
        const key = m[1].replace(/^data-/, "").replace(/-([a-z])/g, (s, c) => c.toUpperCase());
        const v = el.dataset ? el.dataset[key] : undefined;
        return m[2] === undefined ? v !== undefined : String(v) === m[2];
    }
    return el.tagName === sel.toUpperCase();
}

const documentStub = {
    documentElement: new StubEl("html"),
    body: new StubEl("body"),
    head: new StubEl("head"),
    _listeners: {},
    createElement: (t) => new StubEl(t),
    getElementById(id) {
        return documentStub.body._find((c) => c.id === id) ||
               documentStub.head._find((c) => c.id === id) || null;
    },
    addEventListener(t, fn) { (documentStub._listeners[t] = documentStub._listeners[t] || []).push(fn); },
    removeEventListener(t, fn) {
        documentStub._listeners[t] = (documentStub._listeners[t] || []).filter((f) => f !== fn);
    },
    dispatch(t, ev) {
        ev = ev || {};
        ev.preventDefault = ev.preventDefault || (() => {});
        ev.stopPropagation = ev.stopPropagation || (() => {});
        (documentStub._listeners[t] || []).slice().forEach((f) => f(ev));
    },
    querySelector: () => null,
    querySelectorAll: () => [],
};

/* ---------- app / api 桩 ---------- */
const app = {
    graph: {
        setDirtyCanvas() {},
        // 「参数套到画布」要改采样器节点上的 widget
        _nodes: [
            {
                type: "KSampler",
                widgets: [
                    { name: "seed", value: 0 },
                    { name: "steps", value: 20 },
                    { name: "cfg", value: 8 },
                    { name: "sampler_name", value: "euler" },
                    { name: "scheduler", value: "normal" },
                    { name: "denoise", value: 1 },
                ],
            },
            { type: "CLIPTextEncode", widgets: [{ name: "text", value: "hi" }] },
        ],
    },
    menu: null,
    extensionManager: null,
    _extensions: [],
    _loadedGraph: null,
    loadGraphData(g) { app._loadedGraph = g; },
    registerExtension(ext) { app._extensions.push(ext); },
};

const api = { _calls: [] };
function routeResponse(url) {
    if (url.indexOf("/prompt_manager/all") === 0) {  // 带分页/搜索参数
        return { ok: true, status: 200, json: async () => ({
            items: [
                { name: "prompt_0001", category: "默认", preview: "aaa", text_len: 3 },
                { name: "zk-krea2人像写真提示词", category: "1.元指令", preview: "bbb", text_len: 3 },
            ],
            total: api._allTotal !== undefined ? api._allTotal : 2,
            offset: 0,
            limit: 300,
            has_more: !!api._allHasMore,   // 测试里手动打开, 验证「加载更多」
        }) };
    }
    if (url === "/prompt_manager/categories") {
        return { ok: true, status: 200, json: async () => ({ categories: [{ name: "默认" }, { name: "1.元指令" }, { name: "空分类" }] }) };
    }
    if (url === "/prompt_manager/export") {
        return { ok: true, status: 200, blob: async () => ({}) };
    }
    if (url === "/prompt_manager/import") {
        // 一次性: 取走后即清空, 模拟服务端处理完冲突后不再返回同样结果
        const res = sandbox.__pmImportRes || {};
        sandbox.__pmImportRes = {};
        return {
            ok: true,
            status: 200,
            json: async () => res,
        };
    }
    if (url === "/prompt_manager/load") {
        return {
            ok: true,
            status: 200,
            json: async () => ({ text: sandbox.__pmLoadText || "" }),
        };
    }
    if (url.indexOf("/prompt_manager/meta") === 0) {
        return {
            ok: true,
            status: 200,
            json: async () =>
                sandbox.__pmMetaRes || {
                    ok: true,
                    format: "PNG",
                    width: 100,
                    height: 100,
                    prompts: [],
                    has_workflow: false,
                },
        };
    }
    if (url.indexOf("/prompt_manager/gallery") === 0) {
        return {
            ok: true,
            status: 200,
            json: async () =>
                sandbox.__pmGalleryRes || { total: 0, count: 0, images: [] },
        };
    }
    if (url.indexOf("/prompt_manager/workflow") === 0) {
        return {
            ok: true,
            status: 200,
            json: async () =>
                sandbox.__pmWorkflowRes || { ok: true, has_workflow: false, workflow: null },
        };
    }
    if (url === "/prompt_manager/duplicates") {
        return {
            ok: true,
            status: 200,
            json: async () => sandbox.__pmDupRes || { groups: [] },
        };
    }
    if (url.indexOf("/prompt_manager/dirs") === 0) {
        return {
            ok: true,
            status: 200,
            json: async () =>
                sandbox.__pmDirsRes !== undefined
                    ? sandbox.__pmDirsRes
                    : { path: "", dirs: [], parent: "" },
        };
    }
    if (url === "/prompt_manager/trash") {
        return { ok: true, status: 200, json: async () => ({ ok: true, name: "x.png" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
}
api._opts = [];
api.fetchApi = async (url, opts) => {
    api._calls.push(url);
    api._opts.push(opts || null);
    return routeResponse(url);
};

/* ---------- 沙箱 ---------- */
const sandbox = {
    console,
    document: documentStub,
    app,
    api,
    LiteGraph: {},
    window: { innerWidth: 1920, innerHeight: 1080, addEventListener() {}, removeEventListener() {} },
    localStorage: (() => {
        const store = new Map();
        return {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        };
    })(),
    navigator: {
        clipboard: {
            writeText: async (t) => {
                sandbox.__copied = t;
            },
        },
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob: globalThis.Blob,
    FormData: globalThis.FormData,
    // tryMountToolbar 里会读 getComputedStyle(host).position
    getComputedStyle: () => ({ position: "static", display: "block", visibility: "visible" }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    process,
    __pmTest: {},
};
sandbox.window.document = documentStub;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let src = buildBundle(WEB_DIR).code;

/* ---------- 载入源码 ---------- */
try {
    vm.runInContext(src, sandbox, { filename: "prompt_manager.js" });
} catch (e) {
    console.error("❌ 前端源码加载失败:", e.message);
    process.exit(1);
}
console.log("✅ 前端源码加载成功");

/* ---------- 断言 ---------- */
const testCode = `
(async () => {
    const results = [];
    const assert = (cond, msg) => {
        if (!cond) throw new Error("断言失败: " + msg);
        results.push(msg);
    };

    // 1. 版本号
    assert(PM_VERSION === "1.4.65", "版本号为 1.4.61");

    // 2. 新函数存在
    assert(typeof toggleSettingsMenu === "function", "toggleSettingsMenu 存在");
    assert(typeof closeSettingsMenu === "function", "closeSettingsMenu 存在");

    // 3. ComfyUI 设置面板里的导入/导出入口保留 (与 ⚙ 菜单并存)
    const ext = app._extensions[0];
    assert(ext && ext.name === "PromptManager.GlobalToolbar", "扩展已注册");
    assert(Array.isArray(ext.settings) && ext.settings.length === 2, "设置面板保留 2 个入口");
    assert(ext.settings.some((s) => s.id === "PromptManager.exportPrompts"), "设置面板有导出入口");
    assert(ext.settings.some((s) => s.id === "PromptManager.importPrompts"), "设置面板有导入入口");

    // 4. 打开列表弹窗
    await openPromptDialog(null, "load");
    assert(!!S.dialog, "列表弹窗已打开");
    const dlg = S.dialog.dlg;
    const head = dlg.children[0];
    assert(head.className === "pm-dialog-head", "头部存在");
    assert(head.children.length === 7, "头部共 7 个子元素 (标题+6按钮)");
    assert(head.children[0].textContent === "提示词列表", "标题正确");
    assert(head.children[1].title.indexOf("新建") >= 0, "第 1 个按钮为 ＋ 新建提示词");
    assert(head.children[1]._html === PM_ICONS.plus, "新建按钮用 plus 图标");
    assert(head.children[2].title.indexOf("刷新") >= 0, "第 2 个按钮为 ↻ 刷新按钮");
    assert(head.children[2]._html === PM_ICONS.refresh, "刷新按钮用 refresh 图标");
    assert(head.children[3].title.indexOf("导入") >= 0, "第 3 个按钮为 📥 导入 (对调后在前)");
    assert(head.children[3]._html === PM_ICONS.upload, "导入按钮用 upload 图标 (同 ⚙ 画法)");
    assert(head.children[4].title.indexOf("导出") >= 0, "第 4 个按钮为 📤 导出");
    assert(head.children[4]._html === PM_ICONS.download, "导出按钮用 download 图标 (同 ⚙ 画法)");
    assert(head.children[5].title.indexOf("排重复") >= 0, "第 5 个按钮为 ⧉ 排重复");
    assert(head.children[6].title.indexOf("关闭") >= 0, "第 6 个按钮为 ✕ 关闭");

    // 5. 点击 📥 导入 → 弹出文件选择 (不调接口, 不关弹窗)
    head.children[3].dispatch("click");
    assert(!!S.dialog, "点导入后弹窗仍在");
    assert(api._calls.indexOf("/prompt_manager/import") < 0, "未选文件前不调导入接口");

    // 6. 点击 📤 导出 → 直接调导出接口 (无下拉菜单)
    head.children[4].dispatch("click");
    await new Promise((r) => setTimeout(r, 20));
    assert(api._calls.indexOf("/prompt_manager/export") >= 0, "导出按钮直接调导出接口");
    assert(!S.settingsMenu, "头部不再有 ⚙ 设置菜单");

    // 6b. 模拟真实导入: 选文件 → 调导入接口 → 自动刷新列表
    const origCreate = document.createElement;
    let fileInput = null;
    document.createElement = (t) => {
        const el = origCreate(t);
        if (t === "input") fileInput = el;
        return el;
    };
    importPrompts();
    document.createElement = origCreate;
    assert(!!fileInput && fileInput.type === "file", "导入弹出文件选择框");
    const allBefore = api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length;
    fileInput.files = [{ name: "p.json" }];
    await fileInput.onchange();
    assert(api._calls.indexOf("/prompt_manager/import") >= 0, "选文件后调导入接口");
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length > allBefore,
        "导入后自动刷新列表 (重新读取 /all)"
    );
    assert(!!S.dialog, "导入后弹窗仍开着 (原地刷新, 不关闭)");

    // 6d. 同名但内容不同 → 弹改名弹窗, 改名后以 JSON 再提交一次
    const conflictRes = {
        ok: true,
        imported: 1,
        skipped_name: 0,
        skipped_content: 0,
        skipped_empty: 0,
        conflicts: [
            {
                name: "A",
                suggested: "A (2)",
                text: "新内容A",
                category: "默认",
                existing_preview: "旧内容A",
                incoming_preview: "新内容A",
            },
        ],
    };
    const findConflictDlg = () =>
        document.body.children
            .filter((c) => c.className === "pm-mask")
            .map((m) => m.children[0])
            .find((d) => (d.className || "").indexOf("pm-dialog-conflict") >= 0);

    globalThis.__pmImportRes = conflictRes;
    const origCreate2 = document.createElement;
    let fileInput2 = null;
    document.createElement = (t) => {
        const el = origCreate2(t);
        if (t === "input") fileInput2 = el;
        return el;
    };
    importPrompts();
    document.createElement = origCreate2;
    fileInput2.files = [{ name: "p2.json" }];
    const importP = fileInput2.onchange();
    await new Promise((r) => setTimeout(r, 30));
    const cDlg = findConflictDlg();
    assert(!!cDlg, "同名不同内容时弹出改名弹窗");
    assert(
        cDlg.children[0].children[0].textContent.indexOf("名称冲突") >= 0,
        "弹窗标题为 名称冲突"
    );
    const cList = cDlg.children[1].children[1];
    const card = cList.children[0];
    assert(card.children[0].textContent === "原名: A", "卡片显示原名");
    assert(card.children[1].textContent.indexOf("库中") >= 0, "卡片显示库中内容预览");
    assert(card.children[2].textContent.indexOf("导入") >= 0, "卡片显示导入内容预览");
    assert(card.children[3].value === "A (2)", "输入框默认填建议名 A (2)");
    card.children[3].value = "A_改名";
    const importCallsBefore = api._calls.filter((c) => c === "/prompt_manager/import").length;
    cDlg.children[2].children[2].dispatch("click");
    await importP;
    assert(
        api._calls.filter((c) => c === "/prompt_manager/import").length ===
            importCallsBefore + 1,
        "改名后再次提交导入"
    );
    let lastImportIdx = -1;
    api._calls.forEach((c, i) => {
        if (c === "/prompt_manager/import") lastImportIdx = i;
    });
    const lastOpt = api._opts[lastImportIdx];
    assert(
        !!lastOpt && String((lastOpt.headers || {})["Content-Type"]) === "application/json",
        "第二次提交用 JSON body"
    );
    const payload = JSON.parse(lastOpt.body);
    assert(payload.prompts.length === 1, "只提交改名后的 1 条");
    assert(payload.prompts[0].name === "A_改名", "提交的是用户改的名字");
    assert(payload.prompts[0].text === "新内容A", "改名条目保留原内容");
    assert(!findConflictDlg(), "提交后改名弹窗关闭");

    // 6e. 点「全部跳过」→ 不再提交, 冲突条目计入跳过
    globalThis.__pmImportRes = conflictRes;
    const origCreate3 = document.createElement;
    let fileInput3 = null;
    document.createElement = (t) => {
        const el = origCreate3(t);
        if (t === "input") fileInput3 = el;
        return el;
    };
    importPrompts();
    document.createElement = origCreate3;
    fileInput3.files = [{ name: "p3.json" }];
    const importP3 = fileInput3.onchange();
    await new Promise((r) => setTimeout(r, 30));
    const cDlg3 = findConflictDlg();
    assert(!!cDlg3, "再次导入冲突时仍弹改名弹窗");
    const importCallsBefore3 = api._calls.filter((c) => c === "/prompt_manager/import").length;
    cDlg3.children[2].children[0].dispatch("click"); // 全部跳过
    await importP3;
    assert(
        api._calls.filter((c) => c === "/prompt_manager/import").length === importCallsBefore3,
        "全部跳过后不再提交导入"
    );
    assert(!findConflictDlg(), "跳过后改名弹窗关闭");
    globalThis.__pmImportRes = {};

    // 7. Esc 关闭弹窗 (头部已无设置菜单, Esc 直接关弹窗)
    document.dispatchEvent({ key: "Escape" });
    assert(!S.dialog, "Esc 关闭弹窗");

    // 9. ↻ 刷新按钮: 原地刷新数据, 弹窗不重建 (同一个 mask 节点, 界面不闪)
    await openPromptDialog(null, "load");
    const head9 = S.dialog.dlg.children[0];
    const maskBefore = S.dialog.mask;
    head9.children[2].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(!!S.dialog, "点 ↻ 后弹窗仍在");
    assert(S.dialog.mask === maskBefore, "刷新未重建弹窗 (原地刷新, 不闪)");
    closePromptDialog();
    assert(!S.dialog, "closePromptDialog 正常关闭");

    // 9b. 面板未打开时导入 → 静默刷新缓存一次, 不报错
    const allBefore2 = api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length;
    await pmRefreshAfterImport();
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length === allBefore2 + 1,
        "面板未开时静默刷新缓存一次"
    );

    // 9c. 分类栏显示所有服务器分类 (包括没有提示词的空分类)
    await openPromptDialog(null, "load");
    const barTabs = [...S.dialog.catBar.children].filter(
        (c) =>
            (c.className || "").indexOf("pm-tab") >= 0 &&
            (c.className || "").indexOf("pm-tab-add") < 0 &&
            (c.className || "").indexOf("pm-tab-manage") < 0
    );
    const tabTexts = barTabs.map((t) => t.textContent);
    assert(tabTexts[0] === "全部", "分类栏第一个是 全部");
    assert(tabTexts.indexOf("默认") >= 0, "分类栏包含 默认");
    assert(tabTexts.indexOf("1.元指令") >= 0, "分类栏包含 1.元指令");
    assert(tabTexts.indexOf("空分类") >= 0, "分类栏包含没有提示词的空分类");
    closePromptDialog();

    // 9d. 列表请求带分页与筛选参数
    await openPromptDialog(null, "load");
    const lastAll = api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).pop();
    assert(lastAll.indexOf("limit=" + PM_PAGE_SIZE) >= 0, "列表请求带每页条数 limit");
    assert(lastAll.indexOf("offset=0") >= 0, "首页请求 offset=0");
    assert(lastAll.indexOf("q=") >= 0, "列表请求带搜索关键字 q");
    assert(S.dialog.hasMore === false, "服务端没说 has_more 时不显示加载更多");
    assert(
        ![...S.dialog.list.children].some((c) => (c.className || "") === "pm-list-more"),
        "没有下一页时列表末尾没有加载更多"
    );
    const urlD = { search: { value: "猫" }, category: "1.元指令" };
    assert(pmAllUrl(urlD, 300).indexOf("offset=300") >= 0, "翻页请求带上已加载条数");
    assert(pmAllUrl(urlD, 0).indexOf("q=%E7%8C%AB") >= 0, "关键字按 URL 编码传给服务端");
    assert(
        pmAllUrl(urlD, 0).indexOf("category=1.%E5%85%83%E6%8C%87%E4%BB%A4") >= 0,
        "分类按 URL 编码传给服务端"
    );
    closePromptDialog();

    // 9e. 搜索: 本地即时过滤 + 停手后问服务端要完整结果
    await openPromptDialog(null, "load");
    const allBefore3 = api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length;
    S.dialog.search.value = "猫";
    pmOnDialogSearchInput(S.dialog);
    await new Promise((r) => setTimeout(r, 320));
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length > allBefore3,
        "停手 250ms 后向服务端重新查询"
    );
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).pop().indexOf("q=%E7%8C%AB") >= 0,
        "服务端查询带关键字"
    );
    closePromptDialog();

    // 9f. has_more: 列表末尾出现「加载更多」, 点击后接着下一页
    api._allHasMore = true;
    api._allTotal = 700;
    await openPromptDialog(null, "load");
    assert(S.dialog.hasMore === true, "服务端 has_more 时标记为还有下一页");
    const moreWrap = [...S.dialog.list.children].filter(
        (c) => (c.className || "") === "pm-list-more"
    )[0];
    assert(!!moreWrap, "列表末尾出现「加载更多」");
    assert(
        (moreWrap.children[0].textContent || "").indexOf("共 700") >= 0,
        "加载更多上显示已加载 / 总数"
    );
    const offBefore = S.dialog.offset;
    moreWrap.children[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(S.dialog.offset > offBefore, "点加载更多后已加载条数增加");
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).pop().indexOf("offset=" + offBefore) >= 0,
        "加载更多请求从上次的位置接着取"
    );
    api._allHasMore = false;
    api._allTotal = 2;
    closePromptDialog();

    // 9g. 分页数据是局部的, 不能拿去判重名 (否则保存会静默覆盖)
    _pmItemsCache = null;
    _pmItemsCacheFull = false;
    pmItemsCacheMerge([{ name: "only-one", category: "默认" }]);
    assert(_pmItemsCache.length === 1, "merge 只补充缓存, 不清空");
    const allBefore4 = api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length;
    await pmKnownItems();
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/all") === 0).length === allBefore4 + 1,
        "缓存不完整时 pmKnownItems 会重新拉全量 (不拿分页数据判重名)"
    );

    // 10. 顶栏按钮: 图标为 ✏, 点击弹出三按钮浮层
    ext.setup(); // 触发 installTopbarButton (桩环境挂不上顶栏, 按钮为游离节点, 不影响逻辑测试)
    assert(S.topbarBtn && S.topbarBtn._html === PM_ICONS.trigger, "顶栏图标为 ✏ 笔");
    S.topbarBtn.dispatch("click");
    assert(!!S.topbarMenu, "点击顶栏 ✏ 弹出浮层");
    assert(document.body.children.indexOf(S.topbarMenu) >= 0, "浮层挂在 document.body 下");
    const popBtns = S.topbarMenu.children;
    assert(popBtns.length === 3, "浮层只有 3 个按钮");
    assert(popBtns[0].title.indexOf("列表") >= 0, "浮层按钮1 = 列表");
    assert(popBtns[1].title === "图库", "浮层按钮2 = 图库");
    assert(popBtns[1]._html === PM_ICONS.gallery, "图库按钮用 gallery 图标");
    assert(popBtns[2].title.indexOf("提示词库") >= 0, "浮层按钮3 = 提示词库 (导入/导出)");

    // 11. 浮层 ⚙ → 提示词库对话框 (导入/导出), Esc 先关对话框再关浮层
    popBtns[2].dispatch("click");
    assert(!!S.settingsMenu, "浮层 ⚙ 打开提示词库对话框");
    assert(
        S.settingsMenu.mask.className.indexOf("pm-mask") >= 0,
        "设置入口是弹窗而不是下拉菜单"
    );
    const libBody = S.settingsMenu.mask.children[0].children[1];
    const libItems = libBody.children.filter((c) => c.className === "pm-lib-item");
    assert(libItems.length === 2, "对话框含导出/导入两个卡片");
    assert(
        libItems[0].children[1].children[0].textContent.indexOf("导出") >= 0 &&
            libItems[1].children[1].children[0].textContent.indexOf("导入") >= 0,
        "第一项导出、第二项导入"
    );
    assert(
        libItems[0].children[0]._html === PM_ICONS.download &&
            libItems[1].children[0]._html === PM_ICONS.upload,
        "导出/导入用单色线描图标 (带 📤📥 的彩色 emoji 已去掉)"
    );
    assert(!!S.topbarMenu, "对话框打开时浮层仍在");
    document.dispatchEvent({ key: "Escape" });
    assert(!S.settingsMenu, "Esc 先关对话框");
    assert(!!S.topbarMenu, "浮层仍在");
    document.dispatchEvent({ key: "Escape" });
    assert(!S.topbarMenu, "再按 Esc 关浮层");

    // 12. 浮层 ☰ → 打开列表弹窗并收起浮层
    S.topbarBtn.dispatch("click");
    assert(!!S.topbarMenu, "浮层再次打开");
    S.topbarMenu.children[0].dispatch("click");
    assert(!S.topbarMenu, "点 ☰ 后浮层收起");
    assert(!!S.dialog, "点 ☰ 打开了列表弹窗");
    closePromptDialog();

    // 13. 浮层 🖼 图库 → 占位 toast, 不调接口
    S.topbarBtn.dispatch("click");
    S.topbarMenu.children[1].dispatch("click");
    assert(!S.topbarMenu, "点 🖼 后浮层收起");
    assert(!!document.getElementById("pm-toast-box"), "图库按钮弹出占位提示");
    assert(api._calls.indexOf("/prompt_manager/duplicates") < 0, "图库按钮不调排重复接口");

    // 14. ＋ 新建提示词
    await openPromptDialog(null, "load");
    const head2 = S.dialog.dlg.children[0];
    const maskCountBefore = document.body.children.filter((c) => c.className === "pm-mask").length;
    head2.children[1].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(_pmNewPromptOpen, "点 ＋ 后新建弹窗打开");
    const masks = document.body.children.filter((c) => c.className === "pm-mask");
    assert(masks.length === maskCountBefore + 1, "新建弹窗是新的一层遮罩");
    const nd = masks[masks.length - 1].children[0];
    const nbody = nd.children[1];
    const nameInput = nbody.children[0].children[1];
    const catSel = nbody.children[1].children[1];
    const area = nbody.children[2].children[1];
    const okBtn = nd.children[2].children[1];
    assert(nameInput.value.length > 0, "名称已自动编号 (如 prompt_0003)");
    assert(catSel.children.length >= 2, "分类下拉列出了已知分类");
    assert(!!area, "内容文本框存在");

    // 14a. Esc 只关新建弹窗, 不动列表弹窗
    document.dispatchEvent({ key: "Escape" });
    assert(!_pmNewPromptOpen, "Esc 关闭新建弹窗");
    assert(!!S.dialog, "列表弹窗仍在 (Esc 未穿透)");

    // 14b. 名称为空时不允许保存
    head2.children[1].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const masks2 = document.body.children.filter((c) => c.className === "pm-mask");
    const nd2 = masks2[masks2.length - 1].children[0];
    const nameInput2 = nd2.children[1].children[0].children[1];
    const okBtn2 = nd2.children[2].children[1];
    const callsBefore = api._calls.length;
    nameInput2.value = "   ";
    okBtn2.dispatch("click");
    await new Promise((r) => setTimeout(r, 20));
    assert(_pmNewPromptOpen, "名称为空时不关闭新建弹窗");
    assert(api._calls.length === callsBefore, "名称为空时不调用保存接口");

    // 14c. 正常保存 → 调接口并刷新列表
    nameInput2.value = "新建测试_9999";
    nd2.children[1].children[2].children[1].value = "测试内容 hello";
    okBtn2.dispatch("click");
    await new Promise((r) => setTimeout(r, 40));
    assert(!_pmNewPromptOpen, "保存后新建弹窗关闭");
    assert(api._calls.indexOf("/prompt_manager/save") >= 0, "保存接口已被调用");
    assert(!!S.dialog, "列表弹窗仍在且已刷新");
    closePromptDialog();

    // 15. ⧉ 排重复: 只按内容查重 (名字有 UNIQUE 约束, 不查同名)
    globalThis.__pmDupRes = {
        groups: [
            {
                preview: "相同内容",
                count: 2,
                items: [
                    { name: "A", category: "默认", text_len: 4, updated_at: "" },
                    { name: "B", category: "默认", text_len: 4, updated_at: "" },
                ],
            },
            {
                preview: "另一组",
                count: 2,
                items: [
                    { name: "C", category: "1.元指令", text_len: 3, updated_at: "" },
                    { name: "D", category: "1.元指令", text_len: 3, updated_at: "" },
                ],
            },
        ],
    };
    await openDuplicatesDialog(null);
    const dupMask = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const dDlg = dupMask.children[0];
    assert(dDlg.className.indexOf("pm-dialog-dup") >= 0, "⧉ 打开排重复弹窗");
    assert(dDlg.children[0].children[0].textContent === "重复提示词 (2 组)", "标题显示组数");
    const dupList = dDlg.children[2];
    assert(dupList.children.length === 2, "列表里就是 2 张卡片 (无分区标题)");
    const card1 = dupList.children[0];
    assert(card1.className === "pm-dup-card", "第一张是重复卡片");
    assert(card1.children[0].textContent === "相同内容", "卡片顶部显示内容预览");
    assert(card1.children[1].children[0].textContent === "保留", "第一条默认保留");
    assert(card1.children[2].children[0].textContent === "保留此项", "第二条待选");
    assert(card1.children[1].children[1].textContent === "A", "显示条目名");
    assert(card1.children[1].children[2].textContent === "默认", "显示分类");
    assert(
        dDlg.children[3].textContent === "共 2 组重复内容, 可删除 2 条",
        "汇总: 共 2 组重复内容, 可删除 2 条"
    );
    card1.children[2].children[0].dispatch("click");
    const card1b = dDlg.children[2].children[0];
    assert(card1b.children[2].children[0].textContent === "保留", "切换后第二条成为保留项");
    assert(card1b.children[1].children[0].textContent === "保留此项", "原保留项变为待选");
    assert(
        dDlg.children[3].textContent === "共 2 组重复内容, 可删除 2 条",
        "切换保留项后可删除总数不变"
    );
    document.dispatchEvent({ key: "Escape" });
    assert(
        document.body.children.filter((c) => c.className === "pm-mask").indexOf(dupMask) < 0,
        "Esc 关闭排重复弹窗"
    );

    // 15b. 万一后端仍回传 name 组 (旧数据), 前端过滤掉, 不弹改名界面
    const masksBefore15b = document.body.children.filter((c) => c.className === "pm-mask").length;
    globalThis.__pmDupRes = {
        groups: [
            {
                kind: "name",
                key: "foo",
                preview: "",
                count: 2,
                items: [
                    { name: "Foo", category: "默认", preview: "x" },
                    { name: "foo", category: "默认", preview: "y" },
                ],
            },
        ],
    };
    await openDuplicatesDialog(null);
    assert(
        document.body.children.filter((c) => c.className === "pm-mask").length === masksBefore15b,
        "纯同名组被过滤, 不再弹排重复弹窗"
    );
    globalThis.__pmDupRes = null;

    // 16. 列表悬停预览: 停留后显示全文, 移开即消失
    globalThis.__pmLoadText = "这是完整内容" + String.fromCharCode(10) + "第二行内容";
    await openPromptDialog(null, "load");
    const hList = S.dialog.list;
    const hRows = hList.children.filter((c) => c.className === "pm-item");
    assert(hRows.length === 2, "列表渲染出 2 条提示词");
    const findTip = () => document.body._find((c) => c.className === "pm-hover-tip");
    hRows[0].dispatch("mouseenter");
    assert(!findTip(), "刚移入不立即显示 (有延迟)");
    await new Promise((r) => setTimeout(r, 260));
    const tip1 = findTip();
    assert(!!tip1, "停留后弹出悬停浮层");
    assert(tip1.textContent === "这是完整内容" + String.fromCharCode(10) + "第二行内容", "浮层显示该条完整内容");
    assert(tip1.style.top === "100px", "浮层顶部与列表顶部对齐 (top=列表 top)");
    assert(tip1.style.height === "30px", "浮层高度与列表一样高 (height=列表 height)");
    assert(tip1.style.maxHeight === "30px", "maxHeight 同步为列表高度");
    assert(tip1.style.left === "310px", "浮层贴在列表右侧 (列表 right+10)");
    assert(api._calls.indexOf("/prompt_manager/load") >= 0, "全文通过 /load 读取");
    const loadCalls1 = api._calls.filter((c) => c === "/prompt_manager/load").length;
    hRows[0].dispatch("mouseleave");
    assert(!findTip(), "鼠标移开后浮层消失");

    // 掠过 (没停留满延迟) 不应该弹
    hRows[1].dispatch("mouseenter");
    hRows[1].dispatch("mouseleave");
    await new Promise((r) => setTimeout(r, 260));
    assert(!findTip(), "快速掠过不显示浮层");

    // 同一条再次悬停: 内容来自缓存, 不再重复请求
    hRows[0].dispatch("mouseenter");
    await new Promise((r) => setTimeout(r, 260));
    assert(!!findTip(), "再次悬停仍显示浮层");
    assert(
        api._calls.filter((c) => c === "/prompt_manager/load").length === loadCalls1,
        "同一条复用缓存, 不重复请求全文"
    );
    hList.dispatch("scroll");
    assert(!findTip(), "列表滚动时收起浮层");
    hRows[0].dispatch("mouseenter");
    await new Promise((r) => setTimeout(r, 260));
    assert(!!findTip(), "滚动后再次悬停可显示");
    closePromptDialog();
    assert(!findTip(), "关闭弹窗时浮层一并收起");
    globalThis.__pmLoadText = "";

    // 17. 图库: 常驻窗口 (只能点 X 关闭), 头部 刷新/设置/关闭, 缩略图网格
    globalThis.__pmGalleryRes = {
        total: 3,
        count: 3,
        truncated: false,
        dir: "output",
        images: [
            { name: "a.png", subfolder: "", type: "output", mtime: 3, size: 10, url: "/view?a" },
            { name: "b.png", subfolder: "sub", mtime: 2, size: 20, url: "/view?b" },
            { name: "c.jpg", subfolder: "", mtime: 1, size: 30, url: "/view?c" },
        ],
    };
    await openGalleryDialog();
    const gMask = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const gDlg = gMask.children[0];
    assert(gDlg.className.indexOf("pm-dialog-gallery") >= 0, "🖼 打开图库窗口");
    const gHead = gDlg.children[0];
    assert(gHead.children.length === 6, "头部 6 项: 标题 + 排序 + 缩略图 + 刷新 + 设置 + 关闭");
    assert(gHead.children[0].textContent === "图库 (3)", "标题显示图片数量");
    assert(gHead.children[1].className.indexOf("pm-gallery-order") >= 0, "头部第二项是排序按钮");
    assert(gHead.children[2].className.indexOf("pm-gallery-size") >= 0, "头部第三项是缩略图按钮");
    assert(gHead.children[3].className.indexOf("pm-gallery-refresh") >= 0, "头部第四项是刷新按钮");
    assert(gHead.children[4].className.indexOf("pm-gallery-set") >= 0, "头部第五项是设置按钮");
    assert(gHead.children[5].className.indexOf("pm-gallery-close") >= 0, "头部第六项是关闭按钮");
    assert(gHead.children[1].title.indexOf("最新在前") >= 0, "排序按钮默认显示最新在前");
    assert(gHead.children[2].title.indexOf("中") >= 0, "缩略图按钮默认显示中");
    const gGrid = gDlg.children[1];
    assert(gGrid.children.length === 3, "网格渲染出 3 张缩略图");
    const thumbSrc = gGrid.children[0].children[0].src;
    assert(thumbSrc.indexOf("/prompt_manager/thumb?") === 0, "缩略图走自建 thumb 缓存接口");
    assert(thumbSrc.indexOf("filename=a.png") > 0, "缩略图带文件名");
    assert(thumbSrc.indexOf("t=") > 0, "缩略图带 t=mtime (浏览器永久缓存)");
    assert(thumbSrc.indexOf("preview=") < 0, "不再用 /view 的 preview 实时转码");
    assert(gGrid.children[0].children.length === 2, "缩略图卡片 = 图片 + 删除按钮 (无文件名行)");
    assert(gGrid.children[0].children[1].className === "pm-gallery-del", "删除按钮存在");
    assert(gGrid.children[0].title === "a.png", "文件名改为悬停 title 提示");
    assert(gDlg.children[2].textContent === "共 3 张 · 输出目录", "底部显示数量与当前目录");

    // 常驻: 点空白 / Esc 都不关闭
    gMask.dispatch("mousedown", { target: gMask });
    gMask.dispatch("click", { target: gMask });
    document.dispatchEvent({ key: "Escape" });
    assert(document.body.children.indexOf(gMask) >= 0, "点空白或 Esc 都不关闭图库 (常驻)");

    // 刷新按钮: 重新扫描
    const galCalls1 = api._calls.filter((c) => c.indexOf("/prompt_manager/gallery") === 0).length;
    gHead.children[3].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/gallery") === 0).length === galCalls1 + 1,
        "点刷新重新扫描一次"
    );
    assert(
        api._calls[api._calls.length - 1].indexOf("refresh=1") > 0,
        "刷新按钮带 refresh=1 (强制重新扫盘)"
    );

    // 设置按钮: 弹出设置对话框 (三个来源都是勾选式, 可任意组合)
    gHead.children[4].dispatch("click");
    const masksAfter = document.body.children.filter((c) => c.className === "pm-mask");
    const sDlg = masksAfter[masksAfter.length - 1].children[0];
    assert(!!sDlg, "点设置弹出设置对话框");
    assert(sDlg.children[0].children[0].textContent === "图库设置", "对话框标题是图库设置");
    const sBody = sDlg.children[1];
    const sRows = sBody.children[1];
    assert(sRows.className === "pm-dir-rows", "对话框里有目录选择行");
    assert(sRows.children.length === 3, "三个来源: 输出 / 输入 / 自定义目录");
    assert(sRows.children[0].textContent.indexOf("✓") === 0, "默认勾选输出目录");
    assert(sRows.children[1].textContent.indexOf("✓") !== 0, "输入目录默认不勾选");
    const sCustom = sBody.children[2];
    const sList = sCustom.children[0];
    const sBtns = sCustom.children[1];
    const sAdd = sBtns.children[0];
    const sDel = sBtns.children[1];
    assert(sAdd.textContent === "添加文件夹...", "有添加文件夹按钮");
    assert(sDel.textContent === "移除选中", "有移除选中按钮");
    // 勾选自定义目录: 列表区展开, 输出目录的勾保持不变 (关键: 可多选)
    sRows.children[2].dispatch("click");
    assert(sRows.children[2].textContent.indexOf("✓") === 0, "勾选自定义目录");
    assert(sRows.children[0].textContent.indexOf("✓") === 0, "勾选自定义后输出目录仍保持勾选 (多选)");
    // 全部取消勾选后点确定会被拦下
    sRows.children[0].dispatch("click"); // 取消输出
    assert(sRows.children[0].textContent.indexOf("✓") !== 0, "再点一次可取消勾选输出目录");
    const setOk = sBody.children[3].children[0];
    setOk.dispatch("click");
    assert(
        !JSON.parse(localStorage.getItem("pm.gallery.settings") || "{}").hasOwnProperty("dirs") ||
        (JSON.parse(localStorage.getItem("pm.gallery.settings") || "{}").dirs || ["output"]).indexOf("output") >= 0,
        "全部取消勾选时不保存 (输出目录仍是旧值)"
    );
    sRows.children[0].dispatch("click"); // 重新勾回输出
    // 点添加 → 弹出目录浏览, 选中 D://pics
    globalThis.__pmDirsRes = { path: "", dirs: [{ name: "pics", path: "D:////pics" }], parent: "" };
    sAdd.dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const browseMask = document.body.children
        .filter((c) => c.className === "pm-mask")
        .pop();
    const browseDlg = browseMask.children[0];
    assert(browseDlg.children[0].children[0].textContent === "选择文件夹", "点添加弹出目录浏览");
    const dirList = browseDlg.children[1].children[1];
    const dirItems = dirList.children.filter((c) =>
        (c.className || "").indexOf("pm-dir-item") >= 0 && (c.className || "").indexOf("pm-dir-up") < 0
    );
    assert(dirItems.length === 1 && dirItems[0].textContent === "pics", "浏览列表显示 pics");
    dirItems[0].dispatch("click"); // 进入该目录
    await new Promise((r) => setTimeout(r, 30));
    browseDlg.children[1].children[3].children[0].dispatch("click"); // 选择此目录
    await new Promise((r) => setTimeout(r, 30));
    assert(sList.children.length === 1 && sList.children[0].value === "D:////pics", "选中的目录进了列表");
    // 再添加第二个目录
    globalThis.__pmDirsRes = { path: "", dirs: [{ name: "more", path: "E:////more" }], parent: "" };
    sAdd.dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const browse2 = document.body.children.filter((c) => c.className === "pm-mask").pop();
    browse2.children[0].children[1].children[1].children.filter((c) => (c.className || "").indexOf("pm-dir-item") >= 0 && (c.className || "").indexOf("pm-dir-up") < 0)[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    browse2.children[0].children[1].children[3].children[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(sList.children.length === 2, "第二个目录也进了列表 (支持多目录)");
    // 选中第一项并移除
    sList.children[0].selected = true;
    sDel.dispatch("click");
    assert(sList.children.length === 1 && sList.children[0].value === "E:////more", "移除选中只剩一个目录");
    setOk.dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const lastCall1 = decodeURIComponent(String(api._calls[api._calls.length - 1]));
    assert(lastCall1.indexOf('dirs=["output"]') >= 0, "确定后带 dirs=[output] 重新扫描");
    assert(lastCall1.indexOf('paths=["E:////more"]') >= 0, "请求里带上目录列表 paths");
    const st1 = JSON.parse(localStorage.getItem("pm.gallery.settings") || "{}");
    assert(
        st1.useCustom === true && st1.dirs.length === 1 && st1.dirs[0] === "output" &&
        st1.paths.length === 1 && st1.paths[0] === "E:////more",
        "勾选组合 + 目录列表已存进 localStorage"
    );
    // 再打开: 同时勾上输入目录 (输出+输入多选), 取消自定义 → 只扫内置两个目录
    gHead.children[4].dispatch("click");
    const m2 = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const d2 = m2.children[0];
    d2.children[1].children[1].children[1].dispatch("click"); // 勾选输入目录
    d2.children[1].children[1].children[2].dispatch("click"); // 取消自定义目录
    assert(
        d2.children[1].children[1].children[0].textContent.indexOf("✓") === 0 &&
        d2.children[1].children[1].children[1].textContent.indexOf("✓") === 0,
        "输出与输入可同时勾选"
    );
    d2.children[1].children[3].children[0].dispatch("click"); // 确定
    await new Promise((r) => setTimeout(r, 30));
    const lastCall2 = decodeURIComponent(String(api._calls[api._calls.length - 1]));
    assert(lastCall2.indexOf('dirs=["output","input"]') >= 0, "输出+输入同时扫描 (dirs 多选)");
    assert(lastCall2.indexOf("paths=%5B%5D") >= 0 || lastCall2.indexOf('paths=[]') >= 0, "取消自定义后不再带目录列表");
    const st2 = JSON.parse(localStorage.getItem("pm.gallery.settings") || "{}");
    assert(st2.dirs.length === 2 && st2.useCustom === false, "多选组合已存进 localStorage");
    // 恢复默认: 只勾输出
    gHead.children[4].dispatch("click");
    const m3 = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const d3 = m3.children[0];
    d3.children[1].children[1].children[1].dispatch("click"); // 取消输入
    d3.children[1].children[3].children[0].dispatch("click"); // 确定
    await new Promise((r) => setTimeout(r, 30));
    const lastCall3 = decodeURIComponent(String(api._calls[api._calls.length - 1]));
    assert(lastCall3.indexOf('dirs=["output"]') >= 0, "恢复为只扫描输出目录");
    assert(
        JSON.parse(localStorage.getItem("pm.gallery.settings") || "{}").dirs.length === 1,
        "默认设置已恢复"
    );

    // 点缩略图 → 大图查看 (左图 + 右元数据面板), 可左右切换, 点空白关闭
    globalThis.__pmMetaRes = {
        ok: true,
        format: "PNG",
        width: 1920,
        height: 1080,
        has_workflow: true,
        prompts: [
            { label: "正向提示词", text: "一只猫, 高质量" },
            { label: "反向提示词", text: "lowres" },
        ],
        params: [
            { key: "seed", label: "种子 (seed)", value: "816466005045886" },
            { key: "steps", label: "步数", value: "8" },
            { key: "cfg", label: "CFG 引导系数", value: "1" },
            { key: "denoise", label: "降噪", value: "1" },
            { key: "sampler", label: "采样", value: "euler" },
            { key: "scheduler", label: "调度", value: "sgm_uniform" },
        ],
    };
    gGrid.children[0].dispatch("click");
    const vMask = document.body.children.filter((c) => c.className.indexOf("pm-gallery-viewer") >= 0).pop();
    assert(!!vMask, "点缩略图打开大图查看");
    const vBox = vMask.children[0];
    assert(vBox.children.length === 3, "查看器 = 关闭X + 左图区 + 右信息面板");
    const vLeft = vBox.children[1];
    const vSide = vBox.children[2];
    assert(vLeft.className === "pm-gallery-viewer-left", "第二项是左侧图区");
    assert(vSide.className === "pm-gallery-viewer-side", "第三项是右侧信息面板");
    assert(vLeft.children[0].src === "/view?a", "大图显示对应图片");
    assert(vLeft.children[1].textContent === "1/3 · a.png", "大图下方显示序号与文件名");
    const navBtns = vLeft.children.filter((c) => c.className.indexOf("pm-gallery-viewer-nav") >= 0);
    assert(navBtns.length === 2, "大图有上一张/下一张两个按钮");
    navBtns[1].dispatch("click");
    assert(vLeft.children[1].textContent === "2/3 · b.png", "点下一张切到第二张");
    await new Promise((r) => setTimeout(r, 30));
    assert(vSide.children[0].textContent === "图片信息", "右侧面板有标题");
    assert(vSide.children[1].textContent === "1920×1080 · PNG", "右侧面板显示尺寸与格式");
    // 面板结构: 0 标题 / 1 尺寸 / 2 动作区 / 3 提示词卡片 / 4 底部参数栏
    const actBar = vSide.children[2];
    assert(actBar.className === "pm-meta-actions", "面板有工作流/参数动作区");
    assert(actBar.style.display !== "none", "有工作流或参数时动作区显示");
    const wfBtn = actBar.children[0];
    const paramBtn = actBar.children[1];
    assert(wfBtn.textContent === "载入此图工作流", "动作区第一个按钮是载入工作流");
    assert(paramBtn.textContent === "参数套到画布", "动作区第二个按钮是套用参数");
    const metaCards = vSide.children[3].children.filter((c) => c.className === "pm-meta-card");
    assert(metaCards.length === 2, "元数据渲染出 2 张提示词卡片");
    assert(metaCards[0].children[0].children[0].textContent === "正向提示词", "第一张卡标为正向提示词");
    assert(metaCards[0].children[1].textContent === "一只猫, 高质量", "卡片显示提示词全文");
    assert(metaCards[1].children[0].children[0].textContent === "反向提示词", "第二张卡标为反向提示词");
    globalThis.__copied = null;
    metaCards[0].children[0].children[2].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(globalThis.__copied === "一只猫, 高质量", "点复制提示词写入剪贴板");
    assert(
        metaCards[0].children[0].children[2].textContent === "已复制 ✓",
        "复制后按钮就地显示已复制"
    );
    // 复制失败 (被浏览器拦掉) 也要有反馈
    const origWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async () => {
        throw new Error("denied");
    };
    metaCards[1].children[0].children[2].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(
        metaCards[1].children[0].children[2].textContent === "复制失败 ✕",
        "复制失败时按钮显示失败"
    );
    navigator.clipboard.writeText = origWrite;
    // toast 层级要高过查看器遮罩, 否则弹窗里的操作看不见提示
    const toastBox = document.body.children.filter((c) => c.id === "pm-toast-box").pop();
    assert(
        !!toastBox && String(toastBox.style.cssText).indexOf("z-index:100500") >= 0,
        "toast 层级高过大图查看器"
    );
    // 点保存提示词 → 弹出保存对话框, 文本取自图片内嵌提示词
    metaCards[0].children[0].children[1].dispatch("click");
    assert(!!S.saveDialog, "点保存提示词弹出保存对话框");
    assert(S.saveDialog.mask.className.indexOf("pm-mask") >= 0, "保存对话框用 pm-mask");
    const svBody = S.saveDialog.mask.children[0].children[1];
    const svInput = svBody.children[0];
    assert(!!svInput, "保存对话框有名称输入框");
    svInput.value = "来自图片的提示词";
    const callsBeforeSv = api._calls.length;
    svBody.children[3].children[1].dispatch("click"); // 保存
    await new Promise((r) => setTimeout(r, 40));
    assert(api._calls.length > callsBeforeSv, "保存对话框提交调用了接口");
    const svOpt = api._opts[callsBeforeSv];
    assert(
        svOpt && String(svOpt.body || "").indexOf("一只猫, 高质量") >= 0,
        "保存内容为图片内嵌提示词全文"
    );
    assert(!S.saveDialog, "保存成功后对话框关闭");
    // 只取参数套到画布: 不动工作流, 只改采样器节点上的 widget
    paramBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 20));
    const ksNode = app.graph._nodes.filter((n) => n.type === "KSampler")[0];
    const wOf = (name) => ksNode.widgets.filter((w) => w.name === name)[0];
    assert(wOf("steps").value === 8, "步数已套到画布上的采样器 (数字类型)");
    assert(wOf("cfg").value === 1, "CFG 已套用");
    assert(String(wOf("seed").value) === "816466005045886", "种子已套用");
    assert(wOf("sampler_name").value === "euler", "采样器名已套用");
    assert(wOf("scheduler").value === "sgm_uniform", "调度已套用");
    assert(
        ksNode.widgets.filter((w) => w.name === "text").length === 0,
        "只有采样器节点被动过 (文本节点没被塞参数)"
    );

    // 底部固定参数栏 (面板第 5 项, 不随提示词滚动)
    const paramBar = vSide.children[4];
    assert(paramBar.className === "pm-gallery-viewer-side-params", "面板有独立参数栏");
    assert(paramBar.style.display !== "none", "有参数时参数栏显示");
    const paramGrid = paramBar.children[0];
    assert(paramGrid.className === "pm-meta-params", "参数栏里渲染参数网格");
    assert(paramGrid.children.length === 6, "参数网格有 6 项 (种子/步数/CFG/降噪/采样/调度)");
    assert(paramGrid.children[0].children[0].textContent === "种子 (seed)", "参数项显示标签");
    assert(paramGrid.children[0].children[1].textContent === "816466005045886", "参数项显示数值");
    assert(paramGrid.children[4].children[1].textContent === "euler", "采样值正确");
    assert(paramGrid.children[5].children[1].textContent === "sgm_uniform", "调度值正确");
    navBtns[0].dispatch("click");
    assert(vLeft.children[1].textContent === "1/3 · a.png", "点上一张回到第一张");
    vMask.dispatch("click", { target: vMask });
    assert(document.body.children.indexOf(vMask) < 0, "点空白关闭大图");

    // 无元数据图片: 显示空态而不是报错
    globalThis.__pmMetaRes = { ok: true, format: "PNG", width: 64, height: 64, prompts: [], has_workflow: false };
    gGrid.children[2].dispatch("click");
    const v2Mask = document.body.children.filter((c) => c.className.indexOf("pm-gallery-viewer") >= 0).pop();
    await new Promise((r) => setTimeout(r, 30));
    const v2Side = v2Mask.children[0].children[2];
    assert(
        v2Side.children[3].children.filter((c) => c.className === "pm-meta-empty").length === 1,
        "无元数据时显示空态提示"
    );
    assert(
        v2Side.children[2].style.display === "none",
        "没有工作流也没有参数时动作区隐藏"
    );
    const v2Body = v2Side.children[3];
    assert(
        v2Body.children[v2Body.children.length - 1].className === "pm-meta-reserve",
        "无参数时底部留空占位"
    );
    assert(
        v2Side.children[4].children.length === 0 && v2Side.children[4].style.display === "none",
        "无参数时参数栏隐藏"
    );
    v2Mask.dispatch("click", { target: v2Mask });
    globalThis.__pmMetaRes = null;

    // 载入此图工作流: 先确认 (层级要高过查看器), 再回填画布
    globalThis.__pmMetaRes = {
        ok: true, format: "PNG", width: 1920, height: 1080, has_workflow: true,
        prompts: [], params: [],
    };
    globalThis.__pmWorkflowRes = { ok: true, has_workflow: true, workflow: { nodes: [{ id: 1, type: "KSampler" }], links: [] } };
    gGrid.children[0].dispatch("click");
    const v3Mask = document.body.children.filter((c) => c.className.indexOf("pm-gallery-viewer") >= 0).pop();
    await new Promise((r) => setTimeout(r, 30));
    const v3Side = v3Mask.children[0].children[2];
    const v3Act = v3Side.children[2];
    assert(v3Act.style.display !== "none", "有工作流时动作区显示");
    assert(v3Act.children[0].style.display !== "none", "有工作流时显示载入按钮");
    assert(v3Act.children[1].style.display === "none", "没有参数时隐藏套用参数按钮");
    v3Act.children[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const cfMask = document.body.children
        .filter((c) => (c.className || "").indexOf("pm-mask") >= 0)
        .pop();
    assert(!!cfMask, "点载入工作流先弹确认框");
    assert(
        String(cfMask.style.zIndex) === "100400",
        "确认框层级高过大图查看器 100300 (否则看不见)"
    );
    const cfBtns = cfMask.children[0].children[1].children[1];
    assert(cfBtns.children.length === 1, "确认框只有一个「载入并替换」按钮");
    // 先取消一次: 不应该请求、也不应该动画布
    cfMask.children[0].children[1].children[2].children[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/workflow") === 0).length === 0,
        "取消后不请求工作流"
    );
    // 再确认: 回填画布并关闭查看器
    v3Act.children[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const cf2 = document.body.children
        .filter((c) => (c.className || "").indexOf("pm-mask") >= 0)
        .pop();
    cf2.children[0].children[1].children[1].children[0].dispatch("click");
    await new Promise((r) => setTimeout(r, 40));
    assert(
        api._calls.filter((c) => c.indexOf("/prompt_manager/workflow") === 0).length === 1,
        "确认后请求图片内嵌工作流"
    );
    assert(api._calls.filter((c) => c.indexOf("/prompt_manager/workflow") === 0)[0].indexOf("filename=a.png") >= 0,
        "工作流请求带上当前文件名");
    assert(!!app._loadedGraph && app._loadedGraph.nodes.length === 1, "工作流已回填到画布");
    assert(document.body.children.indexOf(v3Mask) < 0, "载入成功后关闭大图查看器");
    globalThis.__pmMetaRes = null;
    globalThis.__pmWorkflowRes = null;

    // 点 X 才关闭图库
    gHead.children[5].dispatch("click");
    assert(document.body.children.indexOf(gMask) < 0, "点右上角 X 关闭图库窗口");
    assert(_pmGallery === null, "关闭后 _pmGallery 置空");
    globalThis.__pmGalleryRes = null;

    // 17b. 分批渲染: 45 张首批 40, 滚动到底自动补齐 (不再有"加载更多"哨兵)
    // 上一节把目录设成了 input 并落盘, 这里重置回 output
    localStorage.setItem("pm.gallery.settings", JSON.stringify({ dir: "output", order: "time", size: "m" }));
    const many = [];
    for (let i = 0; i < 45; i++) {
        many.push({ name: "img" + i + ".png", subfolder: "", mtime: 100 - i, size: 1, url: "/view?i" + i });
    }
    globalThis.__pmGalleryRes = { total: 45, count: 45, truncated: false, dir: "output", images: many };
    await openGalleryDialog();
    const g2Mask = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const g2Dlg = g2Mask.children[0];
    assert(g2Dlg.children[0].children[0].textContent === "图库 (45)", "标题显示 45 张");
    const g2Grid = g2Dlg.children[1];
    const g2Cells = g2Grid.children.filter((c) => c.className === "pm-gallery-cell");
    assert(g2Cells.length === 40, "首批只渲染 40 张 (分批加载)");
    assert(
        g2Grid.children.filter((c) => c.className === "pm-gallery-more").length === 0,
        "不再有加载更多哨兵"
    );
    assert(
        g2Dlg.children[2].textContent.indexOf("已显示 40 张") >= 0,
        "底部状态栏显示已显示 40/45"
    );
    g2Grid.scrollTop = 99999;
    g2Grid.scrollHeight = 99999;
    g2Grid.clientHeight = 500;
    g2Grid.dispatch("scroll");
    const g2Cells2 = g2Grid.children.filter((c) => c.className === "pm-gallery-cell");
    assert(g2Cells2.length === 45, "滚动到底补齐剩余 5 张");
    assert(
        g2Dlg.children[2].textContent === "共 45 张 · 输出目录",
        "全部加载完底部不再显示已显示数"
    );

    // 17c. 网格没被填满 (无滚动条) 时继续自动补批 —— 避免永远触发不了滚动
    const more2 = [];
    for (let i = 0; i < 100; i++) {
        more2.push({ name: "m" + i + ".png", subfolder: "", mtime: 200 - i, size: 1, url: "/view?m" + i });
    }
    globalThis.__pmGalleryRes = { total: 100, count: 100, truncated: false, dir: "output", images: more2 };
    await openGalleryDialog();
    const g3Mask = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const g3Grid = g3Mask.children[0].children[1];
    g3Grid.scrollHeight = 300; // 内容比容器矮 = 没有滚动条
    g3Grid.clientHeight = 800;
    g3Grid.dispatch("scroll");
    await new Promise((r) => setTimeout(r, 60));
    const g3Cells = g3Grid.children.filter((c) => c.className === "pm-gallery-cell");
    assert(g3Cells.length > 40, "网格没填满时自动继续补批 (不依赖滚动到底)");

    // 17d. 滚动条: 平时隐藏, 悬停/滚轮时才显示 (重开一个没滚过的图库)
    globalThis.__pmGalleryRes = { total: 2, count: 2, truncated: false, dir: "output", images: [
        { name: "x1.png", subfolder: "", type: "output", mtime: 2, size: 1, url: "/view?x1" },
        { name: "x2.png", subfolder: "", type: "output", mtime: 1, size: 1, url: "/view?x2" },
    ] };
    await openGalleryDialog();
    const g4Mask = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const g4Grid = g4Mask.children[0].children[1];
    assert(g4Grid.className.indexOf("pm-scroll-visible") < 0, "滚动条平时隐藏");
    g4Grid.dispatch("wheel");
    assert(g4Grid.className.indexOf("pm-scroll-visible") >= 0, "滚滚轮时显示滚动条");
    g4Grid.dispatch("mouseenter");
    assert(g4Grid.className.indexOf("pm-scroll-visible") >= 0, "鼠标划过时显示滚动条");
    g4Mask.children[0].children[0].children[5].dispatch("click");
    assert(document.body.children.indexOf(g4Mask) < 0, "测试后关闭图库");
    globalThis.__pmGalleryRes = null;

    // 17d2. 头部排序 / 缩略图按钮
    globalThis.__pmGalleryRes = { total: 2, count: 2, truncated: false, dir: "output", images: [
        { name: "s1.png", subfolder: "", type: "output", mtime: 2, size: 1, url: "/view?s1" },
        { name: "s2.png", subfolder: "", type: "output", mtime: 1, size: 1, url: "/view?s2" },
    ] };
    await openGalleryDialog();
    const g5Mask = document.body.children.filter((c) => c.className === "pm-mask").pop();
    const g5Head = g5Mask.children[0].children[0];
    const g5Grid = g5Mask.children[0].children[1];
    const menus = () => document.body.children.filter((c) => c.className === "pm-settings-menu");
    const callsBef = api._calls.length;
    g5Head.children[1].dispatch("click"); // 排序 → 弹出下拉菜单
    const om = menus().pop();
    assert(!!om, "点排序按钮弹出下拉菜单");
    assert(om.children.length === 3, "排序菜单 = 分组标题 + 两个选项");
    assert(om.children[0].textContent === "排序", "排序菜单分组标题是排序");
    assert(om.children[1].textContent.indexOf("最新在前") > 0, "菜单里有最新在前");
    assert(om.children[1].textContent.indexOf("✓") === 0, "当前项最新在前打勾");
    om.children[2].dispatch("click"); // 选「按名称」
    await new Promise((r) => setTimeout(r, 30));
    assert(menus().length === 0, "选完排序菜单收起");
    assert(String(api._calls[api._calls.length - 1]).indexOf("order=name") >= 0, "请求带 order=name");
    assert(g5Head.children[1].title.indexOf("按名称") >= 0, "排序按钮标题更新为按名称");

    g5Head.children[2].dispatch("click"); // 缩略图 → 弹出下拉菜单
    const sm = menus().pop();
    assert(!!sm, "点缩略图按钮弹出下拉菜单");
    assert(sm.children.length === 10, "缩略图菜单 = 尺寸(标题+3) + 上限(标题+5)");
    assert(sm.children[0].textContent === "缩略图", "缩略图菜单第一个分组是缩略图");
    assert(sm.children[2].textContent.indexOf("✓") === 0, "当前项「中」打勾");
    assert(sm.children[4].textContent === "显示上限", "第二个分组是显示上限");
    assert(sm.children[6].textContent.indexOf("✓") === 0, "上限默认 300 打勾");
    sm.children[3].dispatch("click"); // 选「大」
    assert(g5Grid.className.indexOf("pm-gallery-l") >= 0, "选大图后网格变大");
    assert(g5Head.children[2].title.indexOf("大") >= 0, "缩略图按钮标题更新为大");
    assert(menus().length === 0, "选完缩略图菜单收起");
    g5Head.children[2].dispatch("click");
    menus().pop().children[1].dispatch("click"); // 选「小」
    assert(g5Grid.className.indexOf("pm-gallery-s") >= 0, "选小图后网格变小");
    // 改显示上限 → 按新上限重新请求后端
    g5Head.children[2].dispatch("click");
    menus().pop().children[8].dispatch("click"); // 上限选 1000 张
    await new Promise((r) => setTimeout(r, 30));
    assert(String(api._calls[api._calls.length - 1]).indexOf("limit=1000") >= 0, "改上限后请求带 limit=1000");
    assert(g5Head.children[2].title.indexOf("上限 1000") >= 0, "缩略图按钮标题显示上限 1000");
    g5Head.children[2].dispatch("click");
    menus().pop().children[9].dispatch("click"); // 上限选 全部 (不限)
    await new Promise((r) => setTimeout(r, 30));
    assert(String(api._calls[api._calls.length - 1]).indexOf("limit=0") >= 0, "选全部后请求带 limit=0 (不限)");
    assert(g5Head.children[2].title.indexOf("全部") >= 0, "缩略图按钮标题显示全部 (不限)");
    g5Head.children[5].dispatch("click"); // 关闭
    assert(document.body.children.indexOf(g5Mask) < 0, "按钮测试后关闭图库");
    pmSaveGallerySettings({ dir: "output", order: "time", size: "m" }); // 还原默认设置
    globalThis.__pmGalleryRes = null;

    // 17e. 每张缩略图删除到回收站
    globalThis.__pmGalleryRes = {
        total: 3, count: 3, truncated: false, dir: "output",
        images: [
            { name: "d1.png", subfolder: "", type: "output", mtime: 3, size: 1, url: "/view?d1" },
            { name: "d2.png", subfolder: "", type: "output", mtime: 2, size: 1, url: "/view?d2" },
            { name: "d3.png", subfolder: "sub", type: "output", mtime: 1, size: 1, url: "/view?d3" },
        ],
    };
    await openGalleryDialog();
    const tMaskBef = document.body.children.filter((c) => c.className === "pm-mask");
    const tDlg = tMaskBef[tMaskBef.length - 1].children[0];
    const tGrid = tDlg.children[1];
    const delBtn = tGrid.children[0].children[1];
    delBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 30));
    const masksNow = document.body.children.filter((c) => c.className === "pm-mask");
    assert(masksNow.length === tMaskBef.length + 1, "点删除只弹出确认框 (不会顺手打开看图)");
    const confirmDlg = masksNow[masksNow.length - 1].children[0];
    assert(confirmDlg.children[0].children[0].textContent === "删除图片", "确认框标题是删除图片");
    const collect = (el, out) => {
        (el.children || []).forEach((c) => {
            if (String(c.className || "").indexOf("pm-choice-btn") >= 0) out.push(c);
            collect(c, out);
        });
        return out;
    };
    const choiceBtns = collect(confirmDlg, []);
    const confirmBtn = choiceBtns.filter((b) => b.textContent === "移入回收站")[0];
    assert(!!confirmBtn, "确认框有「移入回收站」按钮");
    confirmBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 60));
    assert(api._calls.indexOf("/prompt_manager/trash") >= 0, "确认后调用后端回收站接口");
    const trashBody = JSON.parse(api._opts[api._opts.length - 1].body);
    assert(trashBody.filename === "d1.png", "请求体带文件名");
    assert(trashBody.type === "output", "请求体带目录类型");
    assert(trashBody.subfolder === "", "请求体带子目录");
    const leftCells = tGrid.children.filter((c) => c.className === "pm-gallery-cell");
    assert(leftCells.length === 2, "删除后网格少一张");
    assert(tDlg.children[0].children[0].textContent === "图库 (2)", "标题数量跟着减");
    assert(tDlg.children[2].textContent === "共 2 张 · 输出目录", "底部数量跟着减");
    const tFinal = document.body.children.filter((c) => c.className === "pm-mask").pop();
    tFinal.children[0].children[0].children[5].dispatch("click");
    assert(document.body.children.indexOf(tFinal) < 0, "删除后图库仍可正常关闭");
    globalThis.__pmGalleryRes = null;

    function documentStubCheck(el) {
        // menu 顶层挂在 body
        let n = el;
        while (n.parentNode) n = n.parentNode;
        return n === document.body;
    }

    /* ---------- 子图 (Subgraph) 内的节点也要挂上工具条 ---------- */
    // 实测背景: 新版 ComfyUI 的节点 DOM 上没有 data-node-id, 而且子图内部的节点
    // 压根不在 app.graph 里 —— 拿 id 去根图查永远查不到, 之前子图内的文本节点
    // 就一直没有工具条。这里模拟"根图查不到、只在子图的 graph 里"的场景。
    {
        const innerTa = document.createElement("textarea");
        const innerHost = document.createElement("div");
        innerHost.className = "dom-widget";
        innerHost.appendChild(innerTa);
        document.body.appendChild(innerHost);

        const innerNode = {
            id: "101",
            type: "CLIPTextEncode",
            title: "子图内文本",
            widgets: [{ name: "text", element: innerTa }],
        };
        const subGraph = {
            _nodes: [innerNode],
            getNodeById: (id) => (String(id) === "101" ? innerNode : null),
        };

        const savedQSA = document.querySelectorAll;
        const savedGet = app.graph.getNodeById;
        const savedSubs = app.graph.subgraphs;
        document.querySelectorAll = (sel) => (/textarea/.test(sel) ? [innerTa] : []);
        app.graph.subgraphs = new Map([["sg-1", { graph: subGraph }]]);
        app.graph.getNodeById = () => null; // 根图里确实查不到

        sweepTextareas();

        assert(!!innerHost.querySelector(".pm-toolbar"), "子图内节点的工具条被挂上");
        assert(innerTa._pmToolbarMounted === true, "子图内 textarea 被标记为已挂载");
        assert(pmAllGraphs().length === 2, "pmAllGraphs 同时找到根图与子图 (共 2 张)");
        const hit = pmFindNodeByTextarea(innerTa);
        assert(hit && hit.node === innerNode, "按 textarea 能反查到子图内的节点");

        // 还原, 免得影响后面的用例
        document.querySelectorAll = savedQSA;
        app.graph.getNodeById = savedGet;
        if (savedSubs === undefined) delete app.graph.subgraphs;
        else app.graph.subgraphs = savedSubs;
        innerHost.remove();
    }

    // 设置对话框里显示的许可证必须跟项目一致 (之前写死成 MIT 了)
    assert(PM_LICENSE === "GPL-3.0-or-later", "许可证常量是 GPL-3.0-or-later, 不是 MIT");

    console.log("✅ 全部 " + results.length + " 项断言通过:");
    results.forEach((m, i) => console.log("   " + (i + 1) + ". " + m));
})().catch((e) => {
    console.error("❌ " + e.message + " | " + String(e.stack || "").split(String.fromCharCode(10))[1]);
    process.exit(1);
});
`;

// document.dispatchEvent 桥接 (测试代码里调用)
documentStub.dispatchEvent = (ev) => documentStub.dispatch(ev.type || "keydown", ev);

try {
    vm.runInContext(testCode, sandbox, { filename: "vm-test.js" });
    // 测试完成后强制退出 (toast 等延时器会挂住事件循环)
    setTimeout(() => process.exit(0), 5000).unref?.();
} catch (e) {
    console.error("❌ 测试执行失败:", e.message);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
    process.exit(1);
}
