/* ============================================================
   中国色 · 传统色推荐与调色工具
   单页应用：色卡墙 / 搜索筛选 / 详情弹层 / 调色台(ΔE) / 收藏导出
   无后端：色库 data/colors.js 脚本注入加载，全部计算在前端完成
   ============================================================ */
"use strict";

/* ---------- DOM 快捷 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- 色彩空间 ---------- */

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

function rgbToLab(r, g, b) {
  const f = c => {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g2 = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g2(x); y = g2(y); z = g2(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE76(lab1, lab2) {
  const dL = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** 按背景明度自动返回黑/白文字色（YIQ） */
function textColorFor(r, g, b) {
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#3b3a36" : "#ffffff";
}

const hexUpper = hex => hex.toUpperCase();

/* ---------- 全局状态 ---------- */

const state = {
  colors: [],          // {name,pinyin,hex,group,note,rgb,lab}
  byName: new Map(),
  ready: false,
  query: "",
  group: "全部",
  favs: [],            // [{name,hex}]
  mixer: { hex: "#d5f0e6", adoptedName: null, baseName: null },
};

const FAV_KEY = "zhongguose.favs";
const FAV_MAX = 50;
const GROUPS = ["全部", "赤", "橙", "褐", "黄", "绿", "青", "蓝", "紫", "黑白"];

/* ---------- toast（去重：同文案只弹一个，连点重置计时） ---------- */

let toastTimer = null, toastMsg = "";

function showToast(msg) {
  const el = $("#toast");
  if (el.hidden || toastMsg !== msg) {
    el.textContent = msg;
    toastMsg = msg;
    el.hidden = false;
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toastMsg = ""; }, 1500);
}

/* ---------- 复制：clipboard API → execCommand → 手动降级 ---------- */

let lastCopyAt = 0;

async function copyText(text, toastLabel) {
  const now = Date.now();
  if (now - lastCopyAt < 200 && toastMsg === toastLabel) return; // 快速连点节流
  lastCopyAt = now;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) { ok = false; }
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch (e) { ok = false; }
  }
  if (ok) showToast(toastLabel);
  else showManualCopy(text);
}

function showManualCopy(text) {
  const panel = $("#manualCopy"), input = $("#manualCopyInput");
  input.value = text;
  panel.hidden = false;
  input.focus();
  input.select();
}

/* ---------- 数据加载（脚本注入，支持 file://；失败可重试） ---------- */

function loadColors() {
  showWallSkeleton();
  const start = () => {
    const s = document.createElement("script");
    s.src = "data/colors.js?bust=" + Date.now();
    s.onload = () => {
      if (Array.isArray(window.COLORS_DATA) && window.COLORS_DATA.length) onDataReady(window.COLORS_DATA);
      else onLoadError();
    };
    s.onerror = onLoadError;
    document.head.appendChild(s);
  };
  // ?slow=1：人为延迟 2 秒，用于走查"加载中"骨架态
  if (new URLSearchParams(location.search).has("slow")) setTimeout(start, 2000);
  else start();
}

function onLoadError() {
  const wall = $("#wall"), msg = $("#wallMsg");
  wall.style.display = "none";
  msg.hidden = false;
  msg.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = "色库加载失败";
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "点击重试";
  btn.addEventListener("click", () => {
    msg.hidden = true;
    wall.style.display = "";
    loadColors();
  });
  msg.append(p, btn);
}

function onDataReady(data) {
  state.colors = data.map(c => {
    const rgb = hexToRgb(c.hex);
    return { ...c, rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) };
  });
  state.byName = new Map(state.colors.map(c => [c.name, c]));
  state.ready = true;
  $("#wallMsg").hidden = true;
  $("#mixer").classList.remove("not-ready");
  ["#hSlider", "#sSlider", "#lSlider", "#hexInput"].forEach(s => $(s).disabled = false);
  restoreFavs();
  renderChips();
  renderHero();
  renderWall();
  // 调色台初始 = 今日一色（与设计稿一致：#D5F0E6 天水碧）
  const hero = heroColor();
  setMixerColor(hero.hex, { adoptedName: hero.name });
}

