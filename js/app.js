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
  const MEALS = window.RE_MEALS || [];
  const shopById = Object.fromEntries(SHOPS.map((s) => [s.id, s]));
  const foodById = Object.fromEntries(FOODS.map((f) => [f.id, f]));
  const CATS = ["主食", "蛋白質", "蔬菜"];

  let items = window.RE_LISTINGS.items.map((x) => ({ ...x }));
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 0) => Number(n).toLocaleString("zh-TW", { maximumFractionDigits: d, minimumFractionDigits: 0 });

  // ---------- 本機儲存（失敗時退回記憶體） ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密瀏覽等情況 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 私密瀏覽等情況 */ } },
  };
  const today = () => new Date().toLocaleDateString("sv");
  const dayOf = (iso) => new Date(iso).toLocaleDateString("sv");

  // ---------- 會員（示範版：帳號只存在這台瀏覽器，密碼加鹽雜湊後才保存） ----------
  const users = store.get("re_users", {});
  const me = users[store.get("re_session", "")] || null;
  // 訪客的資料放在 re_xxx；會員放在自己的鍵底下，登入登出不會混在一起
  const ukey = (name) => (me ? `re_u:${me.email}:${name}` : `re_${name}`);
  // 會員保留所有紀錄；訪客只留當天，隔天自動清空
  let reservationsAll = store.get(ukey("reservations"), []).filter((r) => r.at && (me || dayOf(r.at) === today()));
  let reservations = reservationsAll.filter((r) => dayOf(r.at) === today());
  const saveReservations = () => store.set(ukey("reservations"), reservationsAll);
  let eatenAll = store.get(ukey("eaten"), []).filter((e) => e.d && (me || e.d === today()));
  let viewDate = today();                                   // 「我的營養」正在看哪一天（只有會員能切換）
  const dayEaten = () => eatenAll.filter((e) => e.d === viewDate);
  const saveEaten = () => store.set(ukey("eaten"), eatenAll);
  const dayName = (d = viewDate) => (d === today() ? "今天" : `${+d.slice(5, 7)}/${+d.slice(8)}`);
  const favs = { meals: [], menu: [], recipes: [], ...store.get(ukey("favs"), {}) };
  const saveFavs = () => store.set(ukey("favs"), favs);

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

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
    $$(".tab").forEach((t) => { const on = t.dataset.view === name; t.classList.toggle("is-active", on); on ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current"); });
    window.scrollTo({ top: 0 });
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${name}`));
    if (name === "map" && map) setTimeout(() => map.invalidateSize(), 0);
    if (name === "combo") renderCombos();
    if (name === "nutri") renderNutrition();
    if (name === "account") renderAccount();
    try { history.replaceState(null, "", `#${name}`); } catch { /* 部分瀏覽器的 file:// 不允許 */ }
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  const viewFromHash = () => { const v = location.hash.slice(1); return $(`#view-${CSS.escape(v || "map")}`) ? v || "map" : "map"; };
  window.addEventListener("hashchange", () => showView(viewFromHash()));

  // ---------- 品項 ----------
  const walkMin = (m) => Math.max(1, Math.ceil(m / 75));          // 步行約 75 公尺／分鐘
  const saveOf = (it) => it.price - it.deal;
  const offOf = (it) => Math.round((it.deal / it.price) * 10 * 10) / 10;   // 7 → 「7 折」
  function nutriText(it) {
    if (it.kcal == null) return `<span class="nutri">營養待店家標示</span>`;
    const official = it.nsrc === "official";
    const tip = official ? "店家官方營養標示" : `${CFG.ESTIMATE_NOTE}：${it.nnote || ""}`;
    return `<span class="nutri" title="${esc(tip)}">${fmt(it.kcal)} 大卡，蛋白質 ${fmt(it.protein, 1)} g${official ? "" : `，<small>${CFG.ESTIMATE_NOTE}</small>`}</span>`;
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
    return `<li class="row ${soldOut ? "is-out" : ""}">
      <div class="row-line">
        <h4>${esc(it.name)}</h4><span class="leader" aria-hidden="true"></span>
        <span class="price" title="惜食價：打烊前的出清價"><s aria-label="原價 ${it.price} 元">$${it.price}</s><b>$${it.deal}</b></span>
      </div>
      <div class="row-sub">
        ${showShop ? `<p class="row-shop"><button class="linklike" data-focus-shop="${esc(it.shop)}">${esc(shop.name)}</button>，步行 ${walkMin(distOf(it.shop))} 分鐘</p>` : ""}
        ${note ? `<p class="row-note">${note}</p>` : ""}
        <p class="row-meta"><span>${esc(it.cat)}</span>${nutriText(it)}${it.micro ? `<span>可微波</span>` : ""}<span class="left ${it.qty <= 1 && !soldOut ? "low" : ""}">${soldOut ? "已訂完" : `剩 ${it.qty} 份`}</span></p>
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
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
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
    const near = SHOPS.filter((x) => distOf(x.id) < 1500).map((x) => [x.lat, x.lng]);
    if (map.getSize().x < 600) {
      // 手機：畫面只框有剩食的店與正門，右邊多留空間給店名標籤
      // 手機只框正門附近的店，遠一點的店拉遠或點清單店名就看得到
      const live = SHOPS.filter((x) => liveOf(x.id).length && distOf(x.id) < 400).map((x) => [x.lat, x.lng]);
      map.fitBounds(L.latLngBounds([[GATE.lat, GATE.lng], ...live]), { paddingTopLeft: [130, 60], paddingBottomRight: [70, 60], maxZoom: 18 });
    } else {
      map.fitBounds(L.latLngBounds([[GATE.lat, GATE.lng], ...near]), { paddingTopLeft: [30, 50], paddingBottomRight: [120, 40], maxZoom: 18 });
    }
    // 拉遠時，洽談中的店縮成小圓點，避免標籤疊在一起
    const zoomClass = () => {
      map.getContainer().classList.toggle("zoom-lo", map.getZoom() < 18);
      map.getContainer().classList.toggle("zoom-far", map.getZoom() < 17);   // 再拉遠時標籤只留店名
      map.getContainer().classList.toggle("zoom-dot", map.getZoom() < 16);   // 更遠時只留圓點，避免互相蓋住
    };
    map.on("zoomend", zoomClass); zoomClass();
  }
  function shortName(s) { return s.short || s.name.replace(/ 政大店| 給力盒子/g, ""); }
  // 標示「起」價時以完整餐盒為準，避免半顆蛋這類加購品讓價格看起來失真
  function fromLabel(list) {
    const boxes = list.filter((x) => x.cat === "完整餐盒");
    return boxes.length ? `餐盒 $${Math.min(...boxes.map((x) => x.deal))} 起` : `$${Math.min(...list.map((x) => x.deal))} 起`;
  }
  function refreshMarkers() {
    if (!map) return;
    for (const s of SHOPS) {
      const live = liveOf(s.id);
      const on = filt.shop === s.id ? " is-on" : "";
      const n = live.reduce((t, x) => t + x.qty, 0);
      const html = live.length
        ? `<span class="shop-pin live pin-${s.pin || "ne"}${on}"><span class="lbl"><b>${esc(shortName(s))}</b><span>${n} 份，${fromLabel(live)}</span></span></span>`
        : `<span class="shop-pin${on}"><span class="dot"></span><span class="lbl"><b>${esc(shortName(s))}</b><span>洽談中</span></span></span>`;
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
  const filt = { cat: "全部", micro: false, sort: "box", shop: null };
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
    const boxes = live.filter((x) => x.cat === "完整餐盒");
    $("#tonight").innerHTML = live.length
      ? `<p class="tonight-main">今晚 ${shops.size} 家店還有 ${live.reduce((t, x) => t + x.qty, 0)} 份</p>
         <p class="tonight-sub">${boxes.length ? `完整餐盒 <b>$${Math.min(...boxes.map((x) => x.deal))}</b> 起，` : ""}單份最多省 <b>$${best}</b></p>`
      : `<p class="tonight-main">今晚的惜食都訂完了</p><p class="tonight-sub">明天傍晚再來看看。</p>`;
  }
  function renderOrders() {
    const box = $("#myOrders");
    box.hidden = !reservations.length;
    box.innerHTML = reservations.length ? `<h3>我的預訂</h3><ul>${reservations.map((r, i) => {
      const its = r.itemIds.map((id) => items.find((x) => x.id === id)).filter(Boolean);
      const until = its.map((x) => x.until).sort()[0];
      return `<li>
        <b class="order-code" title="到店出示取餐碼">${esc(r.code)}</b>
        <div class="order-info">
          <span>${[...new Set(its.map((x) => x.shop))].map((sid) => `${esc(shortName(shopById[sid]))}：${its.filter((x) => x.shop === sid).map((x) => esc(x.name)).join("、")}`).join("；")}</span>
          <small>$${its.reduce((t, x) => t + x.deal, 0)}，${esc(until)} 前到店付款取餐</small>
        </div>
        ${CFG.APPS_SCRIPT_URL ? "" : `<button class="linklike" data-cancel="${i}">取消</button>`}
      </li>`;
    }).join("")}</ul>` : "";
  }
  function renderListings() {
    renderSummary();
    renderOrders();
    $$("#view-map .chip").forEach((c) => {
      $("small", c).textContent = items.filter((x) => x.qty > 0 && (c.dataset.cat === "全部" || x.cat === c.dataset.cat) && (!filt.micro || x.micro) && (!filt.shop || x.shop === filt.shop)).length;
    });
    let list = items.filter((x) => (filt.cat === "全部" || x.cat === filt.cat) && (!filt.micro || x.micro) && (!filt.shop || x.shop === filt.shop));
    const by = {
      box: (a, b) => (b.cat === "完整餐盒") - (a.cat === "完整餐盒") || a.deal - b.deal,
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
    $("#pendingWrap").hidden = !pending.length;
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
    const d = e.target.closest("[data-cancel]");
    if (d) cancelReservation(+d.dataset.cancel);
  });
  function cancelReservation(i) {
    const [r] = reservations.splice(i, 1);
    r.itemIds.forEach((id) => { const it = items.find((x) => x.id === id); if (it) it.qty += 1; });
    reservationsAll = reservationsAll.filter((x) => x !== r);
    saveReservations();
    renderAll();
    toast("已取消預訂，份數已放回。");
  }
  // 重設示範資料：清掉訪客資料並登出；已註冊的示範帳號與其紀錄保留
  $("#resetDemo").addEventListener("click", () => {
    ["re_reservations", "re_eaten", "re_profile", "re_favs", "re_session"].forEach(store.del);
    location.reload();
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
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });   // 點背景關閉
  dlg.addEventListener("close", async () => {
    if (dlg.returnValue !== "confirm") return;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (CFG.APPS_SCRIPT_URL) {
      toast("預訂中…");
      try {
        const res = await fetch(CFG.APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "reserve", itemIds: pendingIds, code }) });
        const data = await res.json();
        if (!data.ok) { toast("有品項剛被訂走了，請重新整理後再試一次。"); return; }
      } catch { toast("預訂沒有送出，請檢查網路後再試一次。"); return; }
    }
    pendingIds.forEach((id) => { const it = items.find((x) => x.id === id); it.qty = Math.max(0, it.qty - 1); });
    // 存下當時的品名與價格，日後品項下架了，預訂紀錄還看得懂
    const snap = pendingIds.map((id) => { const it = items.find((x) => x.id === id); return { name: it.name, shop: it.shop, deal: it.deal }; });
    const rec = { code, itemIds: pendingIds, at: new Date().toISOString(), items: snap };
    reservations.push(rec); reservationsAll.push(rec);
    saveReservations();
    renderAll();
    $("#dlgTitle").textContent = "已預訂";
    $("#dlgBody").innerHTML = `<p>到店出示取餐碼：</p><p class="pickup-code">${code}</p>${CFG.APPS_SCRIPT_URL ? "" : `<p class="hint">示範模式：預訂只存在這台裝置，可以在剩食地圖的「我的預訂」取消。</p>`}`;
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
    const cheapest = combos.length ? null : buildCombos(Infinity, noFried)[0];
    $("#combos").innerHTML = combos.length ? combos.map((c, i) => {
      const parts = [c.s, c.p, c.v];
      const kcal = parts.reduce((t, x) => t + (x.kcal || 0), 0);
      const prot = parts.reduce((t, x) => t + (x.protein || 0), 0);
      const est = parts.some((x) => x.kcal != null && x.nsrc !== "official");
      const unknown = parts.some((x) => x.kcal == null);
      const orig = parts.reduce((t, x) => t + x.price, 0);
      const shops = c.route.order.map((id) => shopById[id].name);
      return `<li class="combo">
        <div class="combo-head"><h4>${shops.length > 1 ? `跨 ${shops.length} 家店` : esc(shops[0])}</h4><span>No.${i + 1}</span></div>
        ${c.route.order.map((sid, n) => {
          // 依取餐順序分店列出：每家店要買什麼、從上一站走多遠
          const s = shopById[sid], prev = n ? shopById[c.route.order[n - 1]] : GATE;
          const lines = [["主食", c.s], ["蛋白質", c.p], ["蔬菜", c.v]].filter(([, x]) => x.shop === sid);
          return `<div class="stop">
            <p class="stop-head">${c.route.order.length > 1 ? `<b>${n + 1}</b>` : ""}<span>${esc(s.name)}</span><small>${n ? "再走" : "從正門走"} ${distLabel(meters(prev, s))}</small></p>
            <dl class="lines">${lines.map(([k, x]) => `<div><dt>${k}</dt><dd>${esc(x.name)}</dd><span class="leader" aria-hidden="true"></span><dd class="amt">$${x.deal}</dd></div>`).join("")}</dl>
          </div>`;
        }).join("")}
        <div class="combo-total"><span>合計</span><s aria-label="原價 ${orig} 元">$${orig}</s><b>$${c.total}</b></div>
        <p class="meta">約 ${fmt(kcal)} 大卡，蛋白質 ${fmt(prot, 1)} g${parts.every((x) => !x.fried) ? "，非油炸" : ""}。${est ? `營養含${CFG.ESTIMATE_NOTE}。` : ""}${unknown ? "部分品項店家未標示營養，只計有標示的品項。" : ""}<br>取餐路線：${shops.map(esc).join("、")}，從正門走約 ${distLabel(c.route.total)}。</p>
        <div class="combo-act">
          <button class="btn" data-reserve-combo="${parts.map((x) => x.id).join(",")}">預訂這組</button>
          <a class="btn ghost" href="${walkLink(c.route.order)}" target="_blank" rel="noopener">看取餐路線</a>
        </div>
      </li>`;
    }).join("") : `<li class="empty">${cheapest ? `$${budget} 內組不出主食＋蛋白質＋蔬菜，目前最便宜的組合要 $${cheapest.total}。` : "目前的品項湊不齊主食＋蛋白質＋蔬菜。"}可以看看下方的完整餐盒。</li>`;
    $$("#budgetChips .chip").forEach((c) => c.classList.toggle("is-on", +c.dataset.budget === budget));
    const boxes = items.filter((x) => x.cat === "完整餐盒" && x.qty > 0 && x.deal <= budget).sort((a, b) => a.deal - b.deal);
    $("#boxes").innerHTML = boxes.length ? boxes.map((x) => itemRow(x, { showShop: true })).join("") : `<li class="empty">預算內沒有完整餐盒。</li>`;
  }
  $("#budget").addEventListener("input", renderCombos);
  $("#noFried").addEventListener("change", renderCombos);
  $("#budgetChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-budget]"); if (!b) return;
    $("#budget").value = b.dataset.budget; renderCombos();
  });

  // ---------- 我的營養 ----------
  const PAL = { 低: 1.3, 稍低: 1.5, 適度: 1.7, 高: 1.9 };
  const profile = store.get(ukey("profile"), null);
  if (profile) for (const [k, v] of Object.entries(profile)) { const el = $(`#profile [name=${k}]`); if (el) el.value = v; }
  function readProfile() {
    const fd = new FormData($("#profile"));
    const p = Object.fromEntries(fd.entries());
    store.set(ukey("profile"), p);
    // 輸入到一半或超出範圍時，用合理範圍內的值計算
    const within = (v, lo, hi, d) => Math.min(hi, Math.max(lo, +v || d));
    return { sex: p.sex, age: within(p.age, 16, 100, 20), height: within(p.height, 120, 220, 160), weight: within(p.weight, 30, 200, 55), activity: p.activity };
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
  function eatenTotals(list = dayEaten()) {
    const t = {};
    // 單一食材是 { id, g }；常用餐點把組成放在 parts 裡；店家菜單品項只有熱量與蛋白質
    for (const e of list) if (e.menu) {
      t.energy_kcal = (t.energy_kcal || 0) + (e.kcal || 0);
      t.protein_g = (t.protein_g || 0) + (e.protein || 0);
    }
    for (const e of list) if (!e.menu) for (const p of e.parts || [e]) {
      const f = foodById[p.id]; if (!f) continue;
      for (const k of ["energy_kcal", "protein_g", "fiber_g", "calcium_mg", "iron_mg", "vitC_mg", "sodium_mg"]) t[k] = (t[k] || 0) + (f[k] || 0) * p.g / 100;
    }
    return t;
  }
  function renderNutrition() {
    const p = readProfile();
    const N = needsFor(p);
    $("#energyNote").textContent = `每日熱量約 ${fmt(N.kcal)} 大卡：基礎代謝 ${fmt(N.bmr)} 大卡（依你的身高體重年齡）× 活動係數 ${PAL[p.activity]}。` +
      (N.tableKcal ? `DRIs 表同年齡同性別的參考值為 ${fmt(N.tableKcal)} 大卡。` : "");
    $("#profileSum").textContent = `${p.sex}・${p.age} 歲・${p.height} cm・${p.weight} kg・活動${p.activity}`;
    $("#profileKcal").textContent = `每日約 ${fmt(N.kcal)} 大卡`;
    // 每筆紀錄：名稱與說明在左，熱量靠右對齊，方便一眼加總
    const row = (i, name, kcal, note) => `<li><div class="eaten-name"><span>${name}</span>${note ? `<small>${note}</small>` : ""}</div><span class="eaten-kcal">${fmt(kcal)}<small>大卡</small></span><button data-del="${i}" aria-label="刪除 ${name}">刪除</button></li>`;
    renderDayNav();
    const day = dayEaten();
    $("#eaten").innerHTML = day.length ? day.map((e) => {
      const i = eatenAll.indexOf(e);   // 刪除時用整體清單的位置
      if (e.menu) return row(i, esc(e.name), e.kcal, `${esc(e.shop)}・${e.nsrc === "official" ? "店家標示" : CFG.ESTIMATE_NOTE}，只計熱量與蛋白質`);
      if (e.parts) return row(i, esc(e.meal), kcalOf(e.parts), e.parts.map((p) => `${esc(p.label)} ${p.g} g`).join("、"));
      const f = foodById[e.id];
      return row(i, `${esc(f ? friendly(f).main : e.id)} ${fmt(e.g)} g`, (f?.energy_kcal || 0) * e.g / 100, "");
    }).join("") : `<li class="empty">還沒有紀錄。用「記錄吃了什麼」搜尋食材，或點常用餐點、店家菜單。</li>`;
    $("#eatenCount").textContent = day.length ? `${day.length} 筆` : "";
    $("#eatenHead").firstChild.textContent = `${dayName()}吃了`;
    const T = eatenTotals();
    // 今天的總覽：吃了多少、還可以吃多少
    const ate = T.energy_kcal || 0, left = N.kcal - ate, pGap = N.row.protein_g - (T.protein_g || 0);
    $("#todaySum").innerHTML = `<div class="today-grid">
        <div><p class="today-label">${dayName()}已吃</p><p class="today-kcal"><b>${fmt(ate)}</b><span>／ ${fmt(N.kcal)} 大卡</span></p></div>
        <div class="today-side"><p class="today-label">蛋白質</p><p class="today-p"><b>${fmt(T.protein_g || 0)}</b><span>／ ${fmt(N.row.protein_g)} g</span></p></div>
      </div>
      <div class="today-bar ${left < 0 ? "over" : ""}"><span style="width:${Math.min(100, ate / N.kcal * 100)}%"></span></div>
      <p class="today-left">${left >= 0 ? `還可以吃 <b>${fmt(left)} 大卡</b>` : `已超過 <b>${fmt(-left)} 大卡</b>`}，蛋白質${pGap > 0 ? `還差 <b>${fmt(pGap, 1)} g</b>` : "<b>已達建議量</b>"}</p>`;
    $("#menuNote").hidden = !day.some((e) => e.menu);
    $("#nextWrap").hidden = viewDate !== today();   // 回看過去的日子時不推薦下一餐
    $("#bars").innerHTML = N.targets.map((t) => {
      const got = T[t.key] || 0, pct = t.need ? got / t.need * 100 : 0;
      const over = t.upper && got > t.need;
      const done = !t.upper && got >= t.need;
      const d = t.unit === "mg" && t.need < 50 ? 1 : 0;
      const status = t.upper
        ? (over ? `超過上限 ${fmt(got - t.need)} ${t.unit}` : `離上限還有 ${fmt(t.need - got)} ${t.unit}`)
        : (done ? "已達建議量" : `還差 ${fmt(t.need - got, d)} ${t.unit}`);
      return `<div class="bar-row"><span>${t.label}</span>
        <div class="bar ${over ? "over" : ""}" role="img" aria-label="${t.label} ${fmt(pct)}%"><span style="width:${Math.min(100, pct)}%"></span></div>
        <span class="v">${fmt(got, d)} / ${fmt(t.need)} ${t.unit}<small class="${over ? "is-over" : done ? "is-done" : ""}">${status}</small></span></div>`;
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
    $("#nextMeal").innerHTML = scored.map(({ x, cover }) => itemRow(x, { showShop: true, note: gapP ? `可補今天蛋白質缺口的 ${fmt(cover * 100)}%` : "今天蛋白質已達建議量" })).join("")
      || `<li class="empty">今晚的完整餐盒都訂完了。</li>`;
  }
  $("#profile").addEventListener("input", renderNutrition);
  $("#eaten").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    eatenAll.splice(+b.dataset.del, 1); saveEaten(); renderNutrition();
  });
  // 記錄後的提示附上當天累計熱量：手機上總覽在下方，不用捲動也知道吃了多少
  const todayKcal = () => fmt(eatenTotals().energy_kcal || 0);
  function record(entry, label) {
    eatenAll.push({ ...entry, d: viewDate });
    saveEaten();
    renderNutrition();
    toast(`已記錄 ${label}・${dayName()}共 ${todayKcal()} 大卡`);
  }
  // 會員可以切換日期回看；訪客只有今天
  function renderDayNav() {
    const nav = $("#dayNav");
    nav.hidden = false;
    if (!me) { nav.innerHTML = `<span class="guest-hint">訪客的紀錄隔天會清空。<a href="#account">登入或註冊</a>就能保留每天的紀錄、回看過去的日子。</span>`; return; }
    const shift = (n) => { const d = new Date(`${viewDate}T12:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv"); };
    nav.innerHTML = `<button type="button" data-day="${shift(-1)}" aria-label="前一天">‹</button>
      <span>${+viewDate.slice(5, 7)} 月 ${+viewDate.slice(8)} 日${viewDate === today() ? "（今天）" : ""}</span>
      <button type="button" data-day="${shift(1)}" aria-label="後一天" ${viewDate >= today() ? "disabled" : ""}>›</button>
      ${viewDate === today() ? "" : `<button type="button" class="linklike" data-day="${today()}">回到今天</button>`}`;
  }
  $("#dayNav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]"); if (!b || b.disabled) return;
    viewDate = b.dataset.day; renderNutrition();
  });
  // 常用餐點：點一下記錄一整份
  const kcalOf = (parts) => parts.reduce((t, p) => t + (foodById[p.id]?.energy_kcal || 0) * p.g / 100, 0);
  // 一鍵記錄的品項排成菜單板：品名．．．．熱量 ＋，依時段或店家分組
  // 每列旁邊有收藏星號；收藏的項目另外排在「我的收藏」群組最上面
  const star = (kind, key, name) => { const on = favs[kind].includes(key); return `<button type="button" class="star ${on ? "is-on" : ""}" data-fav="${kind}|${esc(key)}" aria-pressed="${on}" aria-label="${on ? "取消收藏" : "收藏"} ${esc(name)}">${on ? "★" : "☆"}</button>`; };
  const addRow = (attr, name, kcal, tip, fav) => `<li class="add-item"><button class="add-row" ${attr} title="${esc(tip)}"><span class="n">${esc(name)}</span><span class="leader" aria-hidden="true"></span><span class="k">${fmt(kcal)}<small>大卡</small></span><span class="plus" aria-hidden="true">＋</span></button>${fav}</li>`;
  const addGroup = (head, rows, cls = "") => `<div class="add-group ${cls}"><p class="add-group-head">${esc(head)}</p><ul class="add-list">${rows}</ul></div>`;
  const MENU = window.RE_LISTINGS.items.filter((x) => x.kcal != null);
  function renderQuick() {
    const mealRow = (m) => { const i = MEALS.indexOf(m); return addRow(`data-meal="${i}"`, m.name, kcalOf(m.parts), m.parts.map((p) => `${p.label} ${p.g} g`).join("、"), star("meals", m.name, m.name)); };
    const favMeals = MEALS.filter((m) => favs.meals.includes(m.name));
    $("#mealQuick").innerHTML = `<p class="meals-head" id="mealsHead">點一下記錄一整份，營養依食藥署資料計算</p>` +
      (favMeals.length ? addGroup("★ 我的收藏", favMeals.map(mealRow).join(""), "is-fav") : "") +
      [...new Set(MEALS.map((m) => m.type))].map((type) => addGroup(type, MEALS.filter((m) => m.type === type).map(mealRow).join(""))).join("");
    // 店家菜單：地圖上列出的品項，依店家分組
    const menuRow = (x) => addRow(`data-menu="${esc(x.id)}"`, x.name, x.kcal, `蛋白質 ${fmt(x.protein, 1)} g${x.nsrc === "official" ? "" : `，${CFG.ESTIMATE_NOTE}`}`, star("menu", x.id, x.name));
    const favMenu = MENU.filter((x) => favs.menu.includes(x.id));
    $("#menuQuick").innerHTML = `<p class="meals-head" id="menuHead">點一下記錄一份，只計熱量與蛋白質</p>` +
      (favMenu.length ? addGroup("★ 我的收藏", favMenu.map(menuRow).join(""), "is-fav") : "") +
      [...new Set(MENU.map((x) => x.shop))].map((sid) => addGroup(shopById[sid].name, MENU.filter((x) => x.shop === sid).map(menuRow).join(""))).join("") +
      // 完全沒有營養標示的店家無法計算，只說明原因
      [...new Set(window.RE_LISTINGS.items.map((x) => x.shop))].filter((sid) => !MENU.some((x) => x.shop === sid))
        .map((sid) => `<div class="add-group"><p class="add-group-head">${esc(shopById[sid].name)}</p><p class="hint">店家沒有公布營養標示，暫時無法記錄</p></div>`).join("");
  }
  renderQuick();
  $("#menuQuick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]"); if (!b) return;
    const x = MENU.find((m) => m.id === b.dataset.menu);
    record({ menu: x.id, name: x.name, shop: shopById[x.shop].name, kcal: x.kcal, protein: x.protein, nsrc: x.nsrc }, `${x.name}，${fmt(x.kcal)} 大卡`);
  });
  $("#mealQuick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-meal]"); if (!b) return;
    const m = MEALS[+b.dataset.meal];
    record({ meal: m.name, parts: m.parts.map((p) => ({ ...p })) }, `${m.name}，約 ${fmt(kcalOf(m.parts))} 大卡`);
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
      return `<li><button class="result" data-add="${f.id}">
        <span class="r-name"><b>${esc(nm.main)}</b><small>${esc(f.g)}${nm.official ? `・食藥署名稱：${esc(nm.official)}` : ""}</small></span>
        <span class="r-kcal"><span>${fmt(f.energy_kcal)}<small>大卡</small></span><small>每 100 g・蛋白質 ${fmt(f.protein_g ?? 0, 1)} g</small></span>
        <span class="plus" aria-hidden="true">＋</span></button></li>`;
    }).join("")
      || (e.target.value.trim() ? `<li class="hint">資料庫裡找不到「${esc(e.target.value)}」。換個說法或只打食材名稱試試，例如「滷雞腿」改「雞腿」。</li>` : "");
  });
  // 記錄方式分頁：搜尋食材、常用餐點、店家菜單，一次只顯示一種
  $$(".seg [data-pane]").forEach((b) => b.addEventListener("click", () => {
    $$(".seg [data-pane]").forEach((x) => x.setAttribute("aria-selected", x === b));
    $$(".adder .pane").forEach((pn) => { pn.hidden = pn.dataset.pane !== b.dataset.pane; });
  }));
  $(".quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]"); if (!b) return;
    const box = $("#foodSearch");
    box.value = b.dataset.quick; box.dispatchEvent(new Event("input")); box.focus();
  });
  $("#foodResults").addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    const g = Math.max(1, +$("#foodGrams").value || 100);
    $("#foodSearch").value = ""; $("#foodResults").innerHTML = "";
    record({ id: b.dataset.add, g }, `${friendly(foodById[b.dataset.add]).main} ${fmt(g)} g`);
  });

  // ---------- 剩食料理 ----------
  const EQUIP = ["微波爐", "電鍋", "快煮鍋", "免開火"];
  const EQ_KEY = { 微波爐: "mw", 電鍋: "rc", 快煮鍋: "kt", 免開火: "cold" };   // 對應 CSS 的設備顏色
  const INGS = ["白飯", "蛋", "雞胸", "雞腿", "獅子頭", "鮪魚", "豆腐", "番茄", "高麗菜", "青花菜", "小白菜", "地瓜", "南瓜", "燕麥", "麵", "吐司", "鮮奶", "優格", "香蕉", "生菜", "杏鮑菇"];
  const rSel = { equip: new Set(), ing: new Set() };
  $("#equipChips").innerHTML = EQUIP.map((x) => `<button class="chip eq-${EQ_KEY[x]}" data-equip="${x}" aria-pressed="false">${x}</button>`).join("");
  $("#ingChips").innerHTML = INGS.map((x) => `<button class="chip" data-ing="${x}" aria-pressed="false">${x}</button>`).join("");
  function toggle(set, v, btn) { set.has(v) ? set.delete(v) : set.add(v); btn.classList.toggle("is-on"); btn.setAttribute("aria-pressed", set.has(v)); renderRecipes(); }
  $("#equipChips").addEventListener("click", (e) => { const b = e.target.closest("[data-equip]"); if (b) toggle(rSel.equip, b.dataset.equip, b); });
  $("#ingChips").addEventListener("click", (e) => { const b = e.target.closest("[data-ing]"); if (b) toggle(rSel.ing, b.dataset.ing, b); });
  $("#recipeSort").addEventListener("change", renderRecipes);
  const RECIPE_SORT = {
    match: (a, b) => b.match - a.match || a.r.min - b.r.min,
    min: (a, b) => a.r.min - b.r.min || b.match - a.match,
    kcal: (a, b) => a.r.kcal - b.r.kcal,
    protein: (a, b) => b.r.protein - a.r.protein,
  };
  // 卡片只放判斷要不要做的資訊：設備、熱量、蛋白質、時間、食材；做法收在「看做法」裡
  function renderRecipes() {
    const have = (it) => [...rSel.ing].some((k) => it.label.includes(k));
    const favOnly = me && $("#favOnly").checked;
    const list = RECIPES.filter((r) => (!rSel.equip.size || r.equip.some((x) => rSel.equip.has(x))) && (!favOnly || favs.recipes.includes(r.name)))
      .map((r) => ({ r, match: r.items.filter(have).length }))
      .sort(RECIPE_SORT[$("#recipeSort").value]);
    $("#recipeCount").textContent = `${list.length} 道`;
    $("#recipes").innerHTML = list.length ? list.map(({ r, match }) => `<li class="recipe eq-${EQ_KEY[r.equip[0]]}">
      <div class="recipe-top">${r.equip.map((x) => `<span class="equip eq-${EQ_KEY[x]}">${esc(x)}</span>`).join("")}${rSel.ing.size ? `<span class="have-count ${match ? "" : "none"}">你有 ${match}／${r.items.length} 樣</span>` : ""}${star("recipes", r.name, r.name)}</div>
      <h4>${esc(r.name)}</h4>
      <ul class="recipe-ings">${r.items.map((it) => `<li class="${have(it) ? "have" : ""}">${esc(it.label)}<small>${it.g} g</small></li>`).join("")}</ul>
      <dl class="recipe-stats">
        <div><dt>熱量</dt><dd>${fmt(r.kcal)}<small>大卡</small></dd></div>
        <div><dt>蛋白質</dt><dd>${fmt(r.protein, 1)}<small>g</small></dd></div>
        <div><dt>時間</dt><dd>${r.min}<small>分鐘</small></dd></div>
      </dl>
      <details class="recipe-steps"><summary>看做法・${r.steps.length} 步</summary><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>
    </li>`).join("") : `<li class="empty">${favOnly ? "還沒有符合條件的收藏食譜。點食譜右上角的 ☆ 就能收藏。" : "這個設備還沒有食譜。取消一個設備條件看看。"}</li>`;
  }

  $("#favOnly").addEventListener("change", renderRecipes);

  // ---------- 會員：收藏、註冊、登入、帳號頁 ----------
  document.addEventListener("click", (e) => {
    const s = e.target.closest("[data-fav]"); if (!s) return;
    if (!me) { toast("登入會員後才能收藏。"); return; }
    const [kind, key] = s.dataset.fav.split("|");
    const list = favs[kind], i = list.indexOf(key);
    i < 0 ? list.push(key) : list.splice(i, 1);
    saveFavs(); renderQuick(); renderRecipes();
    toast(i < 0 ? "已加入收藏" : "已取消收藏");
  });
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashPw = async (pw, salt) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pw}`)));
  // 登入、登出後重新載入，讓所有分頁都改讀這個帳號的資料；提示訊息留到載入後顯示
  function switchUser(email, msg) {
    email ? store.set("re_session", email) : store.del("re_session");
    try { sessionStorage.setItem("re_flash", msg); } catch { /* 不支援時略過提示 */ }
    location.reload();
  }
  $$("#authBox .seg [data-auth]").forEach((b) => b.addEventListener("click", () => {
    $$("#authBox .seg [data-auth]").forEach((x) => x.setAttribute("aria-selected", x === b));
    $$("#authBox form").forEach((f) => { f.hidden = f.dataset.auth !== b.dataset.auth; });
  }));
  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $(".form-error", f), v = Object.fromEntries(new FormData(f));
    const email = v.email.trim().toLowerCase(), name = v.name.trim();
    err.textContent = !name ? "請輸入暱稱。"
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "Email 格式不正確。"
      : users[email] ? "這個 Email 已經註冊過，請直接登入。"
      : v.password.length < 6 ? "密碼至少要 6 個字元。"
      : v.password !== v.password2 ? "兩次輸入的密碼不一樣。"
      : !crypto.subtle ? "這個瀏覽器無法安全保存密碼，請用 http://127.0.0.1 或 https 網址開啟。" : "";
    if (err.textContent) return;
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    users[email] = { name, email, salt, hash: await hashPw(v.password, salt), created: new Date().toISOString() };
    store.set("re_users", users);
    // 訪客今天的紀錄、預訂、個人資料帶進新帳號
    for (const k of ["eaten", "reservations", "profile"]) { const g = store.get(`re_${k}`, null); if (g) store.set(`re_u:${email}:${k}`, g); }
    switchUser(email, `歡迎，${name}！帳號已建立。`);
  });
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $(".form-error", f), v = Object.fromEntries(new FormData(f));
    const u = users[v.email.trim().toLowerCase()];
    if (!u || !crypto.subtle || (await hashPw(v.password, u.salt)) !== u.hash) { err.textContent = "Email 或密碼不正確。"; return; }
    switchUser(u.email, `歡迎回來，${u.name}！`);
  });
  $("#logoutBtn").addEventListener("click", () => switchUser(null, "已登出。"));
  const WEEKDAY = "日一二三四五六";
  function renderAccount() {
    $("#authBox").hidden = !!me; $("#meBox").hidden = !me; $("#accountLede").hidden = !!me;
    $("#accountGuest").hidden = !!me; $("#accountMember").hidden = !me;
    if (!me) return;
    $("#meName").textContent = me.name; $("#meMail").textContent = me.email;
    // 最近 7 天：每天的熱量，對照每日建議量
    const need = needsFor(readProfile()).kcal;
    const days = [...Array(7)].map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 6 + i);
      const s = d.toLocaleDateString("sv"), list = eatenAll.filter((x) => x.d === s);
      return { s, wd: WEEKDAY[d.getDay()], n: list.length, kcal: eatenTotals(list).energy_kcal || 0 };
    });
    const logged = days.filter((d) => d.n), max = Math.max(need, ...days.map((d) => d.kcal)) * 1.05;
    $("#weekAvg").textContent = logged.length ? `有紀錄的 ${logged.length} 天平均 ${fmt(logged.reduce((t, d) => t + d.kcal, 0) / logged.length)} 大卡` : "";
    $("#weekChart").innerHTML = days.map((d) => `<li><button type="button" data-goto-day="${d.s}">
        <span class="wk-day">${dayName(d.s)}<small>週${d.wd}</small></span>
        <span class="wk-track"><span class="wk-fill ${d.kcal > need ? "over" : ""}" style="width:${d.kcal / max * 100}%"></span><i class="wk-need" style="left:${need / max * 100}%"></i></span>
        <span class="wk-kcal">${d.n ? `${fmt(d.kcal)}<small>大卡</small>` : "<small>沒有紀錄</small>"}</span></button></li>`).join("");
    $("#weekHint").textContent = `直線是你的每日建議量 ${fmt(need)} 大卡。點某一天可以看當天的紀錄。`;
    // 預訂紀錄：新的在上面
    const hist = [...reservationsAll].sort((a, b) => b.at.localeCompare(a.at));
    $("#historyCount").textContent = hist.length ? `${hist.length} 筆` : "";
    $("#historyList").innerHTML = hist.length ? hist.map((r) => {
      const its = r.items || r.itemIds.map((id) => items.find((x) => x.id === id)).filter(Boolean);
      const t = new Date(r.at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `<li><span class="h-date">${dayName(dayOf(r.at))}<small>${t}</small></span>
        <span class="h-items">${[...new Set(its.map((x) => x.shop))].map((sid) => `${esc(shortName(shopById[sid] || { name: sid }))}：${its.filter((x) => x.shop === sid).map((x) => esc(x.name)).join("、")}`).join("；")}</span>
        <span class="h-total">$${its.reduce((s, x) => s + x.deal, 0)}</span><b class="h-code" title="取餐碼">${esc(r.code)}</b></li>`;
    }).join("") : `<li class="empty">還沒有預訂過。到剩食地圖或組一餐預訂惜食。</li>`;
    // 收藏
    const groups = [
      ["常用餐點", MEALS.filter((m) => favs.meals.includes(m.name)).map((m) => m.name), "nutri"],
      ["店家菜單", MENU.filter((x) => favs.menu.includes(x.id)).map((x) => `${shortName(shopById[x.shop])}・${x.name}`), "nutri"],
      ["食譜", RECIPES.filter((r) => favs.recipes.includes(r.name)).map((r) => r.name), "recipe"],
    ];
    const where = (view) => (view === "recipe" ? "剩食料理" : "我的營養");
    $("#favList").innerHTML = groups.map(([h, list, view]) => `<section><h4>${h}<small>${list.length}</small></h4>${list.length
      ? `<ul>${list.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
      : `<p class="hint">還沒有收藏。在${where(view)}點 ☆ 就能收藏。</p>`}<a class="linklike" href="#${view}">前往${where(view)}</a></section>`).join("");
  }
  $("#weekChart").addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto-day]"); if (!b) return;
    viewDate = b.dataset.gotoDay;
    location.hash = "nutri";
  });

  // ---------- 手機 App（PWA）：離線快取與「安裝成 App」 ----------
  function setupApp() {
    const secure = location.protocol === "https:" || ["127.0.0.1", "localhost"].includes(location.hostname);
    if ("serviceWorker" in navigator && secure) navigator.serviceWorker.register("sw.js").catch(() => { /* 不支援時照常當網頁用 */ });
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const btn = $("#installApp");
    if (standalone) return;
    // Android／電腦版 Chrome：瀏覽器判斷可以安裝時才出現按鈕
    let prompt = null;
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); prompt = e; btn.hidden = false; });
    // iPhone 的 Safari 沒有安裝視窗，改成說明怎麼加到主畫面
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios) { btn.hidden = false; btn.textContent = "加到主畫面"; }
    btn.addEventListener("click", async () => {
      if (prompt) { prompt.prompt(); await prompt.userChoice; prompt = null; btn.hidden = true; return; }
      toast("用 Safari 打開本站，按下方「分享」，再選「加入主畫面」。");
    });
    window.addEventListener("appinstalled", () => { btn.hidden = true; toast("已安裝，之後可以從主畫面開啟。"); });
  }

  // ---------- 資料來源 ----------
  function renderData() {
    const s = STATS;
    $("#statGrid").innerHTML = [
      [fmt(s.rawRows), "筆原始營養數值"],
      [fmt(s.kept), `項食材保留（原始 ${fmt(s.rawFoods)} 項）`],
      [fmt(s.droppedCore + s.droppedSparse), "項因數值缺漏過多剔除"],
      [fmt(s.imputedFiber + s.imputedB12), "筆天然不含的缺值補 0（纖維、B12）"],
    ].map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
    const g = Object.entries(s.groups).sort((a, b) => b[1] - a[1]);
    const max = g[0][1];
    $("#groupBars").innerHTML = g.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${v / max * 100}%"></div></div><span class="n">${fmt(v)}</span></div>`).join("");
    $("#topProtein").innerHTML = s.topProtein.map((x) => `<li><span>${esc(x.n)}</span><i class="leader" aria-hidden="true"></i><b>${x.v} g</b></li>`).join("");
  }

  // ---------- 啟動 ----------
  // 各區分開更新：某一區出錯時，其他區和預訂結果照樣顯示，不會要按第二次才出現
  function renderAll() {
    for (const fn of [renderListings, renderCombos, () => $("#view-nutri").classList.contains("is-active") && renderNutrition()]) {
      try { fn(); } catch (err) { console.error(err); }
    }
  }
  async function loadRemote() {
    if (!CFG.APPS_SCRIPT_URL) return;
    try {
      $("#tonight").innerHTML = `<p class="tonight-sub">正在讀取今晚的惜食…</p>`;
      const res = await fetch(`${CFG.APPS_SCRIPT_URL}?action=listings`, { signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      if (!Array.isArray(data.items)) throw new Error("bad data");
      // 店家 id 打錯的品項先略過，不讓一筆錯字弄壞整頁
      items = data.items.filter((x) => shopById[x.shop]);
      $("#demoText").textContent = "品項與份數來自店家試算表，重新整理可看到最新狀況。";
      $("#resetDemo").hidden = true;
    } catch { $("#demoText").textContent = "連不到店家資料，目前顯示示範品項。"; }
  }
  (async function start() {
    await loadRemote();
    applyLocalReservations();
    initMap();
    renderAll();
    renderRecipes();
    renderData();
    $("#accountName").textContent = me ? me.name : "登入";
    setupApp();
    $("#favOnlyWrap").hidden = !me;
    try { const m = sessionStorage.getItem("re_flash"); if (m) { sessionStorage.removeItem("re_flash"); setTimeout(() => toast(m), 300); } } catch { /* 不支援時略過 */ }
    if (viewFromHash() !== "map") showView(viewFromHash());
  })();
})();
