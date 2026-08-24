/* 中国色单页应用 · 浏览器走查（对应设计说明第 6 节验收标准）
 * 覆盖：任务流1 找色取值 / 任务流2 调色匹配 / 任务流3 收藏导出
 *       五态（正常/加载/空/错误/边界）+ 1440px 桌面与 375px 移动双端
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:8734/";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "shots");
const results = [];
let pageErrors = [];

function record(task, item, pass, detail) {
  results.push({ task, item, pass, detail: detail == null ? "" : String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"} [${task}] ${item}${detail ? " | " + detail : ""}`);
}

async function readToast(page, expected) {
  await page.waitForFunction(() => {
    const t = document.querySelector("#toast");
    return t && !t.hidden && t.textContent.trim().length > 0;
  }, null, { timeout: 3000 });
  if (expected) {
    await page.waitForFunction(e => {
      const t = document.querySelector("#toast");
      return t && !t.hidden && t.textContent.includes(e);
    }, expected, { timeout: 3000 });
  }
  return page.textContent("#toast");
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  /* ============ 桌面 1440px 主流程 ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("desktop: " + e.message));
    page.on("console", m => { if (m.type() === "error") pageErrors.push("desktop-console: " + m.text()); });

    await page.goto(BASE);
    await page.waitForSelector(".card[data-i]", { timeout: 5000 });

    // 首屏与密度
    const cardCount = await page.locator(".card[data-i]").count();
    record("首屏", "色卡墙渲染 661 张", cardCount === 661, cardCount);
    const cols = (await page.evaluate(() => getComputedStyle(document.querySelector("#wall")).gridTemplateColumns)).split(" ").length;
    record("首屏", "桌面色卡墙列数 6~9（24~30 张/屏）", cols >= 6 && cols <= 9, cols + " 列");
    const heroH = await page.evaluate(() => document.querySelector("#hero").offsetHeight);
    record("首屏", "今日一色高度 ≤ 1 屏(400px)", heroH <= 400, heroH + "px");
    const heroName = await page.textContent("#heroName");
    const heroHex = await page.textContent("#heroHex");
    const heroNote = await page.textContent("#heroNote");
    record("首屏", "今日一色含名/HEX/出处", !!heroName && /^#[0-9A-F]{6}$/i.test(heroHex) && heroNote.length > 0, `${heroName} ${heroHex}`);
    const mixerSticky = await page.evaluate(() => getComputedStyle(document.querySelector("#mixer")).position);
    record("首屏", "调色台 sticky 常驻", mixerSticky === "sticky", mixerSticky);
    const enterCount = await page.locator(".card.enter").count();
    record("动效", "色卡墙瀑布式入场(带错峰延迟)", enterCount === 661, enterCount);

    // 圆润字体：霞鹜文楷 webfont 加载（失败则回退本机楷体，不阻断）
    const fontOk = await page.evaluate(async () => {
      try { await document.fonts.load('20px "LXGW WenKai Screen"', "胭脂月白天水碧竹青黛"); } catch (e) {}
      return document.fonts.check('20px "LXGW WenKai Screen"');
    });
    record("字体", "霞鹜文楷圆润字体加载", fontOk, fontOk ? "LXGW WenKai Screen" : "回退本机楷体");

    // 背景联动：悬浮色卡 → 背景=该色调；移出 → 回落调色台当前色(初始=今日一色)
    const mixTint = hex => {
      const paper = [250, 247, 242], a = 0.12;
      const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      return "rgb(" + rgb.map((v, i) => Math.round(v * a + paper[i] * (1 - a))).join(", ") + ")";
    };
    const firstCard = page.locator("#wall .card[data-i]").first();
    const firstLabel = await firstCard.getAttribute("aria-label");
    const firstHex = firstLabel.match(/#[0-9A-F]{6}/i)[0];
    await firstCard.hover();
    await page.waitForFunction(v => document.body.style.backgroundColor === v, mixTint(firstHex));
    record("背景联动", "悬浮色卡页面背景跟随", true, `${firstLabel} → ${mixTint(firstHex)}`);
    await page.mouse.move(2, 2);
    await page.waitForFunction(v => document.body.style.backgroundColor === v, mixTint(heroHex));
    record("背景联动", "移出色卡背景回落调色台色", true, await page.evaluate(() => document.body.style.backgroundColor));
    await shot(page, "desktop-home");

    // 今日一色点击进详情（同时校验弹窗打开页面宽度不变，无滚动条跳动）
    const widthBefore = await page.evaluate(() => document.documentElement.clientWidth);
    await page.click("#hero");
    await page.waitForSelector("#detailModal:not([hidden])");
    await page.playwright.waitForTimeout(800); // 等弹窗动画完成、滚动锁生效
    const widthAfter = await page.evaluate(() => document.documentElement.clientWidth);
    record("弹窗", "弹窗打开页面宽度不变(滚动条槽位常驻)", widthBefore === widthAfter, `前${widthBefore} 后${widthAfter}`);
    const dName = await page.textContent("#dName");
    record("任务1", "今日一色点击进详情且名称一致", dName.trim() === heroName.trim(), dName);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#detailModal").hidden);

    // 任务1：搜索 胭脂 → 点色卡 → 复制 HEX（2 次点击）
    await page.fill("#search", "胭脂");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 2);
    await page.click('#wall .card[aria-label^="胭脂 #"]'); // 点击 1（精确命中「胭脂」，排除「胭脂红」）
    await page.waitForSelector("#detailModal:not([hidden])");
    const hexVal = (await page.textContent("#dHexVal")).trim();
    const rgbVal = (await page.textContent("#dRgbVal")).trim();
    const hslVal = (await page.textContent("#dHslVal")).trim();
    record("任务1", "详情弹层 HEX/RGB/HSL 三行齐备", /^#[0-9A-F]{6}$/i.test(hexVal) && rgbVal.startsWith("rgb(") && hslVal.startsWith("hsl("), `${hexVal} / ${rgbVal} / ${hslVal}`);
    const simCount = await page.locator("#dSimilar .sim-item").count();
    record("任务1", "相近色横滑条 5 项", simCount === 5, simCount);
    const noteVis = await page.isVisible("#dNote");
    record("任务1", "出处注释显示", noteVis && (await page.textContent("#dNote")).length > 0, await page.textContent("#dNote"));
    await page.click('[data-copy="hex"]'); // 点击 2
    const t1 = await readToast(page);
    record("任务1", "复制 HEX toast 文案", t1 === `已复制 ${hexVal} 胭脂`, t1);
    // RGB 行复制
    await page.click('[data-copy="rgb"]');
    const t1b = await readToast(page, `已复制 ${rgbVal}`);
    record("任务1", "RGB 行复制 toast", t1b === `已复制 ${rgbVal}`, t1b);
    await shot(page, "desktop-detail");
    await page.keyboard.press("Escape");

    // 拼音匹配 + 清空恢复
    await page.fill("#search", "yanzhi");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 2);
    record("操作1", "拼音搜索命中", true, "yanzhi → 2 卡");
    await page.fill("#search", "");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 661);

    // 色系筛选：单选
    await page.click('.chip[data-g="青"]');
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length > 0);
    const qingCount = await page.locator("#wall .card[data-i]").count();
    record("操作1", "色系筛选 青=58", qingCount === 58, qingCount);
    await page.click('.chip[data-g="全部"]');

    // 空态：未找到 + 建议 + 清除筛选
    await page.fill("#search", "不存在的颜色xyz");
    await page.waitForSelector("#wallMsg:not([hidden])");
    const emptyMsg = await page.textContent("#wallMsg");
    record("操作1", "空态文案含建议词", /未找到/.test(emptyMsg) && ["胭脂", "月白", "黛蓝", "竹青"].every(w => emptyMsg.includes(w)), emptyMsg.trim().replace(/\s+/g, " "));
    const kept = await page.inputValue("#search");
    record("操作1", "无结果保留用户输入", kept === "不存在的颜色xyz", kept);
    await shot(page, "desktop-empty-search");
    await page.click("text=清除筛选");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 661);
    record("操作1", "清除筛选恢复全量", true);

    // 边界：超长输入取前 20 字
    await page.fill("#search", "胭脂" + "啊".repeat(30));
    await page.waitForSelector("#wallMsg:not([hidden])");
    const truncMsg = await page.textContent("#wallMsg");
    record("操作1", "超长输入按前 20 字过滤", truncMsg.includes("胭脂啊啊啊啊啊啊啊啊啊啊啊"), truncMsg.trim().slice(0, 40));
    await page.fill("#search", "");

    // 任务2：调色匹配。输入 HEX → 自动出最近 5 色；采纳 1 次点击
    await page.fill("#hexInput", "D7213E"); // 无 # 前缀也应合法
    await page.waitForFunction(() => document.querySelector("#mpHex").textContent.trim() === "#D7213E");
    record("任务2", "HEX 输入(无#)应用成功", true, "#D7213E");
    // 背景联动：body 背景 = 当前色与宣纸底 12% 混色
    await page.waitForFunction(() => document.body.style.backgroundColor === "rgb(246, 221, 220)");
    record("背景联动", "切色后页面大背景跟随变化", true, await page.evaluate(() => document.body.style.backgroundColor));
    const nearItems = await page.locator("#nearestList .near-item").count();
    record("任务2", "最接近 5 色自动刷新", nearItems === 5, nearItems);
    const bestTag = await page.locator("#nearestList .near-item").first().textContent();
    record("任务2", "第一项标注「最接近」", bestTag.includes("最接近"), bestTag.trim().replace(/\s+/g, " "));
    const deText = await page.locator("#nearestList .near-item .near-de").first().textContent();
    record("任务2", "ΔE 保留 1 位小数", /ΔE \d+\.\d/.test(deText.trim()), deText.trim());
    const near0name = await page.locator("#nearestList .near-item .near-name").first().innerText();
    await page.locator("#nearestList .near-item").first().locator(".near-adopt").click(); // 采纳 1 次点击
    await page.waitForFunction(() => {
      const n = document.querySelector("#mpName").textContent;
      return n && !n.includes("自定义") && !n.includes("微调");
    });
    const adoptedName = (await page.textContent("#mpName")).trim();
    record("任务2", "采纳锁定色名", adoptedName === near0name.replace("最接近", "").trim(), adoptedName);
    await shot(page, "desktop-mixer-after-adopt");
    // 采纳后微调 → 标记来源
    await page.evaluate(() => {
      const s = document.querySelector("#sSlider");
      s.value = 40;
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#mpName").textContent.includes("已微调（基于"));
    record("任务2", "微调后显示 已微调（基于 X）", true, await page.textContent("#mpName"));
    // 复制当前色
    await page.click("#copyCurrent");
    const t2 = await readToast(page, "已复制 #");
    record("任务2", "复制当前色 toast", /^已复制 #[0-9A-F]{6}/.test(t2), t2);

    // 非法 HEX：红框 + 行内提示，不改当前色
    const beforeHex = await page.textContent("#mpHex");
    await page.fill("#hexInput", "#GGGGGG");
    await page.locator("#hexInput").blur();
    await page.waitForSelector("#hexError:not([hidden])");
    const hexErr = (await page.textContent("#hexError")).trim();
    const stillHex = await page.textContent("#mpHex");
    record("操作3", "非法 HEX 行内提示", hexErr === "请输入 6 位 HEX，如 #D7213E", hexErr);
    record("操作3", "非法输入不改变当前色", stillHex === beforeHex, stillHex);
    const invalidCls = await page.locator("#hexInput").getAttribute("class");
    record("操作3", "非法 HEX 红框", invalidCls.includes("invalid"), invalidCls);
    await page.fill("#hexInput", "#D7213E"); // 恢复

    // 滑杆：纯黑也能匹配（黑→玄/乌/墨系）
    await page.evaluate(() => {
      const h = document.querySelector("#hSlider"), s = document.querySelector("#sSlider"), l = document.querySelector("#lSlider");
      h.value = 0; s.value = 0; l.value = 0;
      [h, s, l].forEach(el => el.dispatchEvent(new Event("input", { bubbles: true })));
    });
    await page.waitForFunction(() => document.querySelector("#mpHex").textContent.trim() === "#000000");
    const blackBest = await page.locator("#nearestList .near-item .near-name").first().innerText();
    record("操作3", "纯黑可匹配传统色", blackBest.trim().length > 0, "黑 → " + blackBest.trim().replace(/\s+/g, " "));

    // 任务3：收藏导出。星标(1) → 收藏夹(2) → 导出 CSS(3)
    await page.fill("#search", "胭脂");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 2);
    await page.click('#wall .card[aria-label^="胭脂 #"] [data-star]', { force: true }); // 收藏 1 点击
    await page.waitForFunction(() => {
      const b = document.querySelector("#favBadge");
      return b && !b.hidden && b.textContent === "1";
    });
    record("任务3", "星标收藏徽标+1", true, "badge=1");

    // 重复收藏：toast 已在收藏夹
    await page.click('#wall .card[aria-label^="胭脂 #"] [data-star]', { force: true });
    const dupToast = await readToast(page);
    record("操作4", "重复收藏提示不重复添加", dupToast === "已在收藏夹", dupToast);

    // 拼音重名对（导出 -2 序号验证）
    const colors = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "colors.json"), "utf8"));
    const byPy = {};
    colors.forEach(c => { (byPy[c.pinyin] = byPy[c.pinyin] || []).push(c.name); });
    const dupPair = Object.entries(byPy).find(([, ns]) => ns.length >= 2);
    for (const n of dupPair[1].slice(0, 2)) {
      await page.fill("#search", n);
      // 等待"新名字"的卡片真实渲染完成，避免防抖窗口内点到上一轮的旧卡
      await page.waitForSelector(`#wall .card[aria-label^="${n} #"]`);
      await page.click(`#wall .card[aria-label^="${n} #"] [data-star]`, { force: true });
    }
    await page.waitForFunction(() => {
      const b = document.querySelector("#favBadge");
      return b && !b.hidden && b.textContent === "3";
    });
    const badge2 = await page.textContent("#favBadge");
    record("任务3", `重名拼音对收藏 ${dupPair[1][0]}/${dupPair[1][1]}`, badge2 === "3", "badge=" + badge2);

    await page.fill("#search", "");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 661);

    await page.click("#favBtn"); // 点击 2
    await page.waitForSelector("#favModal:not([hidden])");
    const favRows = await page.locator("#favList .fav-item").count();
    record("任务3", "收藏夹列表 3 条", favRows === 3, favRows);
    await page.click("#exportCss"); // 点击 3
    await page.waitForSelector("#favExportWrap:not([hidden])");
    const css = await page.textContent("#cssCode");
    const py = dupPair[0];
    const hasBase = css.includes(`--${py}:`);
    const hasSeq = css.includes(`--${py}-2:`);
    record("操作5", "导出 CSS 拼音重名加序号", hasBase && hasSeq, `--${py} / --${py}-2`);
    record("操作5", "导出 CSS 变量值正确", css.includes(`: ${hexVal.toLowerCase()}`) || css.includes(hexVal.toLowerCase()), css.split("\n")[1] ? css.split("\n")[1].trim() : "");
    await page.click("#copyCss");
    const t3 = await readToast(page);
    record("任务3", "复制全部 CSS toast", t3 === "已复制 CSS 代码", t3);
    await shot(page, "desktop-favs-export");
    // 从收藏夹移除一条
    await page.click("#favList .fav-item [data-remove]");
    await page.waitForFunction(() => document.querySelectorAll("#favList .fav-item").length === 2);
    record("操作4", "收藏夹移除生效", true, "剩 2 条");

    // 收藏夹空态（先清空）
    await page.click("#favList .fav-item [data-remove]");
    await page.click("#favList .fav-item [data-remove]");
    await page.waitForSelector("#favEmpty:not([hidden])");
    const emptyFav = (await page.textContent("#favEmpty")).trim();
    record("操作4", "收藏夹空态文案", emptyFav.includes("还没有收藏，去色卡墙挑几个吧") && await page.isVisible("#goWall"), emptyFav.replace(/\s+/g, " "));
    await page.keyboard.press("Escape");

    // 从色卡墙发送到调色台（0 额外点击入口）
    await page.fill("#search", "天水碧");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 1);
    await page.locator("#wall .card[data-i] [data-send]").click({ force: true });
    await page.waitForFunction(() => document.querySelector("#mpName").textContent.trim() === "天水碧");
    record("任务2", "色卡墙「发送到调色台」", true, "当前色=天水碧");

    await ctx.close();
  }

  /* ============ 加载态 ?slow=1 ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("slow: " + e.message));
    await page.goto(BASE + "?slow=1");
    await page.waitForSelector("#wall .card.skel", { timeout: 3000 });
    const skelCount = await page.locator("#wall .card.skel").count();
    record("操作1", "加载中骨架块(灰块同网格)", skelCount >= 20, skelCount + " 块");
    const slidersDisabled = await page.locator("#hSlider").isDisabled();
    const nearSkel = await page.locator("#nearestList .near-skel").count();
    record("操作3", "色库未就绪滑杆禁用+结果区骨架条", slidersDisabled && nearSkel === 5, `disabled=${slidersDisabled} 骨架条=${nearSkel}`);
    await shot(page, "loading-skeleton");
    await page.waitForSelector(".card[data-i]", { timeout: 6000 });
    record("加载态", "延迟后正常渲染", true);
    await ctx.close();
  }

  /* ============ 错误态：色库加载失败 + 重试 ============ */
  {
    const bak = path.join(ROOT, "data", "colors.js.bak");
    const orig = path.join(ROOT, "data", "colors.js");
    fs.renameSync(orig, bak);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("error-state: " + e.message));
    try {
      await page.goto(BASE);
      await page.waitForSelector("#wallMsg:not([hidden])", { timeout: 5000 });
      const errMsg = (await page.textContent("#wallMsg")).trim();
      record("操作1", "错误态文案 色库加载失败", errMsg.includes("色库加载失败"), errMsg);
      const retryVis = await page.isVisible("text=点击重试");
      record("操作1", "点击重试按钮存在", retryVis);
      await shot(page, "error-state");
      fs.renameSync(bak, orig); // 恢复数据文件
      await page.click("text=点击重试");
      await page.waitForSelector(".card[data-i]", { timeout: 6000 });
      record("操作1", "重试后恢复渲染", true);
    } finally {
      if (fs.existsSync(bak)) fs.renameSync(bak, orig);
    }
    await ctx.close();
  }

  /* ============ 边界：收藏上限 50 ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      const arr = Array.from({ length: 50 }, (_, i) => ({ name: "占位" + i, hex: "#000000" }));
      localStorage.setItem("zhongguose.favs", JSON.stringify(arr));
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("fav-limit: " + e.message));
    await page.goto(BASE);
    await page.waitForSelector(".card[data-i]");
    await page.waitForFunction(() => {
      const b = document.querySelector("#favBadge");
      return b && !b.hidden && b.textContent === "50";
    });
    record("操作4", "预置 50 条徽标=50", true);
    await page.locator("#wall .card[data-i] [data-star]").first().click({ force: true });
    const limitToast = await readToast(page);
    record("操作4", "上限 50 toast", limitToast === "收藏已满（50），先清理一下", limitToast);
    await ctx.close();
  }

  /* ============ 错误：隐私模式存储失败 ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException("denied", "SecurityError"); };
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("storage-fail: " + e.message));
    await page.goto(BASE);
    await page.waitForSelector(".card[data-i]");
    await page.locator("#wall .card[data-i] [data-star]").first().click({ force: true });
    const stoToast = await readToast(page);
    record("操作4", "存储失败 toast", stoToast === "收藏暂不可用（浏览器存储被禁用）", stoToast);
    const badgeHidden = await page.locator("#favBadge").isHidden();
    record("操作4", "存储失败不计数(回滚)", badgeHidden, "badge hidden=" + badgeHidden);
    await ctx.close();
  }

  /* ============ 错误：剪贴板被拒 → 手动复制降级 ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { get: () => undefined });
      document.execCommand = () => false;
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("clipboard-fail: " + e.message));
    await page.goto(BASE);
    await page.waitForSelector(".card[data-i]");
    await page.locator("#wall .card[data-i]").first().click();
    await page.waitForSelector("#detailModal:not([hidden])");
    await page.click('[data-copy="hex"]');
    await page.waitForSelector("#manualCopy:not([hidden])");
    const mcVal = await page.inputValue("#manualCopyInput");
    const mcHint = (await page.textContent("#manualCopy")).includes("请手动复制");
    record("操作2", "剪贴板被拒降级只读输入框", /^#[0-9A-F]{6}$/i.test(mcVal) && mcHint, mcVal);
    await shot(page, "clipboard-manual-fallback");
    await ctx.close();
  }

  /* ============ 移动端 375px ============ */
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", e => pageErrors.push("mobile: " + e.message));
    page.on("console", m => { if (m.type() === "error") pageErrors.push("mobile-console: " + m.text()); });
    await page.goto(BASE);
    await page.waitForSelector(".card[data-i]");

    const fabVis = await page.isVisible("#fab");
    record("移动端", "悬浮调色按钮显示", fabVis);
    const searchIconVis = await page.isVisible("#searchIcon");
    const searchHidden = await page.locator("#searchWrap").isHidden();
    record("移动端", "搜索框收起为图标", searchIconVis && searchHidden);
    await shot(page, "mobile-home");

    // 展开搜索 → 任务1
    await page.click("#searchIcon");
    await page.waitForFunction(() => document.body.classList.contains("search-open"));
    await page.fill("#search", "月白");
    await page.waitForFunction(() => document.querySelectorAll("#wall .card[data-i]").length === 1);
    const mCols = (await page.evaluate(() => getComputedStyle(document.querySelector("#wall")).gridTemplateColumns)).split(" ").length;
    record("移动端", "双列瀑布流", mCols === 2, mCols + " 列");
    await page.click("#wall .card[data-i]");
    await page.waitForSelector("#detailModal:not([hidden])");
    // 移动端弹层为底部抽屉：面板底边贴住视口底部
    const panelBox = await page.locator("#detailModal .modal-panel").boundingBox();
    const bottomGap = panelBox ? Math.abs(panelBox.y + panelBox.height - 667) : 999;
    record("移动端", "详情弹层底部抽屉样式", bottomGap < 8, panelBox ? `y=${Math.round(panelBox.y)} 底边间隙=${Math.round(bottomGap)}px` : "none");
    await page.click('[data-copy="hex"]');
    const mToast = await readToast(page);
    record("移动端", "任务1 复制 HEX toast", /^已复制 #[0-9A-F]{6} 月白$/.test(mToast), mToast);
    await shot(page, "mobile-modal");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#detailModal").hidden);

    // 调色抽屉：FAB 打开 → 输入 → 采纳 → 收起
    await page.click("#fab");
    await page.waitForFunction(() => document.querySelector("#mixer").classList.contains("open"));
    record("移动端", "FAB 展开调色抽屉", true);
    await page.fill("#hexInput", "#4A4266");
    await page.waitForFunction(() => document.querySelector("#mpHex").textContent.trim() === "#4A4266");
    await page.locator("#nearestList .near-item").first().locator(".near-adopt").click();
    await page.waitForFunction(() => {
      const n = document.querySelector("#mpName").textContent;
      return n && !n.includes("自定义") && !n.includes("微调");
    });
    record("移动端", "抽屉内调色+采纳", true, await page.textContent("#mpName"));
    await shot(page, "mobile-drawer");
    await page.click("#mixerHandle");
    await page.waitForFunction(() => !document.querySelector("#mixer").classList.contains("open"));
    record("移动端", "抽屉可收起", true);

    await ctx.close();
  }

  await browser.close();

  const fails = results.filter(r => !r.pass);
  console.log("\n==== 汇总 ====");
  console.log(`总计 ${results.length} 项，通过 ${results.length - fails.length}，失败 ${fails.length}`);
  if (pageErrors.length) {
    console.log("页面错误:");
    pageErrors.forEach(e => console.log("  " + e));
  } else {
    console.log("页面错误: 0");
  }
  if (fails.length) {
    console.log("失败项:");
    fails.forEach(f => console.log(`  [${f.task}] ${f.item} | ${f.detail}`));
    process.exitCode = 1;
  }
})().catch(e => { console.error("WALKTHROUGH CRASH:", e); process.exitCode = 2; });
