// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 comfyui-prompt-manager contributors
// 跨模块共享的可变状态
//
// 为什么是对象属性而不是各模块自己 let: ES module 的 import 绑定是只读的,
// A 模块没法给 B 模块的 let 重新赋值; 放在一个共享对象上, 读写都走属性就没这问题。
// 另外 ComfyUI 把 web 目录下每个 js 都单独 import 一次, 状态集中在一处也更好追踪。

export const S = {
    // 局域网访问时只读 (后端 /prompt_manager/access 返回 local:false 时置 true)
    readOnly: false,
    // 正在显示确认框时不重复弹 (dialogs 写, 列表等读)
    confirmOpen: false,
    // 当前打开的列表弹窗 / 保存弹窗 (list 写, 顶栏与节点工具条读)
    dialog: null,
    saveDialog: null,
    // 顶栏 ⚙ 提示词库菜单 (topbar 创建, dialogs 负责关闭)
    settingsMenu: null,
    // 顶栏 ✏ 按钮与其快捷浮层 (topbar 内部用, 测试也要读)
    topbarBtn: null,
    topbarMenu: null,
};