/* ---------- 色卡墙 ---------- */

function showWallSkeleton() {
  const wall = $("#wall");
  wall.style.display = "";
  wall.innerHTML = Array.from({ length: 24 }, () => '<div class="card skel"></div>').join("");
}

function filteredColors() {
  const q = state.query.trim().slice(0, 20).toLowerCase();
  return state.colors
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => {
      if (state.group !== "全部" && c.group !== state.group) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.pinyin.includes(q);
    });
}

function renderWall() {
  const wall = $("#wall"), msg = $("#wallMsg");
  const list = filteredColors();

  if (!list.length) {
    wall.style.display = "none";
    msg.hidden = false;
    msg.innerHTML = "";
    const p = document.createElement("p");
    const q = state.query.trim().slice(0, 20);
    const nameSpan = document.createElement("strong");
    nameSpan.textContent = `未找到「${q}」。`;
    p.append(nameSpan, " 试试：");
    ["胭脂", "月白", "黛蓝", "竹青"].forEach(n => {
      const s = document.createElement("span");
      s.className = "sug";
      s.textContent = n;
      s.tabIndex = 0;
      s.addEventListener("click", () => { $("#search").value = n; state.query = n; renderWall(); });
      p.append(s, " ");
    });
    const clear = document.createElement("button");
    clear.className = "btn";
    clear.textContent = "清除筛选";
    clear.addEventListener("click", clearFilters);
    msg.append(p, clear);
    return;
  }

  msg.hidden = true;
  wall.style.display = "";
  const favNames = new Set(state.favs.map(f => f.name));
  wall.innerHTML = list.map(({ c, i }, pos) => {
    const [r, g, b] = c.rgb;
    const starred = favNames.has(c.name);
    // 瀑布式入场：前 26 张依次错峰（30ms 步进，约 0.78s 铺开），其余同时浮现
    const delay = Math.min(pos, 26) * 30;
    return `<div class="card enter" data-i="${i}" tabindex="0" role="button"
         aria-label="${c.name} ${hexUpper(c.hex)}"
         style="--d:${delay}ms;background:${c.hex};color:${textColorFor(r, g, b)}">
      <span class="card-name">${c.name}</span>
      <span class="card-hex">${hexUpper(c.hex)}</span>
      <span class="card-act">
        <button data-star aria-label="收藏 ${c.name}" class="${starred ? "on" : ""}">${starred ? "★" : "☆"}</button>
        <button data-send aria-label="发送 ${c.name} 到调色台">⇗</button>
      </span>
    </div>`;
  }).join("");
}

function clearFilters() {
  state.query = "";
  state.group = "全部";
  $("#search").value = "";
  renderChips();
  renderWall();
}

/* ---------- 今日一色 ---------- */

function heroColor() {
  const notables = state.colors.filter(c => c.note);
  const pool = notables.length ? notables : state.colors;
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 864e5);
  return pool[doy % pool.length];
}

function renderHero() {
  const c = heroColor();
  const [r, g, b] = c.rgb;
  const hero = $("#hero");
  hero.style.background = c.hex;
  hero.style.color = textColorFor(r, g, b);
  $("#heroName").textContent = c.name;
  $("#heroHex").textContent = hexUpper(c.hex);
  $("#heroNote").textContent = c.note || "";
}

/* ---------- 色系 chips ---------- */

function renderChips() {
  $("#chips").innerHTML = GROUPS.map(g =>
    `<button class="chip ${g === state.group ? "active" : ""}" data-g="${g}">${g}</button>`
  ).join("");
}

/* ---------- 详情弹层 ---------- */

let detailName = null;
let lastFocused = null;

function openModal(m) {
  lastFocused = document.activeElement;
  m.classList.remove("closing");
  delete m.dataset.closing;
  m.hidden = false;
  document.body.style.overflow = "hidden";
  const close = m.querySelector(".modal-close");
  if (close) close.focus();
}

function closeModal(m) {
  if (m.hidden || m.dataset.closing) return;
  m.dataset.closing = "1";
  m.classList.add("closing");
  setTimeout(() => {
    m.hidden = true;
    m.classList.remove("closing");
    delete m.dataset.closing;
    document.body.style.overflow = "";
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }, 460);
}

