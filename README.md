# 中国色 · 传统色推荐与调色工具

单页 Web 应用：661 种中国传统色的色卡墙浏览、搜索取值、ΔE 最近传统色匹配调色、收藏并导出 CSS 变量。无后端依赖，全部计算在浏览器本地完成。

设计说明见：`F:\AIData\docs\ui\中国色工具.md`（五层描述 / 任务流 / 五态 / 验收标准）。

## 运行

方式一（直接双击）：

```
打开 index.html（file:// 协议可用，色库经 data/colors.js 脚本加载）
```

方式二（本地服务，推荐）：

```
python -m http.server 8734
# 访问 http://localhost:8734
```

## 走查辅助参数

- `index.html?slow=1`：色库延迟 2 秒加载，用于观察加载骨架态。

## 目录结构

```
index.html          单页入口
css/style.css       样式（≥1024 双栏 / <1024 抽屉调色台 / <768 移动端）
js/app.js           全部交互逻辑（搜索、ΔE 匹配、收藏、导出、背景联动）
data/colors.json    色库（人读版，661 色：名称/拼音/HEX/色系/出处）
data/colors.js      色库（脚本注入版，供 file:// 加载，构建产物）
build_colors.py     色库构建脚本：合并数据源 → 分组 → 排序 → 输出
data-src/           原始数据源（colors526.json / colors161.json）
.e2e/               验收走查脚本与截图（playwright-core）
```

## 色库构建

```
pip install pypinyin
python build_colors.py
```

色系分组按 HSL 色相推导（赤/橙/褐/黄/绿/青/蓝/紫/黑白），褐 = 低饱和暗橙；排序按色系光谱序 + 色相，保证色卡墙有渐进感。

## 数据来源

- 526 色（名称/拼音/HEX）：开源数据集 ChineseTraditionalColors
- 161 色（名称/HEX/注释）：开源数据集 chinese-colors
- 名色补充（天水碧/朱砂/竹青/黛蓝等）与出处注释：公开传统色表整理

## 功能要点

- **找色取值**：搜索（防抖 200ms，支持色名/拼音）→ 点色卡 → 复制 HEX，2 次点击
- **调色匹配**：HEX 输入 / HSL 滑杆 / 从色卡墙发送 → CIE76 ΔE 最近 5 个传统色，1 次点击采纳；采纳后微调标记来源
- **收藏导出**：星标收藏（上限 50，localStorage）→ 导出 CSS 变量（拼音变量名，重名自动加序号）
- **背景联动**：切换当前色 / 鼠标悬浮色卡时，页面大背景跟随为该色调（与宣纸底 12% 混色，移出回落）
- **动效**：色卡墙瀑布式入场、弹层弹性浮现与关闭退场、移动端抽屉弹性滑动、颜色切换 0.25~0.6s 平滑过渡（`prefers-reduced-motion` 时全部退化为直切）
- **古风排版**：色名/标题/按钮用衬线，出处注释用楷体 +「」引文装饰 + 赭墨色；HEX/RGB/HSL 等数值保持无衬线工具感

## 走查

`​.e2e/walkthrough.cjs` 为验收走查脚本（Playwright 驱动本机 Chrome）：

```
cd .e2e && npm install playwright-core && node walkthrough.cjs
# 61 项断言：3 条任务流点击步数、五态、1440px/375px 双端、背景联动、动效
# 截图输出于 .e2e/shots/
```
