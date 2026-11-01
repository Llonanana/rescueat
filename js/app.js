/* RescuEat 前端主程式
 * 資料：data/*.js（由 scripts/build_web_data.py 從營養資料分析產生）
 * 若 js/config.js 設定了 APPS_SCRIPT_URL，品項改從 Google 試算表讀取，預訂寫回試算表。
 */
(function () {
  "use strict";

  const CFG = window.RE_CONFIG || {};
  const SHOPS = window.RE_SHOPS.shops;
  const GATE = window.RE_SHOPS.gate;
  const FOODS = window.RE_FOODS;
  const DRIS = window.RE_DRIS;
  const RECIPES = window.RE_RECIPES;
  const STATS = window.RE_STATS;
  const shopById = Object.fromEntries(SHOPS.map((s) => [s.id, s]));
  const foodById = Object.fromEntries(FOODS.map((f) => [f.id, f]));
  const CATS = ["主食", "蛋白質", "蔬菜"];
  const GROUP_COLOR = { 主食: "var(--g-staple)", 蛋白質: "var(--g-protein)", 蔬菜: "var(--g-veg)", 乳品: "#6A7FB0", 水果: "#D06A1F", 油脂與堅果: "#8A6D3B", 其他: "#8C93A0" };

  let items = window.RE_LISTINGS.items.map((x) => ({ ...x }));
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => Number(n).toLocaleString("zh-TW", { maximumFractionDigits: d, minimumFractionDigits: 0 });

  // ---------- 本機儲存（失敗時退回記憶體） ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密瀏覽等情況 */ } },
  };
  let reservations = store.get("re_reservations", []);
  let eaten = store.get("re_eaten", []);

  // 套用本機預訂扣掉的份數（示範模式）
  function applyLocalReservations() {
    if (CFG.APPS_SCRIPT_URL) return;
    for (const r of reservations) for (const id of r.itemIds) {
      const it = items.find((x) => x.id === id);
      if (it) it.qty = Math.max(0, it.qty - 1);
    }
  }

  // ---------- 距離 ----------
  function meters(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const distOf = (shopId) => meters(GATE, shopById[shopId]);
  const distLabel = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} 公尺` : `${(m / 1000).toFixed(1)} 公里`);
  function walkLink(shopIds) {
    const pts = shopIds.map((id) => `${shopById[id].lat},${shopById[id].lng}`);
    const dest = pts[pts.length - 1];
    const way = pts.slice(0, -1).join("|");
    return `https://www.google.com/maps/dir/?api=1&origin=${GATE.lat},${GATE.lng}&destination=${dest}` +
      (way ? `&waypoints=${encodeURIComponent(way)}` : "") + "&travelmode=walking";
  }

  // ---------- 分頁 ----------
  function showView(name) {
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${name}`));
    if (name === "map" && map) setTimeout(() => map.invalidateSize(), 0);
    if (name === "combo") renderCombos();
    if (name === "nutri") renderNutrition();
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  // ---------- 品項 ----------
  const walkMin = (m) => Math.max(1, Math.ceil(m / 75));          // 步行約 75 公尺／分鐘
  const saveOf = (it) => it.price - it.deal;
  const offOf = (it) => Math.round((it.deal / it.price) * 10 * 10) / 10;   // 7 → 「7 折」
  function nutriText(it) {
    if (it.kcal == null) return `<span class="nutri">營養待店家標示</span>`;
    const src = it.nsrc === "official" ? "店家標示" : CFG.ESTIMATE_NOTE;
    const tip = it.nsrc === "official" ? "店家官方營養標示" : `${CFG.ESTIMATE_NOTE}：${it.nnote || ""}`;
    return `<span class="nutri" title="${esc(tip)}">${fmt(it.kcal)} 大卡・蛋白質 ${fmt(it.protein, 1)} g <small>${src}</small></span>`;
  }
  function codeFor(itemId) {
    const r = [...reservations].reverse().find((x) => x.itemIds.includes(itemId));
    return r ? r.code : null;
  }
  // 單一品項（地圖清單、組一餐、下一餐推薦共用）
  function itemRow(it, { showShop = false, note = "" } = {}) {
    const code = codeFor(it.id);
    const soldOut = it.qty <= 0;
    const shop = shopById[it.shop];
    return `<li class="row ${soldOut ? "is-out" : ""}" data-cat="${esc(it.cat)}">
      <div class="row-main">
        <span class="cat"><i aria-hidden="true"></i>${esc(it.cat)}</span>
        <h4>${esc(it.name)}</h4>
        ${showShop ? `<p class="row-shop"><button class="linklike" data-focus-shop="${esc(it.shop)}">${esc(shop.name)}</button>，步行 ${walkMin(distOf(it.shop))} 分鐘</p>` : ""}
        ${note ? `<p class="row-note">${note}</p>` : ""}
        <p class="row-meta">${nutriText(it)}${it.micro ? `<span class="tag">可微波</span>` : ""}<span class="left ${it.qty <= 1 && !soldOut ? "low" : ""}">${soldOut ? "已訂完" : `剩 ${it.qty} 份`}</span></p>
      </div>
      <div class="row-price">
        <span class="sticker" title="惜食價：打烊前的出清價">$${it.deal}</span>
        <span class="was">原價 <s>$${it.price}</s></span>
        <span class="save">省 $${saveOf(it)}</span>
      </div>
      <div class="row-act">
        ${code ? `<span class="code" title="到店出示取餐碼">取餐碼 <b>${esc(code)}</b></span>`
               : `<button class="btn" data-reserve="${esc(it.id)}" ${soldOut ? "disabled" : ""}>${soldOut ? "已訂完" : "預訂"}</button>`}
      </div>
    </li>`;
  }

  // ---------- 地圖 ----------
  let map = null;
  const markers = {};
  function liveOf(shopId) { return items.filter((x) => x.shop === shopId && x.qty > 0); }
  function initMap() {
    map = L.map("map", { scrollWheelZoom: true, zoomControl: false }).setView([24.98775, 121.5759], 18);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    // 預設底圖：內政部國土測繪中心「臺灣通用電子地圖」（政府開放資料，中文標示、定期更新，免金鑰）
    const nlsc = L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", {
      maxNativeZoom: 18, maxZoom: 19,
      attribution: '底圖 &copy; <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>',
    }).addTo(map);
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    });
    L.control.layers({ "臺灣通用電子地圖": nlsc, "OpenStreetMap": osm }, null, { position: "topright" }).addTo(map);
    L.marker([GATE.lat, GATE.lng], {
      icon: L.divIcon({ className: "", html: '<span class="gate-pin">政大正門</span>', iconSize: null }),
      interactive: false, keyboard: false,
    }).addTo(map);
    for (const s of SHOPS) {
      markers[s.id] = L.marker([s.lat, s.lng], { title: s.name, riseOnHover: true }).addTo(map);
      markers[s.id].on("click", () => selectShop(s.id, { fly: false }));
    }
    refreshMarkers();
    // 一開始把政大正門附近 600 公尺內的店家都框進畫面（手機、電腦都適用）
    const near = SHOPS.filter((x) => distOf(x.id) < 600).map((x) => [x.lat, x.lng]);
    map.fitBounds(L.latLngBounds([[GATE.lat, GATE.lng], ...near]), { padding: [36, 24], maxZoom: 18 });
    // 拉遠時，洽談中的店縮成小圓點，避免標籤疊在一起
    const zoomClass = () => map.getContainer().classList.toggle("zoom-lo", map.getZoom() < 18);
    map.on("zoomend", zoomClass); zoomClass();
  }
  function shortName(s) { return s.name.replace(/ 政大店| 給力盒子/g, "").replace("傳統甜點麵包店", ""); }
  function refreshMarkers() {
    if (!map) return;
    for (const s of SHOPS) {
      const live = liveOf(s.id);
      const on = filt.shop === s.id ? " is-on" : "";
      const html = live.length
        ? `<span class="shop-pin live${on}"><b>${esc(shortName(s))}</b><span>${live.reduce((t, x) => t + x.qty, 0)} 份・$${Math.min(...live.map((x) => x.deal))} 起</span></span>`
        : `<span class="shop-pin${on}"><b>${esc(shortName(s))}</b><span>洽談中</span></span>`;
      markers[s.id].setIcon(L.divIcon({ className: "", html, iconSize: null, iconAnchor: [0, 0] }));
      markers[s.id].setZIndexOffset(live.length ? 1000 : 0);
    }
  }
  function selectShop(id, { fly = true } = {}) {
    showView("map");
    filt.shop = id;
    if (fly) map.flyTo([shopById[id].lat, shopById[id].lng], 18, { duration: 0.5 });
    renderListings();
    const panel = $(".panel");
    if (getComputedStyle(panel).overflowY === "auto") panel.scrollTo({ top: $("#shopFilter").offsetTop - 12, behavior: "smooth" });
    else $("#shopFilter").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const focusShop = (id) => selectShop(id);

  // ---------- 剩食清單（依店家分組） ----------
  const filt = { cat: "全部", micro: false, sort: "price", shop: null };
  function shopHead(s, list) {
    const m = distOf(s.id);
    const until = list.map((x) => x.until).sort()[0];
    return `<header class="shop-head">
      <div>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.type)}，步行約 ${walkMin(m)} 分鐘（${distLabel(m)}）</p>
      </div>
      <div class="shop-when">
        ${until ? `<span class="until">${esc(until)} 前取餐</span>` : ""}
        <a href="${walkLink([s.id])}" target="_blank" rel="noopener">路線</a>
      </div>
    </header>`;
  }
  function renderSummary() {
    const live = items.filter((x) => x.qty > 0);
    const shops = new Set(live.map((x) => x.shop));
    const best = live.reduce((m, x) => Math.max(m, saveOf(x)), 0);
    $("#tonight").innerHTML = live.length
      ? `今晚 <b>${shops.size}</b> 家店出清 <b>${live.reduce((t, x) => t + x.qty, 0)}</b> 份，最低 <b>$${Math.min(...live.map((x) => x.deal))}</b>，最多省 <b>$${best}</b>`
      : "今晚的惜食都被訂完了，明天傍晚再來看看。";
  }
  function renderListings() {
    renderSummary();
    let list = items.filter((x) => (filt.cat === "全部" || x.cat === filt.cat) && (!filt.micro || x.micro) && (!filt.shop || x.shop === filt.shop));
    const by = {
      price: (a, b) => a.deal - b.deal,
      save: (a, b) => saveOf(b) - saveOf(a),
      protein: (a, b) => (b.protein ?? -1) - (a.protein ?? -1),
    }[filt.sort];
    list.sort((a, b) => (b.qty > 0) - (a.qty > 0) || by(a, b));
    const shopIds = [...new Set(list.map((x) => x.shop))].sort((a, b) => distOf(a) - distOf(b));
    const sel = filt.shop ? shopById[filt.shop] : null;
    $("#shopFilter").innerHTML = sel ? `只看 <b>${esc(sel.name)}</b> <button class="linklike" id="clearShop">看全部店家</button>` : "";
    $("#shopFilter").hidden = !sel;
    if (sel && !liveOf(sel.id).length && !list.length) {
      $("#listings").innerHTML = `<li class="empty"><b>${esc(sel.name)}</b> 還在洽談合作，目前沒有上架惜食。平日 ${esc(sel.hours)}。</li>`;
    } else {
      $("#listings").innerHTML = shopIds.length ? shopIds.map((id) => {
        const rows = list.filter((x) => x.shop === id);
        return `<li class="shop-group">${shopHead(shopById[id], rows.filter((x) => x.qty > 0))}<ul class="rows">${rows.map((x) => itemRow(x)).join("")}</ul></li>`;
      }).join("") : `<li class="empty">沒有符合的品項。換個類別，或取消「只看可微波」。</li>`;
    }
    $("#clearShop")?.addEventListener("click", () => { filt.shop = null; renderListings(); });
    const pending = SHOPS.filter((s) => !items.some((x) => x.shop === s.id));
    $("#pendingShops").innerHTML = pending.map((s) => `<li><button class="linklike" data-focus-shop="${s.id}">${esc(s.name)}</button><span class="meta">${esc(s.type)}，步行 ${walkMin(distOf(s.id))} 分鐘</span></li>`).join("");
    refreshMarkers();
  }
  $$("#view-map .chip").forEach((c) => c.addEventListener("click", () => {
    $$("#view-map .chip").forEach((x) => { x.classList.toggle("is-on", x === c); x.setAttribute("aria-pressed", x === c); });
    filt.cat = c.dataset.cat; renderListings();
  }));
  $("#onlyMicro").addEventListener("change", (e) => { filt.micro = e.target.checked; renderListings(); });
  $("#sortBy").addEventListener("change", (e) => { filt.sort = e.target.value; renderListings(); });

  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-reserve]");
    if (r) openReserve([r.dataset.reserve]);
    const c = e.target.closest("[data-reserve-combo]");
    if (c) openReserve(c.dataset.reserveCombo.split(","));
    const f = e.target.closest("[data-focus-shop]");
    if (f) focusShop(f.dataset.focusShop);
  });

  // ---------- 預訂 ----------
  const dlg = $("#reserveDialog");
  let pendingIds = [];
  function openReserve(ids) {
    pendingIds = ids;
    const its = ids.map((id) => items.find((x) => x.id === id));
    const total = its.reduce((s, x) => s + x.deal, 0);
    const until = its.map((x) => x.until).sort()[0];
    $("#dlgTitle").textContent = its.length > 1 ? "預訂這組惜食" : "預訂這份惜食";
    $("#dlgBody").innerHTML = `<ul>${its.map((x) => `<li>${esc(shopById[x.shop].name)}：${esc(x.name)} $${x.deal}</li>`).join("")}</ul>
      <p>合計 <b>$${total}</b>，到店付款。請在 <b>${esc(until)}</b> 前取餐，逾時店家可另行出售。</p>`;
    $("#dlgConfirm").disabled = its.some((x) => x.qty <= 0);
    dlg.showModal();
  }
  dlg.addEventListener("close", async () => {
    if (dlg.returnValue !== "confirm") return;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (CFG.APPS_SCRIPT_URL) {
      try {
        await fetch(CFG.APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "reserve", itemIds: pendingIds, code }) });
      } catch { alert("預訂沒有送出，請檢查網路後再試一次。"); return; }
    }
    pendingIds.forEach((id) => { const it = items.find((x) => x.id === id); it.qty = Math.max(0, it.qty - 1); });
    reservations.push({ code, itemIds: pendingIds, at: new Date().toISOString() });
    store.set("re_reservations", reservations);
    renderAll();
    $("#dlgTitle").textContent = "已預訂";
    $("#dlgBody").innerHTML = `<p>到店出示取餐碼：</p><p class="pickup-code">${code}</p><p class="hint">示範模式：預訂只存在這台裝置。</p>`;
    $("#dlgConfirm").hidden = true;
    const cancelBtn = $(".dlg-actions .ghost"); cancelBtn.textContent = "關閉";
    dlg.returnValue = "";
    dlg.showModal();
    dlg.addEventListener("close", () => { $("#dlgConfirm").hidden = false; cancelBtn.textContent = "取消"; }, { once: true });
  });

  // ---------- 組一餐 ----------
  function routeLength(shopIds) {
    let pos = GATE, left = [...new Set(shopIds)], total = 0, order = [];
    while (left.length) {
      left.sort((a, b) => meters(pos, shopById[a]) - meters(pos, shopById[b]));
      const nxt = left.shift(); total += meters(pos, shopById[nxt]); pos = shopById[nxt]; order.push(nxt);
    }
    return { total, order };
  }
  function buildCombos(budget, noFried) {
    // 蛋白質至少要有 1 份豆魚蛋肉（約 7 g 蛋白質，每日飲食指南），半顆蛋這類加購品不算一份
    const pool = (cat) => items.filter((x) => x.cat === cat && x.qty > 0 && !(noFried && x.fried) &&
      (cat !== "蛋白質" || (x.protein ?? 0) >= 7));
    const out = [];
    for (const s of pool("主食")) for (const p of pool("蛋白質")) for (const v of pool("蔬菜")) {
      const total = s.deal + p.deal + v.deal;
      if (total > budget) continue;
      const route = routeLength([s.shop, p.shop, v.shop]);
      out.push({ s, p, v, total, route });
    }
    out.sort((a, b) => a.total - b.total || a.route.total - b.route.total || (b.p.protein ?? 0) - (a.p.protein ?? 0));
    // 同一個蛋白質只留最便宜的組合，避免三組都長得一樣
    const seen = new Set(), picked = [];
    for (const c of out) { if (seen.has(c.p.id)) continue; seen.add(c.p.id); picked.push(c); if (picked.length === 3) break; }
    return picked;
  }
  function renderCombos() {
    const budget = Math.max(0, +$("#budget").value || 0);
    const noFried = $("#noFried").checked;
    const combos = buildCombos(budget, noFried);
    $("#combos").innerHTML = combos.length ? combos.map((c) => {
      const parts = [c.s, c.p, c.v];
      const kcal = parts.reduce((t, x) => t + (x.kcal || 0), 0);
      const prot = parts.reduce((t, x) => t + (x.protein || 0), 0);
      const est = parts.some((x) => x.nsrc !== "official");
      const shops = c.route.order.map((id) => shopById[id].name);
      return `<li class="combo">
        <div class="combo-head"><h4>${shops.length > 1 ? `跨 ${shops.length} 家店` : esc(shops[0])}</h4><span class="combo-total">$${c.total}</span></div>
        <div class="plate">
          <div class="s"><b>主食</b>${esc(c.s.name)} $${c.s.deal}</div>
          <div class="p"><b>蛋白質</b>${esc(c.p.name)} $${c.p.deal}</div>
          <div class="v"><b>蔬菜</b>${esc(c.v.name)} $${c.v.deal}</div>
        </div>
        <ul class="badges"><li>有主食</li><li>有蛋白質</li><li>有蔬菜</li>${parts.every((x) => !x.fried) ? "<li>非油炸</li>" : ""}</ul>
        <p class="meta">約 ${fmt(kcal)} 大卡，蛋白質 ${fmt(prot, 1)} g${est ? `（${CFG.ESTIMATE_NOTE}）` : ""}。取餐路線：${shops.map(esc).join("、")}，從正門走約 ${distLabel(c.route.total)}。</p>
        <div class="actions" style="display:flex;gap:8px;margin-top:10px">
          <button class="btn" data-reserve-combo="${parts.map((x) => x.id).join(",")}">預訂這組</button>
          <a class="btn ghost" href="${walkLink(c.route.order)}" target="_blank" rel="noopener">看取餐路線</a>
        </div>
      </li>`;
    }).join("") : `<li class="empty">$${budget} 內組不出主食＋蛋白質＋蔬菜。試著把預算提高到 $70 以上，或看看下方的完整餐盒。</li>`;
    const boxes = items.filter((x) => x.cat === "完整餐盒" && x.qty > 0 && x.deal <= budget).sort((a, b) => a.deal - b.deal);
    $("#boxes").innerHTML = boxes.length ? boxes.map((x) => itemRow(x, { showShop: true })).join("") : `<li class="empty">預算內沒有完整餐盒。</li>`;
  }
  $("#budget").addEventListener("input", renderCombos);
  $("#noFried").addEventListener("change", renderCombos);

  // ---------- 我的營養 ----------
  const PAL = { 低: 1.3, 稍低: 1.5, 適度: 1.7, 高: 1.9 };
  const profile = store.get("re_profile", null);
  if (profile) for (const [k, v] of Object.entries(profile)) { const el = $(`#profile [name=${k}]`); if (el) el.value = v; }
  function readProfile() {
    const fd = new FormData($("#profile"));
    const p = Object.fromEntries(fd.entries());
    store.set("re_profile", p);
    return { sex: p.sex, age: +p.age || 20, height: +p.height || 160, weight: +p.weight || 55, activity: p.activity };
  }
  function needsFor(p) {
    const age = Math.max(16, p.age);
    const row = DRIS.find((r) => r["性別"] === p.sex && r["年齡下限"] <= age && age <= r["年齡上限"]);
    const bmr = 10 * p.weight + 6.25 * p.height - 5 * age + (p.sex === "男" ? 5 : -161);
    const kcal = Math.round(bmr * PAL[p.activity]);
    const tableKcal = row[`熱量_${p.activity}`];
    const fiber = row[`fiber_${p.activity}`] ?? row["fiber_適度"];
    return {
      row, bmr, kcal, tableKcal,
      targets: [
        { key: "energy_kcal", label: "熱量", unit: "大卡", need: kcal },
        { key: "protein_g", label: "蛋白質", unit: "g", need: row.protein_g },
        { key: "fiber_g", label: "膳食纖維", unit: "g", need: fiber },
        { key: "calcium_mg", label: "鈣", unit: "mg", need: row.calcium_mg },
        { key: "iron_mg", label: "鐵", unit: "mg", need: row.iron_mg },
        { key: "vitC_mg", label: "維生素 C", unit: "mg", need: row.vitC_mg },
        { key: "sodium_mg", label: "鈉（上限）", unit: "mg", need: row.sodium_mg, upper: true },
      ],
    };
  }
  function eatenTotals() {
    const t = {};
    for (const e of eaten) {
      const f = foodById[e.id]; if (!f) continue;
      for (const k of ["energy_kcal", "protein_g", "fiber_g", "calcium_mg", "iron_mg", "vitC_mg", "sodium_mg"]) t[k] = (t[k] || 0) + (f[k] || 0) * e.g / 100;
    }
    return t;
  }
  function renderNutrition() {
    const p = readProfile();
    const N = needsFor(p);
    $("#energyNote").textContent = `每日熱量約 ${fmt(N.kcal)} 大卡：基礎代謝 ${fmt(N.bmr)} 大卡（依你的身高體重年齡）× 活動係數 ${PAL[p.activity]}。` +
      (N.tableKcal ? `DRIs 表同年齡同性別的參考值為 ${fmt(N.tableKcal)} 大卡。` : "");
    $("#eaten").innerHTML = eaten.length ? eaten.map((e, i) => {
      const f = foodById[e.id];
      return `<li><span>${esc(f ? friendly(f).main : e.id)} ${fmt(e.g)} g，${fmt((f?.energy_kcal || 0) * e.g / 100)} 大卡</span><button data-del="${i}" aria-label="刪除 ${esc(f?.n)}">刪除</button></li>`;
    }).join("") : `<li class="empty">還沒有紀錄。搜尋上方的食藥署資料庫，把今天吃的東西加進來。</li>`;
    const T = eatenTotals();
    $("#bars").innerHTML = N.targets.map((t) => {
      const got = T[t.key] || 0, pct = t.need ? got / t.need * 100 : 0;
      const over = t.upper && got > t.need;
      return `<div class="bar-row"><span>${t.label}</span>
        <div class="bar ${over ? "over" : ""}" role="img" aria-label="${t.label} ${fmt(pct)}%"><span style="width:${Math.min(100, pct)}%"></span></div>
        <span class="v">${fmt(got, t.unit === "mg" && t.need < 50 ? 1 : 0)} / ${fmt(t.need)} ${t.unit}</span></div>`;
    }).join("");
    // 下一餐：剩餘熱量的 45% 當作這一餐的額度，優先補蛋白質
    const leftKcal = Math.max(0, N.kcal - (T.energy_kcal || 0));
    const mealKcal = leftKcal * 0.45;
    const gapP = Math.max(0, N.row.protein_g - (T.protein_g || 0));
    const cand = items.filter((x) => x.cat === "完整餐盒" && x.qty > 0 && x.kcal);
    const scored = cand.map((x) => {
      const cover = gapP ? Math.min(x.protein, gapP) / gapP : 0;
      const over = Math.max(0, x.kcal - mealKcal * 1.1) / Math.max(mealKcal, 1);
      return { x, s: cover - over, cover };
    }).sort((a, b) => b.s - a.s).slice(0, 3);
    $("#nextHint").textContent = `你今天還剩約 ${fmt(leftKcal)} 大卡、蛋白質還差 ${fmt(gapP, 1)} g。下一餐以 ${fmt(mealKcal)} 大卡為額度，優先補蛋白質。`;
    $("#nextMeal").innerHTML = scored.map(({ x, cover }) => itemRow(x, { showShop: true, note: `可補今天蛋白質缺口的 ${fmt(cover * 100)}%` })).join("");
  }
  $("#profile").addEventListener("input", renderNutrition);
  $("#eaten").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    eaten.splice(+b.dataset.del, 1); store.set("re_eaten", eaten); renderNutrition();
  });
  // 食材搜尋（名稱與俗名）
  // 日常說法 → 食藥署樣品名稱
  const SYN = { 雞胸: "去皮清肉", 雞胸肉: "去皮清肉", 雞腿: "清腿", 雞腿肉: "清腿", 高麗菜: "甘藍", 地瓜: "甘藷", 地瓜葉: "甘藷葉",
    芭樂: "芭樂", 番石榴: "芭樂", 豬排: "豬大里肌", 牛奶: "全脂鮮乳", 鮮奶: "全脂鮮乳", 吐司: "土司", 青菜: "小白菜" };
  // 食藥署樣品名稱 → 日常說法（只換顯示，資料仍用官方那一筆）
  const FRIENDLY = [
    [/^去皮清肉/, "雞胸肉（去皮）"], [/^清腿/, "雞腿肉（去骨）"], [/^骨腿/, "雞腿（帶骨）"],
    [/^甘藍(?!芽)/, "高麗菜"], [/甘藷葉/, "地瓜葉"], [/甘藷/, "地瓜"], [/^土司/, "吐司"],
    [/^全脂鮮乳/, "鮮奶（全脂）"], [/^豬大里肌/, "豬里肌"], [/^北蕉/, "香蕉"], [/^大番茄/, "番茄"],
  ];
  function friendly(f) {
    let main = f.n;
    for (const [re, rep] of FRIENDLY) main = main.replace(re, rep);
    main = main.replace("平均值", "");
    return { main, official: main !== f.n ? f.n : "" };
  }
  function searchFoods(q) {
    q = q.trim(); if (!q) return [];
    const terms = [q, SYN[q]].filter(Boolean);
    const score = (f) => {
      let best = 99;
      terms.forEach((t, i) => {
        if (f.n === t || f.n === `${t}平均值`) best = Math.min(best, 0 + i * 0.1);
        else if (f.n.startsWith(t)) best = Math.min(best, 1 + i * 0.1);
        else if (f.n.includes(t)) best = Math.min(best, 2 + i * 0.1);
        else if (f.a && f.a.split(/[,，、]/).some((a) => a.trim() === t)) best = Math.min(best, 1.5);
        else if (f.a && f.a.includes(t)) best = Math.min(best, 3);
      });
      if (best === 99) return 99;                    // 沒有命中就不列出
      if (f.n.includes("平均值")) best -= 0.5;      // 平均值最能代表一般食材
      if (/湯|粉|乾|罐頭|骨/.test(f.n) && !/湯|粉|乾|罐頭|骨/.test(q)) best += 1;
      return best;
    };
    return FOODS.map((f) => [f, score(f)]).filter(([, s]) => s < 99)
      .sort((a, b) => a[1] - b[1] || a[0].n.length - b[0].n.length).slice(0, 12).map(([f]) => f);
  }
  $("#foodSearch").addEventListener("input", (e) => {
    const res = searchFoods(e.target.value);
    $("#foodResults").innerHTML = res.map((f) => {
      const nm = friendly(f);
      return `<li><button data-add="${f.id}"><span>${esc(nm.main)} <small>${esc(f.g)}</small>${nm.official ? `<small class="official">食藥署名稱：${esc(nm.official)}</small>` : ""}</span><small>${fmt(f.energy_kcal)} 大卡、蛋白質 ${fmt(f.protein_g ?? 0, 1)} g / 100 g</small></button></li>`;
    }).join("")
      || (e.target.value.trim() ? `<li class="hint">資料庫裡找不到「${esc(e.target.value)}」，換個說法試試，例如「雞腿」改「清腿」。</li>` : "");
  });
  $("#foodResults").addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    eaten.push({ id: b.dataset.add, g: Math.max(1, +$("#foodGrams").value || 100) });
    store.set("re_eaten", eaten);
    $("#foodSearch").value = ""; $("#foodResults").innerHTML = "";
    renderNutrition();
  });

  // ---------- 剩食料理 ----------
  const EQUIP = ["微波爐", "電鍋", "快煮鍋", "免開火"];
  const INGS = ["蛋", "番茄", "燕麥", "豆腐", "雞胸", "地瓜", "生菜", "麵條", "小白菜", "杏鮑菇", "吐司"];
  const rSel = { equip: new Set(), ing: new Set() };
  $("#equipChips").innerHTML = EQUIP.map((x) => `<button class="chip" data-equip="${x}" aria-pressed="false">${x}</button>`).join("");
  $("#ingChips").innerHTML = INGS.map((x) => `<button class="chip" data-ing="${x}" aria-pressed="false">${x}</button>`).join("");
  function toggle(set, v, btn) { set.has(v) ? set.delete(v) : set.add(v); btn.classList.toggle("is-on"); btn.setAttribute("aria-pressed", set.has(v)); renderRecipes(); }
  $("#equipChips").addEventListener("click", (e) => { const b = e.target.closest("[data-equip]"); if (b) toggle(rSel.equip, b.dataset.equip, b); });
  $("#ingChips").addEventListener("click", (e) => { const b = e.target.closest("[data-ing]"); if (b) toggle(rSel.ing, b.dataset.ing, b); });
  function renderRecipes() {
    let list = RECIPES.filter((r) => !rSel.equip.size || r.equip.some((x) => rSel.equip.has(x)))
      .map((r) => ({ r, match: r.items.filter((it) => [...rSel.ing].some((k) => it.label.includes(k))).length }))
      .sort((a, b) => b.match - a.match || a.r.min - b.r.min);
    $("#recipes").innerHTML = list.length ? list.map(({ r, match }) => `<li class="recipe">
      <h4>${esc(r.name)}</h4>
      <p class="meta">${esc(r.equip.join("、"))}，約 ${r.min} 分鐘，${fmt(r.kcal)} 大卡，蛋白質 ${fmt(r.protein, 1)} g${rSel.ing.size ? `，你有其中 ${match} 樣` : ""}</p>
      <ul>${r.items.map((it) => `<li class="${[...rSel.ing].some((k) => it.label.includes(k)) ? "have" : ""}">${esc(it.label)}（${it.g} g）</li>`).join("")}</ul>
      <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </li>`).join("") : `<li class="empty">這個設備還沒有食譜。取消一個設備條件看看。</li>`;
  }

  // ---------- 資料來源 ----------
  function renderData() {
    const s = STATS;
    $("#statGrid").innerHTML = [
      [fmt(s.rawRows), "筆原始營養數值（食藥署）"],
      [`${fmt(s.rawFoods)} → ${fmt(s.kept)}`, "項食材，清理後保留"],
      [fmt(s.droppedCore + s.droppedSparse), "項因核心數值缺漏剔除"],
      [fmt(s.imputedFiber + s.imputedB12), "筆天然不含的缺值補 0（纖維、B12）"],
    ].map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
    const g = Object.entries(s.groups).sort((a, b) => b[1] - a[1]);
    const max = g[0][1];
    $("#groupBars").innerHTML = g.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${v / max * 100}%;--gc:${GROUP_COLOR[k] || "var(--night-2)"}"></div></div><span class="n">${fmt(v)}</span></div>`).join("");
    $("#topProtein").innerHTML = s.topProtein.map((x) => `<li>${esc(x.n)}：每 100 大卡 ${x.v} g</li>`).join("");
  }

  // ---------- 啟動 ----------
  function renderAll() { renderListings(); renderCombos(); if ($("#view-nutri").classList.contains("is-active")) renderNutrition(); }
  async function loadRemote() {
    if (!CFG.APPS_SCRIPT_URL) return;
    try {
      const res = await fetch(`${CFG.APPS_SCRIPT_URL}?action=listings`);
      const data = await res.json();
      if (Array.isArray(data.items)) { items = data.items; $(".demo-note").textContent = "品項由合作店家即時上架。"; }
    } catch { $(".demo-note").textContent = "連不到店家資料，目前顯示示範品項。"; }
  }
  (async function start() {
    await loadRemote();
    applyLocalReservations();
    initMap();
    renderAll();
    renderRecipes();
    renderData();
  })();
})();
