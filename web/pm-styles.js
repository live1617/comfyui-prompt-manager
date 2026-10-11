// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 全插件共用的样式表 (一次性注入 <style id="pm-toolbar-style">)
// 纯 CSS 文本, 不依赖任何别的模块 — 谁都可以 import

export function ensureStyles() {
    if (document.getElementById("pm-toolbar-style")) return;
    const style = document.createElement("style");
    style.id = "pm-toolbar-style";
    style.textContent = `
/* ===== 节点内工具条 ===== */
/* 默认: 直接挂在文本框容器内部, 绝对定位到左下角
   显示位置由 html[data-pm-pos] 控制 (设置面板可调) */
.pm-toolbar{position:absolute;left:8px;bottom:8px;z-index:20;pointer-events:none;}
html[data-pm-pos="tl"] .pm-toolbar{left:8px;top:8px;bottom:auto;}
html[data-pm-pos="tr"] .pm-toolbar{left:auto;right:8px;top:8px;bottom:auto;}
html[data-pm-pos="br"] .pm-toolbar{left:auto;right:8px;top:auto;bottom:8px;}
.pm-pill{position:absolute;left:0;bottom:0;display:flex;align-items:center;
    height:28px;max-width:30px;overflow:hidden;
    background:transparent;border:none;box-shadow:none;border-radius:14px;
    transition:max-width .22s ease,opacity .22s ease,background .22s ease;
    opacity:var(--pm-icon-opacity,.55);   /* 平时半透明, 可用该变量整体调透明度 */
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.65));  /* 轮廓阴影: 低透明度下也能看清 */
    pointer-events:auto;}
/* 悬停展开: 向右展开 + 完全不透明 + 出现浅底以承载按钮组 */
.pm-pill:hover{max-width:260px;opacity:1;background:rgba(24,24,24,.88);
    border:1px solid rgba(120,120,120,.45);box-shadow:0 2px 8px rgba(0,0,0,.35);}
/* 位置在右侧时: 锚点贴右、展开方向翻转向左 */
html[data-pm-pos="tr"] .pm-pill,html[data-pm-pos="br"] .pm-pill{left:auto;right:0;flex-direction:row-reverse;}
.pm-pill button{all:unset;box-sizing:border-box;width:0;opacity:0;overflow:hidden;
    text-align:center;height:26px;cursor:pointer;color:#d8d8d8;
    border-radius:13px;transition:width .18s ease,opacity .18s ease,background .15s ease,transform .15s ease;}
.pm-pill button svg{display:block;margin:0 auto;}
.pm-pill:hover button{width:30px;opacity:1;}
.pm-pill button:hover{background:rgba(255,255,255,.12);color:#fff;transform:scale(1.12);}
.pm-pill button:active{transform:scale(.95);}
.pm-pill .pm-trigger{width:28px;opacity:1;color:#d0d0d0;}
.pm-pill .pm-trigger:hover{background:transparent;color:#fff;}
/* 分组分隔线 (展开时才显示) */
.pm-actions-divider{flex:0 0 auto;width:0;height:14px;background:rgba(255,255,255,.25);
    margin:0;opacity:0;transition:width .18s ease,opacity .18s ease,margin .18s ease;}
.pm-pill:hover .pm-actions-divider{width:1px;margin:0 3px;opacity:1;}

/* ===== 对话框 (列表 / 保存) ===== */
.pm-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);
    display:flex;align-items:center;justify-content:center;animation:pm-fade .14s ease;}
@keyframes pm-fade{from{opacity:0}to{opacity:1}}
.pm-dialog{width:460px;max-width:92vw;max-height:76vh;display:flex;flex-direction:column;
    background:#242424;border:1px solid #3d3d3d;border-radius:12px;overflow:hidden;
    box-shadow:0 16px 48px rgba(0,0,0,.6);color:#e8e8e8;
    font-family:inherit;animation:pm-pop .16s ease;}
.pm-dialog-sm{width:360px;}
.pm-dialog-set{width:430px;}
.pm-dialog-wide{width:560px;height:800px;min-height:0;}
.pm-dialog-body-row{flex:1;display:flex;min-height:0;height:100%;overflow:hidden;}
.pm-cat-side{flex:0 0 112px;display:flex;flex-direction:column;min-height:0;
    border-right:1px solid #343434;background:#1e1e1e;}
.pm-cat-side-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;
    padding:10px 6px;overflow-y:auto;}
.pm-cat-side-list::-webkit-scrollbar{width:6px;}
.pm-cat-side-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:3px;}
.pm-cat-side-foot{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;
    gap:2px;padding:6px;border-top:1px solid #343434;}
.pm-cat-side-foot .pm-tab{width:100%;text-align:center;font-size:13px;}
.pm-cat-side .pm-tab{display:block;width:100%;text-align:left;padding:7px 10px;font-size:12px;
    border-radius:6px;}
.pm-cat-side .pm-tab-on{background:rgba(47,111,221,.24);color:#fff;}
.pm-cat-side .pm-tab-on::after{content:"";position:absolute;left:8px;right:8px;bottom:1px;
    height:2px;border-radius:2px;background:#2f6fdd;}
.pm-cat-side .pm-tab-add,.pm-cat-side .pm-tab-manage{text-align:center;}
.pm-cat-side-foot .pm-tab-manage{width:100%;}
.pm-list-col{flex:1;min-width:0;display:flex;flex-direction:column;}
.pm-list-col .pm-dialog-hint{padding:6px 14px 4px;}
.pm-list-col .pm-dialog-list{flex:1;}
.pm-dialog-dup{width:520px;height:520px;min-height:0;display:flex;flex-direction:column;}
.pm-dup-btn:hover{background:rgba(47,111,221,.24);color:#9fd0ff;}
.pm-dup-list{flex:1;min-height:0;overflow-y:auto;padding:8px 12px;
    display:flex;flex-direction:column;gap:8px;}
.pm-dup-list::-webkit-scrollbar{width:8px;}
.pm-dup-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-dup-card{border:1px solid #343434;border-radius:8px;padding:8px 10px;background:#242424;
    display:flex;flex-direction:column;gap:5px;}
.pm-dup-preview{font-size:11.5px;color:#8b8b8b;line-height:1.5;max-height:34px;overflow:hidden;}
.pm-dup-row{display:flex;align-items:center;gap:8px;}
.pm-dup-keep{all:unset;box-sizing:border-box;min-width:64px;text-align:center;padding:3px 8px;
    border:1px solid #3d3d3d;border-radius:6px;color:#9a9a9a;font-size:11.5px;cursor:pointer;}
.pm-dup-keep:hover{border-color:#6b6b6b;color:#ddd;}
.pm-dup-keep-on{background:#2f6fdd;border-color:#2f6fdd;color:#fff;}
.pm-dup-keep-on:hover{background:#3d7ce8;color:#fff;}
.pm-dup-name{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pm-dup-cat{font-size:11px;color:#7c7c7c;flex:0 0 auto;}
.pm-dup-summary{padding:7px 14px;font-size:11.5px;color:#8b8b8b;border-top:1px solid #343434;}
.pm-hover-tip{position:fixed;z-index:100200;max-width:420px;max-height:60vh;overflow:auto;
    padding:10px 12px;background:#1f1f1f;border:1px solid #454545;border-radius:10px;
    color:#e2e2e2;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;
    box-shadow:0 12px 32px rgba(0,0,0,.6);pointer-events:none;animation:pm-fade .12s ease;}
.pm-hover-tip::-webkit-scrollbar{width:8px;}
.pm-hover-tip::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-topbar-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;
    justify-content:center;width:34px;height:34px;flex:0 0 auto;margin:0 2px;padding:0;
    border-radius:8px;cursor:pointer;color:var(--fg-color,#e8e8e8);
    transition:background .15s ease,color .15s ease;}
.pm-topbar-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-topbar-btn svg{width:18px;height:18px;}
.pm-topbar-pop{position:fixed;z-index:100100;display:flex;align-items:center;gap:2px;padding:4px;
    background:#2c2c2c;border:1px solid #3d3d3d;border-radius:9px;
    box-shadow:0 10px 30px rgba(0,0,0,.55);animation:pm-pop .12s ease;}
.pm-topbar-pop-btn{all:unset;box-sizing:border-box;width:30px;height:30px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#c8c8c8;
    transition:background .12s ease,color .12s ease;}
.pm-topbar-pop-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-topbar-pop-btn svg{width:16px;height:16px;}
@keyframes pm-pop{from{transform:translateY(6px) scale(.98);opacity:.6}to{transform:none;opacity:1}}
.pm-dialog-head{display:flex;align-items:center;gap:10px;padding:12px 14px;
    border-bottom:1px solid #343434;background:#282828;}
.pm-dialog-title{flex:1;font-size:14px;font-weight:600;letter-spacing:.3px;}
.pm-dialog-close{all:unset;box-sizing:border-box;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#b6b6b6;
    transition:background .15s ease,color .15s ease;}
.pm-dialog-close:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-dialog-gallery{width:94vw;height:92vh;min-height:0;
    display:flex;flex-direction:column;}
.pm-gallery-grid{flex:1;min-height:0;overflow-y:auto;padding:12px;
    display:grid;gap:10px;align-content:start;
    grid-template-columns:repeat(auto-fill,minmax(170px,1fr));}
.pm-gallery-grid.pm-gallery-s{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;}
.pm-gallery-grid.pm-gallery-l{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
/* 滚动条: 平时完全隐藏, 鼠标划过网格或滚滚轮时才显示 */
.pm-gallery-grid{scrollbar-width:thin;scrollbar-color:transparent transparent;}
.pm-gallery-grid.pm-scroll-visible,.pm-gallery-grid:hover{scrollbar-color:rgba(255,255,255,.38) transparent;}
.pm-gallery-grid::-webkit-scrollbar{width:10px;}
.pm-gallery-grid::-webkit-scrollbar-track{background:transparent;}
.pm-gallery-grid::-webkit-scrollbar-thumb{background:transparent;border:2px solid transparent;
    border-radius:6px;background-clip:padding-box;transition:background .18s ease;}
.pm-gallery-grid.pm-scroll-visible::-webkit-scrollbar-thumb,
.pm-gallery-grid:hover::-webkit-scrollbar-thumb{background:rgba(255,255,255,.38);
    background-clip:padding-box;border:2px solid transparent;border-radius:6px;}
.pm-gallery-cell{position:relative;border:1px solid #343434;border-radius:8px;overflow:hidden;
    background:#000;cursor:pointer;transition:border-color .15s ease;}
.pm-gallery-cell:hover{border-color:#2f6fdd;}
/* 正方形不靠 CSS 技巧 (aspect-ratio / padding-top 在部分内核的自动行高 grid 里会把
   格子高度塌陷成横条), 由 JS 把 grid-auto-rows 设成实测列宽, 行高=列宽必为正方形 */
/* contain: 图片完整显示居中, 不足处黑色填充 (不裁剪) */
.pm-gallery-img{width:100%;height:100%;object-fit:contain;display:block;background:#000;}
.pm-gallery-img.pm-gallery-err{opacity:.22;}
/* 缩略图右下角的删除按钮 (移入回收站): 默认隐藏, 鼠标移到该缩略图上才显示 */
.pm-gallery-del{all:unset;box-sizing:border-box;position:absolute;bottom:4px;right:4px;
    width:24px;height:24px;display:flex;align-items:center;justify-content:center;
    border-radius:6px;cursor:pointer;color:#f0f0f0;background:rgba(0,0,0,.55);
    opacity:0;visibility:hidden;pointer-events:none;
    transition:background .15s ease,color .15s ease,opacity .15s ease,visibility .15s ease;}
.pm-gallery-cell:hover .pm-gallery-del,
.pm-gallery-del:focus-visible{opacity:1;visibility:visible;pointer-events:auto;}
.pm-gallery-del:hover{background:#c02d2d;color:#fff;opacity:1;visibility:visible;pointer-events:auto;}
.pm-gallery-del:disabled{opacity:.4;cursor:default;}
.pm-gallery-del svg{width:14px;height:14px;}
.pm-gallery-empty{grid-column:1/-1;padding:40px 0;text-align:center;color:#7c7c7c;font-size:12.5px;}
/* 图库设置对话框: 目录选择行 + 自定义路径 + 文件夹浏览列表 */
.pm-dir-rows{display:flex;flex-direction:column;gap:2px;}
.pm-dir-row{text-align:left;width:100%;}
.pm-dir-row-on{color:#8ab4ff;}
/* 自定义目录列表: 左侧多选列表 + 右侧按钮列 */
.pm-dir-custom{display:flex;gap:8px;align-items:stretch;margin-top:6px;}
.pm-dir-list{flex:1;min-width:0;background:#1b1b1b;color:#e8e8e8;border:1px solid #3a3a3a;
    border-radius:6px;padding:4px;font-size:12px;font-family:inherit;}
.pm-dir-list option{padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-dir-btns{display:flex;flex-direction:column;gap:6px;justify-content:center;}
.pm-dir-path{font-size:11.5px;color:#9a9a9a;word-break:break-all;}
.pm-dirlist{max-height:260px;overflow:auto;border:1px solid #3a3a3a;border-radius:6px;
    padding:4px;background:#171717;}
.pm-dir-item{padding:5px 8px;border-radius:5px;cursor:pointer;font-size:12.5px;color:#ccc;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pm-dir-item:hover{background:#2b2b2b;color:#fff;}
.pm-dir-up{color:#8ab4ff;}
.pm-dir-empty{padding:10px;text-align:center;color:#7c7c7c;font-size:12.5px;}
.pm-gallery-foot{flex:0 0 auto;padding:7px 14px;font-size:11.5px;color:#8b8b8b;
    border-top:1px solid #343434;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* 查看器窗口固定大小, 不随图片比例跳动 */
.pm-gallery-viewer-box{position:relative;width:94vw;height:92vh;display:flex;
    flex-direction:row;align-items:stretch;gap:12px;padding:10px;}
.pm-gallery-viewer-left{position:relative;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;
    align-items:stretch;gap:8px;justify-content:center;}
.pm-gallery-viewer-img{flex:1 1 auto;min-height:0;width:100%;object-fit:contain;border-radius:8px;
    background:#111;box-shadow:0 12px 40px rgba(0,0,0,.7);}
.pm-gallery-viewer-cap{flex:0 0 auto;font-size:12px;color:#c8c8c8;max-width:100%;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;text-align:center;}
.pm-gallery-viewer-x{position:absolute;top:2px;right:2px;z-index:2;background:rgba(0,0,0,.45);}
.pm-gallery-viewer-nav{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);
    width:34px;height:52px;display:flex;align-items:center;justify-content:center;font-size:24px;
    border-radius:8px;cursor:pointer;color:#ddd;background:rgba(0,0,0,.35);}
.pm-gallery-viewer-side{flex:0 0 300px;display:flex;flex-direction:column;
    background:#232323;border:1px solid #3a3a3a;border-radius:10px;overflow:hidden;}
.pm-gallery-viewer-side-head{flex:0 0 auto;padding:9px 12px 7px;font-size:13px;color:#eee;
    font-weight:600;border-bottom:1px solid #383838;}
.pm-gallery-viewer-side-info{flex:0 0 auto;padding:6px 12px;font-size:11.5px;color:#8fd0a0;}
.pm-gallery-viewer-side-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;
    padding:8px 12px 12px;}
.pm-gallery-viewer-side-params{flex:0 0 auto;display:flex;flex-direction:column;
    padding:9px 12px 12px;border-top:1px solid #383838;background:#232323;}
.pm-meta-card{background:#2b2b2b;border:1px solid #3d3d3d;border-radius:8px;
    padding:8px 10px;margin-bottom:8px;flex:1 1 0;min-height:110px;
    display:flex;flex-direction:column;overflow:hidden;}
.pm-meta-row{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 8px;margin-bottom:6px;}
.pm-meta-tag{display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;
    color:#9fd0ff;background:rgba(80,140,255,.14);border:1px solid rgba(80,140,255,.3);}
.pm-meta-copy{all:unset;box-sizing:border-box;flex:0 0 auto;padding:3px 9px;font-size:11px;
    border:1px solid #4a4a4a;border-radius:6px;color:#a8d8b0;cursor:pointer;white-space:nowrap;}
.pm-meta-copy:hover{border-color:#6b9b78;background:rgba(90,200,120,.12);color:#bceac6;}
.pm-meta-actions{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:8px;padding:8px 0 10px;}
.pm-meta-text{flex:1 1 auto;min-height:0;font-size:12px;color:#cfcfcf;line-height:1.6;white-space:pre-wrap;
    word-break:break-word;overflow-y:auto;padding-right:2px;}
.pm-meta-text::-webkit-scrollbar{width:6px;}
.pm-meta-text::-webkit-scrollbar-thumb{background:#454545;border-radius:3px;}
.pm-meta-reserve{flex:0 0 96px;margin-bottom:8px;}
.pm-meta-params{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.pm-meta-param{background:#2b2b2b;border:1px solid #3d3d3d;border-radius:8px;
    padding:7px 10px;min-width:0;}
.pm-meta-param-k{font-size:10.5px;color:#8b8b8b;margin-bottom:3px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-meta-param-v{font-size:12.5px;font-weight:700;color:#f0f0f0;word-break:break-all;}
.pm-meta-empty{padding:26px 4px;text-align:center;color:#7c7c7c;font-size:12px;line-height:1.7;}
.pm-gallery-viewer-nav:hover{background:rgba(47,111,221,.55);color:#fff;}
.pm-gallery-viewer-nav.pm-gallery-prev{left:10px;}
.pm-gallery-viewer-nav.pm-gallery-next{right:10px;}
.pm-settings-label{font-size:11px;color:#7c7c7c;cursor:default;padding:4px 10px 2px;}
.pm-settings-label:hover{background:transparent;color:#7c7c7c;}
.pm-settings-menu{position:fixed;z-index:100100;min-width:190px;padding:5px;
    background:#2c2c2c;border:1px solid #3d3d3d;border-radius:9px;
    box-shadow:0 10px 30px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:2px;
    animation:pm-pop .12s ease;}
.pm-settings-item{all:unset;box-sizing:border-box;padding:8px 12px;font-size:12.5px;
    color:#e0e0e0;border-radius:6px;cursor:pointer;white-space:nowrap;text-align:left;
    transition:background .12s ease,color .12s ease;}
.pm-settings-item:hover{background:#2f6fdd;color:#fff;}
/* 提示词库对话框 (顶栏 ⚙) 里的导入/导出卡片: 中性灰, 不带彩色 */
.pm-lib-item{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;
    background:#2b2b2b;border:1px solid #3d3d3d;border-radius:8px;padding:10px 12px;
    margin-bottom:8px;cursor:pointer;transition:background .15s ease,border-color .15s ease;}
.pm-lib-item:hover{background:rgba(255,255,255,.06);border-color:#4f4f4f;}
.pm-lib-item-icon{flex:0 0 26px;width:26px;height:26px;display:flex;align-items:center;
    justify-content:center;border-radius:6px;color:#b6b6b6;background:rgba(255,255,255,.05);}
.pm-lib-item-icon svg{width:15px;height:15px;}
.pm-lib-item:hover .pm-lib-item-icon{color:#fff;}
.pm-lib-item-txt{min-width:0;}
.pm-lib-item-t{font-size:13px;color:#e0e0e0;font-weight:600;margin-bottom:2px;}
.pm-lib-item-d{font-size:11px;color:#8b8b8b;line-height:1.5;}
.pm-dialog-close svg,.pm-item-del svg{width:15px;height:15px;}
.pm-dialog-search{padding:10px 14px 6px;}
.pm-dialog-body input,.pm-dialog-body textarea,.pm-dialog-body select{width:100%;box-sizing:border-box;padding:7px 10px;
    font-size:13px;color:#e8e8e8;background:#1b1b1b;border:1px solid #3d3d3d;border-radius:7px;
    outline:none;transition:border-color .15s ease;font-family:inherit;}
.pm-dialog-body input:focus,.pm-dialog-body textarea:focus,.pm-dialog-body select:focus{border-color:#6b6b6b;}
.pm-dialog-new{width:520px;max-width:92vw;}
.pm-new-field{margin-bottom:12px;}
.pm-new-label{font-size:11.5px;color:#8b8b8b;margin-bottom:5px;}
.pm-new-body textarea{resize:vertical;min-height:120px;line-height:1.5;}
.pm-new-actions{padding:0 14px 14px;}
.pm-dialog-conflict{width:560px;max-width:92vw;max-height:80vh;}
.pm-conflict-body{flex:1;min-height:0;}
.pm-conflict-list{flex:1;min-height:0;overflow-y:auto;padding:2px;
    display:flex;flex-direction:column;gap:8px;}
.pm-conflict-list::-webkit-scrollbar{width:8px;}
.pm-conflict-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-conflict-card{border:1px solid #343434;border-radius:8px;padding:8px 10px;background:#2a2a2a;
    display:flex;flex-direction:column;gap:5px;}
.pm-conflict-name{font-size:12.5px;color:#ededed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-conflict-pre{font-size:11.5px;color:#8b8b8b;line-height:1.5;max-height:32px;overflow:hidden;}
.pm-conflict-actions{padding:0 14px 14px;}
.pm-dialog-hint{padding:2px 14px 8px;font-size:11.5px;color:#8b8b8b;}
.pm-dialog-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px;}
.pm-dialog-body .pm-dialog-hint{padding:0;}
.pm-dialog-actions{display:flex;justify-content:flex-end;gap:8px;}
.pm-btn{padding:6px 18px;border-radius:7px;border:1px solid #3d3d3d;background:#333;
    color:#ddd;cursor:pointer;font-size:13px;transition:background .15s ease,border-color .15s ease;}
.pm-btn:hover{background:#3f3f3f;}
.pm-btn-primary{background:#2f6fdd;border-color:#2f6fdd;color:#fff;}
.pm-btn-primary:hover{background:#3d7ce8;}
.pm-dialog-list{flex:1;overflow-y:auto;padding:4px 8px 10px;}
.pm-dialog-list::-webkit-scrollbar{width:8px;}
.pm-dialog-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-dialog-list::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28);}
.pm-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;
    cursor:pointer;transition:background .12s ease;}
.pm-item:hover{background:rgba(255,255,255,.08);}
.pm-item-main{flex:1;min-width:0;}
.pm-item-name{font-size:13px;color:#ededed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-item-preview{font-size:11.5px;color:#8a8a8a;margin-top:2px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-item-del{all:unset;box-sizing:border-box;flex:0 0 auto;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#8a8a8a;
    opacity:0;transition:opacity .15s ease,background .15s ease,color .15s ease;}
.pm-item:hover .pm-item-del{opacity:1;}
.pm-item-del:hover{background:rgba(220,80,80,.22);color:#ff8a8a;}
.pm-item-move:hover{background:rgba(47,111,221,.22);color:#9fd0ff;}
.pm-item-rename:hover{background:rgba(90,200,120,.2);color:#8ee6a5;}
.pm-move-cats{max-height:200px;overflow-y:auto;padding:2px;}
.pm-move-cats::-webkit-scrollbar{width:8px;}
.pm-move-cats::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-move-cats .pm-tab{display:inline-block;margin:2px;}
.pm-item-cat{display:inline-block;align-self:flex-start;margin-top:3px;padding:1px 7px;
    font-size:11px;color:#9a9a9a;background:rgba(255,255,255,.07);
    border:1px solid rgba(255,255,255,.08);border-radius:5px;}
.pm-empty{padding:30px 12px;text-align:center;font-size:12.5px;color:#7d7d7d;line-height:1.7;}
.pm-cat-bar{display:flex;align-items:center;gap:2px;padding:0 14px 6px;overflow-x:auto;}
.pm-cat-bar::-webkit-scrollbar{height:0;}
.pm-tab{all:unset;box-sizing:border-box;position:relative;padding:6px 11px;font-size:12.5px;
    color:#9a9a9a;cursor:pointer;white-space:nowrap;border-radius:6px;
    transition:color .15s ease,background .15s ease;}
.pm-tab:hover{color:#e8e8e8;background:rgba(255,255,255,.06);}
.pm-tab-on{color:#fff;}
.pm-tab-on::after{content:"";position:absolute;left:9px;right:9px;bottom:-2px;height:2px;
    border-radius:2px;background:#2f6fdd;}
.pm-tab-add{color:#8a8a8a;font-size:14px;padding:6px 9px;}
.pm-tab-add:hover{color:#9fd0ff;}
.pm-tab-manage{display:flex;align-items:center;padding:6px 8px;color:#8a8a8a;}
.pm-tab-manage:hover{color:#fff;}
.pm-tab-manage svg{width:13px;height:13px;}
.pm-cat-manage-list{max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;
    padding:2px;}
.pm-cat-manage-list::-webkit-scrollbar{width:8px;}
.pm-cat-manage-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px;}
.pm-cat-man-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;
    background:#2a2a2a;border:1px solid #3d3d3d;}
.pm-cat-man-row:hover{border-color:#5a5a5a;}
.pm-cat-man-name{flex:1;min-width:0;font-size:12.5px;color:#e8e8e8;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pm-cat-man-btn{all:unset;box-sizing:border-box;flex:0 0 auto;width:26px;height:26px;display:flex;
    align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#b6b6b6;
    transition:background .15s ease,color .15s ease;}
.pm-cat-man-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
.pm-cat-man-btn svg{width:14px;height:14px;}
.pm-cat-man-btn-off{opacity:.3;cursor:default;}
.pm-cat-man-btn-off:hover{background:transparent;color:#b6b6b6;}
.pm-choice-btns{display:flex;flex-direction:column;gap:6px;}
.pm-choice-btn{width:100%;}
.pm-btn-danger{background:#b33;border-color:#b33;color:#fff;}
.pm-btn-danger:hover{background:#c44;}
.pm-save-cats{padding:0;flex:1;min-width:0;margin-left:-8px;display:flex;flex-wrap:wrap;
    row-gap:2px;max-height:96px;overflow-y:auto;}
.pm-save-cats::-webkit-scrollbar{width:6px;}
.pm-save-cats::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:3px;}
.pm-save-cats .pm-tab{padding:5px 10px;font-size:12px;}
.pm-cat-group{padding:8px 10px 4px;font-size:11.5px;color:#9fd0ff;letter-spacing:.3px;}
.pm-save-row{display:flex;align-items:center;gap:8px;}
.pm-save-label{flex:0 0 36px;font-size:12.5px;color:#bbb;}
.pm-save-row input{flex:1;min-width:0;}
/* ===== 工具条设置面板 ===== */
.pm-set-row{display:flex;align-items:center;gap:10px;font-size:13px;color:#ddd;}
.pm-set-label{flex:0 0 auto;width:56px;color:#bbb;white-space:nowrap;}
.pm-set-row input[type="range"]{flex:1;accent-color:#2f6fdd;cursor:pointer;}
.pm-set-val{flex:0 0 42px;text-align:right;color:#9fd0ff;font-size:12.5px;font-variant-numeric:tabular-nums;}
.pm-positions{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1;min-width:0;}
.pm-pos-opt{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;
    gap:8px;font-size:12.5px;color:#ccc;cursor:pointer;white-space:nowrap;
    padding:6px 10px;border:1px solid #3d3d3d;border-radius:7px;
    transition:border-color .15s ease,background .15s ease;}
.pm-pos-opt input{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:#2f6fdd;}
.pm-pos-opt:hover{border-color:#5a5a5a;}
.pm-pos-opt:has(input:checked){border-color:#2f6fdd;background:rgba(47,111,221,.18);color:#fff;}
.pm-pos-opt input{accent-color:#2f6fdd;margin:0;}
`;
    document.head.appendChild(style);
}