function fmtHsl(rgb) {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function openDetail(c) {
  if (!c) return;
  detailName = c.name;
  const [r, g, b] = c.rgb;
  const block = $("#detailBlock");
  block.style.background = c.hex;
  block.style.color = textColorFor(r, g, b);
  $("#dName").textContent = c.name;
  $("#dPinyin").textContent = c.pinyin;
  $("#dHex").textContent = hexUpper(c.hex);
  $("#dHexVal").textContent = hexUpper(c.hex);
  $("#dRgbVal").textContent = `rgb(${r}, ${g}, ${b})`;
  $("#dHslVal").textContent = fmtHsl(c.rgb);
  const note = $("#dNote");
  if (c.note) { note.textContent = c.note; note.hidden = false; }
  else note.hidden = true;
  updateStarBtn();
  // 相近色：ΔE 最近 5 个（排除自身）
  $("#dSimilar").innerHTML = nearestColors(c.hex, 5, c.name).map(({ c: n, d }) =>
    `<button class="sim-item" data-name="${n.name}"
          style="background:${n.hex};color:${textColorFor(n.rgb[0], n.rgb[1], n.rgb[2])}">
      <span class="sim-name">${n.name}</span>
      <span class="sim-de">ΔE ${d.toFixed(1)}</span>
    </button>`
  ).join("");
  openModal($("#detailModal"));
}

function updateStarBtn() {
  const starred = state.favs.some(f => f.name === detailName);
  $("#dStar").textContent = starred ? "★ 已收藏" : "☆ 收藏";
  $("#dStar").classList.toggle("primary", starred);
}

/* ---------- 调色台 ---------- */

function nearestColors(hex, n = 5, excludeName = null) {
  const lab = rgbToLab(...hexToRgb(hex));
  return state.colors
    .map(c => ({ c, d: deltaE76(lab, c.lab) }))
    .filter(x => x.c.name !== excludeName)
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

/**
 * 写入调色台当前色。
 * source: "adopt"（采纳，锁定色名）| "send"（从色卡墙/详情发送）| "manual"（HEX/滑杆微调）
 */
function setMixerColor(hex, { adoptedName = null, source = "manual" } = {}) {
  const m = state.mixer;
  if (source === "manual" && m.adoptedName) {
    m.baseName = m.adoptedName; // 脱离原值：标记微调来源
  }
  m.hex = hex.toLowerCase();
  m.adoptedName = adoptedName;
  if (adoptedName) m.baseName = null;
  renderMixer();
}

/** 页面大背景随当前色变化：与宣纸底混色约 12%，保可读性 */
function tintPage(hex) {
  const paper = [250, 247, 242];
  const a = 0.12;
  const rgb = hexToRgb(hex);
  document.body.style.backgroundColor =
    "rgb(" + rgb.map((v, i) => Math.round(v * a + paper[i] * (1 - a))).join(", ") + ")";
}

function renderMixer() {
  const m = state.mixer;
  const [r, g, b] = hexToRgb(m.hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const preview = $("#mixerPreview");
  preview.style.background = m.hex;
  preview.style.color = textColorFor(r, g, b);
  $("#mpHex").textContent = hexUpper(m.hex);

  const nameEl = $("#mpName");
  if (m.adoptedName) nameEl.textContent = m.adoptedName;
  else if (m.baseName) nameEl.textContent = `已微调（基于 ${m.baseName}）`;
  else nameEl.textContent = "自定义色";

  const hexInput = $("#hexInput");
  hexInput.value = hexUpper(m.hex);
  hexInput.classList.remove("invalid");
  $("#hexError").hidden = true;

  $("#hSlider").value = Math.round(h);
  $("#sSlider").value = Math.round(s * 100);
  $("#lSlider").value = Math.round(l * 100);
  $("#hVal").textContent = Math.round(h);
  $("#sVal").textContent = Math.round(s * 100);
  $("#lVal").textContent = Math.round(l * 100);

  tintPage(m.hex);
  renderNearest();
}

function renderNearest() {
  if (!state.ready) {
    $("#nearestList").innerHTML = Array.from({ length: 5 }, () => '<li class="near-skel"></li>').join("");
    return;
  }
  const list = nearestColors(state.mixer.hex, 5);
  $("#nearestList").innerHTML = list.map(({ c, d }, idx) =>
    `<li class="near-item ${idx === 0 ? "best" : ""}">
      <span class="near-swatch" style="background:${c.hex}"></span>
      <span class="near-info">
        <span class="near-name">${c.name}${idx === 0 ? '<span class="near-best-tag">最接近</span>' : ""}</span>
        <span class="near-de">ΔE ${d.toFixed(1)} · ${hexUpper(c.hex)}</span>
      </span>
      <button class="near-adopt" data-name="${c.name}">采纳</button>
    </li>`
  ).join("");
}

function openDrawer() {
  $("#mixer").classList.add("open");
}

/* ---------- 收藏 ---------- */

function restoreFavs() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) state.favs = arr.filter(f => f && f.name && f.hex);
  } catch (e) { state.favs = []; }
  updateFavBadge();
}

function saveFavs() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(state.favs));
    return true;
  } catch (e) {
    showToast("收藏暂不可用（浏览器存储被禁用）");
    return false;
  }
}

function updateFavBadge() {
  const badge = $("#favBadge");
  badge.textContent = state.favs.length;
  badge.hidden = state.favs.length === 0;
}

/** 收藏（仅新增）：重复收藏提示不重复添加，删除走收藏夹弹层 */
function addFav(name) {
  const c = state.byName.get(name);
  if (!c) return;
  if (state.favs.some(f => f.name === name)) {
    showToast("已在收藏夹");
    return;
  }
  if (state.favs.length >= FAV_MAX) {
    showToast("收藏已满（50），先清理一下");
    return;
  }
  const snapshot = JSON.stringify(state.favs); // 存储失败时回滚，界面与存储一致
  state.favs.push({ name: c.name, hex: c.hex });
  if (!saveFavs()) {
    state.favs = JSON.parse(snapshot);
    return;
  }
  updateFavBadge();
  renderWall();
  if (detailName === name) updateStarBtn();
  renderFavModal();
  // 星标微动画
  const btn = $(`.card [data-star][aria-label="收藏 ${name}"]`);
  if (btn) { btn.classList.add("star-pop"); setTimeout(() => btn.classList.remove("star-pop"), 320); }
}

/** 从收藏夹移除（仅收藏夹弹层入口） */
function removeFav(name) {
  const idx = state.favs.findIndex(f => f.name === name);
  if (idx < 0) return;
  state.favs.splice(idx, 1);
  if (!saveFavs()) return;
  updateFavBadge();
  renderWall();
  if (detailName === name) updateStarBtn();
  renderFavModal();
}

/* ---------- 收藏夹弹层 & 导出 CSS ---------- */

function buildCss() {
  const used = Object.create(null);
  const lines = state.favs.map(f => {
    const c = state.byName.get(f.name);
    let v = (c && c.pinyin) || f.name.toLowerCase();
    used[v] = (used[v] || 0) + 1;
    if (used[v] > 1) v = `${v}-${used[v]}`; // 拼音重名自动加序号
    return `  --${v}: ${f.hex};`;
  });
  return ":root {\n" + lines.join("\n") + "\n}\n";
}

function renderFavModal() {
  const list = $("#favList"), empty = $("#favEmpty"),
    foot = $("#favFoot"), exportWrap = $("#favExportWrap");
  $("#favCount").textContent = state.favs.length ? `· ${state.favs.length}` : "";

  if (!state.favs.length) {
    list.innerHTML = "";
    empty.hidden = false;
    foot.hidden = true;
    exportWrap.hidden = true;
    return;
  }
  empty.hidden = true;
  foot.hidden = false;
  list.innerHTML = state.favs.map(f => {
    const c = state.byName.get(f.name);
    const rgb = c ? c.rgb : hexToRgb(f.hex);
    return `<div class="fav-item" data-name="${f.name}">
      <span class="fav-swatch" data-open style="background:${f.hex}" title="查看详情"></span>
      <span class="fav-info" data-open>
        <span class="fav-name">${f.name}</span>
        <span class="fav-hex" style="display:block">${hexUpper(f.hex)}</span>
      </span>
      <button class="fav-remove" data-remove aria-label="移除 ${f.name}">✕</button>
    </div>`;
  }).join("");
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  /* 搜索：防抖 200ms */
  let searchTimer = null;
  $("#search").addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value;
      if (state.ready) renderWall();
    }, 200);
  });

  /* 色系 chips：单选切换，再点当前项回到全部 */
  $("#chips").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.group = state.group === chip.dataset.g ? "全部" : chip.dataset.g;
    renderChips();
    renderWall();
  });

  /* 色卡墙：整卡进详情 / 星标收藏 / ⇗ 发送到调色台 */
  $("#wall").addEventListener("click", e => {
    const star = e.target.closest("[data-star]");
    if (star) { addFav(state.colors[+star.closest(".card").dataset.i].name); return; }
    const send = e.target.closest("[data-send]");
    if (send) {
      const c = state.colors[+send.closest(".card").dataset.i];
      setMixerColor(c.hex, { adoptedName: c.name, source: "send" });
      if (window.innerWidth < 1024) openDrawer();
      return;
    }
    const card = e.target.closest(".card[data-i]");
    if (card) openDetail(state.colors[+card.dataset.i]);
  });
  $("#wall").addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card[data-i]");
    if (card) { e.preventDefault(); openDetail(state.colors[+card.dataset.i]); }
  });

  /* 今日一色进详情 */
  $("#hero").addEventListener("click", () => {
    if (state.ready) openDetail(heroColor());
  });

  /* 弹层关闭：遮罩 / ✕ / Esc */
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", e => {
      if (e.target.closest("[data-close]")) closeModal(m);
    });
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal:not([hidden])");
    if (open) { closeModal(open); return; }
    if ($("#mixer").classList.contains("open")) { $("#mixer").classList.remove("open"); return; }
    document.body.classList.remove("search-open");
  });

  /* 详情弹层：复制 / 收藏 / 发送到调色台 / 相近色切换 */
  $("#detailModal").addEventListener("click", e => {
    const c = state.byName.get(detailName);
    if (!c) return;
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      const kind = copyBtn.dataset.copy;
      if (kind === "hex") copyText(hexUpper(c.hex), `已复制 ${hexUpper(c.hex)} ${c.name}`);
      if (kind === "rgb") copyText(`rgb(${c.rgb.join(", ")})`, `已复制 rgb(${c.rgb.join(", ")})`);
      if (kind === "hsl") copyText(fmtHsl(c.rgb), `已复制 ${fmtHsl(c.rgb)}`);
      return;
    }
    const sim = e.target.closest(".sim-item");
    if (sim) { openDetail(state.byName.get(sim.dataset.name)); return; }
  });
  $("#dStar").addEventListener("click", () => addFav(detailName));
  $("#dSend").addEventListener("click", () => {
    const c = state.byName.get(detailName);
    if (!c) return;
    setMixerColor(c.hex, { adoptedName: c.name, source: "send" });
    closeModal($("#detailModal"));
    if (window.innerWidth < 1024) openDrawer();
  });

  /* 收藏夹 */
  $("#favBtn").addEventListener("click", () => {
    renderFavModal();
    openModal($("#favModal"));
  });
  $("#favModal").addEventListener("click", e => {
    const remove = e.target.closest("[data-remove]");
    if (remove) { removeFav(remove.closest(".fav-item").dataset.name); return; }
    const openIt = e.target.closest("[data-open]");
    if (openIt) {
      const c = state.byName.get(openIt.closest(".fav-item").dataset.name);
      closeModal($("#favModal"));
      if (c) openDetail(c);
      return;
    }
  });
  $("#goWall").addEventListener("click", () => {
    closeModal($("#favModal"));
    $("#wall").scrollIntoView({ behavior: "smooth" });
  });
  $("#exportCss").addEventListener("click", () => {
    $("#cssCode").textContent = buildCss();
    $("#favExportWrap").hidden = false;
  });
  $("#copyCss").addEventListener("click", () => copyText(buildCss(), "已复制 CSS 代码"));

  /* 调色台：HEX 输入。合法即应用；非法仅在失焦/回车提交时报错（不打断输入） */
  const hexInput = $("#hexInput");
  hexInput.addEventListener("input", e => {
    const raw = e.target.value.trim();
    if (!raw) { e.target.classList.remove("invalid"); $("#hexError").hidden = true; return; }
    const m = raw.match(/^#?([0-9a-fA-F]{6})$/);
    if (m) {
      e.target.classList.remove("invalid");
      $("#hexError").hidden = true;
      setMixerColor("#" + m[1].toLowerCase(), { source: "manual" });
    }
    // 长度不足 6：等待继续输入，不报错也不应用
  });
  hexInput.addEventListener("change", e => {
    const raw = e.target.value.trim();
    if (!raw) return;
    if (!raw.match(/^#?([0-9a-fA-F]{6})$/)) {
      e.target.classList.add("invalid");
      $("#hexError").hidden = false;
    }
  });

  /* 调色台：HSL 滑杆 */
  const onSlider = () => {
    const [r, g, b] = hslToRgb(+$("#hSlider").value, +$("#sSlider").value / 100, +$("#lSlider").value / 100);
    const hex = rgbToHex(r, g, b);
    if (hex !== state.mixer.hex) setMixerColor(hex, { source: "manual" });
    else renderMixer();
  };
  ["hSlider", "sSlider", "lSlider"].forEach(id => $("#" + id).addEventListener("input", onSlider));

  /* 采纳最近传统色 / 复制当前色 */
  $("#nearestList").addEventListener("click", e => {
    const btn = e.target.closest(".near-adopt");
    if (!btn) return;
    const c = state.byName.get(btn.dataset.name);
    if (c) setMixerColor(c.hex, { adoptedName: c.name, source: "adopt" });
  });
  $("#copyCurrent").addEventListener("click", () => {
    const m = state.mixer;
    const label = m.adoptedName ? `${hexUpper(m.hex)} ${m.adoptedName}` : hexUpper(m.hex);
    copyText(hexUpper(m.hex), `已复制 ${label}`);
  });

  /* 鼠标悬浮色卡 / 今日一色：页面大背景即时跟随，移出回到调色台当前色 */
  let hoverTintIdx = -1;
  $("#wall").addEventListener("mouseover", e => {
    const card = e.target.closest(".card[data-i]");
    if (!card) return;
    const i = +card.dataset.i;
    if (i === hoverTintIdx || !state.colors[i]) return;
    hoverTintIdx = i;
    tintPage(state.colors[i].hex);
  });
  $("#wall").addEventListener("mouseout", e => {
    const card = e.target.closest(".card[data-i]");
    if (!card || card.contains(e.relatedTarget)) return;
    if (hoverTintIdx === +card.dataset.i) {
      hoverTintIdx = -1;
      tintPage(state.mixer.hex);
    }
  });
  $("#hero").addEventListener("mouseenter", () => {
    if (state.ready) tintPage(heroColor().hex);
  });
  $("#hero").addEventListener("mouseleave", () => {
    if (state.ready) tintPage(state.mixer.hex);
  });

  /* 移动端：搜索图标 / 调色抽屉 / FAB */
  $("#searchIcon").addEventListener("click", () => {
    document.body.classList.toggle("search-open");
    if (document.body.classList.contains("search-open")) $("#search").focus();
  });
  $("#fab").addEventListener("click", () => $("#mixer").classList.toggle("open"));
  $("#mixerHandle").addEventListener("click", () => $("#mixer").classList.remove("open"));

  /* 手动复制降级面板关闭 */
  $("#manualCopyClose").addEventListener("click", () => { $("#manualCopy").hidden = true; });
}

/* ---------- 启动 ---------- */

function init() {
  bindEvents();
  showWallSkeleton();
  renderNearest(); // 色库未就绪：结果区骨架条
  ["#hSlider", "#sSlider", "#lSlider", "#hexInput"].forEach(s => $(s).disabled = true);
  loadColors();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
