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

  // ---------- 惜食時段：19:00 起才有惜食價、才能預訂 ----------
  // 白天展示時可以切到「示範時間 19:30」，看傍晚的畫面；接上試算表後不提供（後端也會擋）
  let demoClock = !CFG.APPS_SCRIPT_URL && store.get("re_demo_clock", false);
  const DEMO_TIME = "19:30";
  const nowHM = () => (demoClock ? DEMO_TIME : new Date().toTimeString().slice(0, 5));
  const dealFrom = (shopId) => (CFG.DEAL_FROM_SHOP || {})[shopId] || CFG.DEAL_FROM || "19:00";
  const dealOpen = (shopId) => nowHM() >= dealFrom(shopId);
  const anyOpen = () => SHOPS.some((s) => dealOpen(s.id));
  // 「3 小時 12 分」：距離最早開放的店還有多久
  function untilOpenText() {
    const [h, m] = nowHM().split(":").map(Number);
    const first = Math.min(...SHOPS.map((s) => { const [a, b] = dealFrom(s.id).split(":").map(Number); return a * 60 + b; }));
    const left = first - (h * 60 + m);
    return left >= 60 ? `${Math.floor(left / 60)} 小時 ${left % 60} 分` : `${left} 分鐘`;
  }

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
    if (name === "map") renderRewardStrip();
    if (name === "combo") renderCombos();
    if (name === "nutri") renderNutrition();
    if (name === "account") renderAccount();
    if (name === "data") renderData();
    closeCommunity();
    try { history.replaceState(null, "", `#${name}`); } catch { /* 部分瀏覽器的 file:// 不允許 */ }
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  const viewFromHash = () => { const v = location.hash.slice(1); return $(`#view-${CSS.escape(v || "map")}`) ? v || "map" : "map"; };
  const currentView = () => ($(".view.is-active")?.id || "view-map").slice(5);
  // #community 是浮在目前頁面上的惜食圈，不換頁；網址改回目前的頁面，之後還能再點開
  window.addEventListener("hashchange", () => {
    if (location.hash === "#community") { openCommunity(); try { history.replaceState(null, "", `#${currentView()}`); } catch { /* 同上 */ } return; }
    showView(viewFromHash());
  });

  // ---------- 惜食圈面板：右下角按鈕打開，從右側滑出 ----------
  let lastFocus = null;
  function openCommunity() {
    const d = $("#community");
    if (!d.hidden) return;
    lastFocus = document.activeElement;
    renderCommunity();
    store.set(ukey("comm_seen"), new Date().toISOString());   // 打開過就算看過，浮動按鈕的新貼文數歸零
    updateFab();
    d.hidden = false; $("#communityScrim").hidden = false; $("#communityFab").hidden = true;
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => d.classList.add("is-open"));
    $("#communityClose").focus();
  }
  function closeCommunity() {
    const d = $("#community");
    if (d.hidden) return;
    d.classList.remove("is-open");
    d.hidden = true; $("#communityScrim").hidden = true; $("#communityFab").hidden = false;
    document.body.classList.remove("drawer-open");
    lastFocus?.focus?.();
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-community]")) openCommunity();
    // 面板裡連到其他頁面的連結（例如「預訂 1 份惜食」連到剩食地圖），點了就收起面板
    else if (e.target.closest("#community a[href^='#']")) closeCommunity();
  });
  $("#communityClose").addEventListener("click", closeCommunity);
  $("#communityScrim").addEventListener("click", closeCommunity);
  // Esc 關閉；發文視窗開著時先關發文視窗
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#community").hidden && !$("#postDialog").open) closeCommunity(); });

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
    const open = dealOpen(it.shop);
    const shop = shopById[it.shop];
    // 惜食時段前只顯示原價，惜食價寫在下方當預告
    const price = open
      ? `<span class="price" title="惜食價：打烊前的出清價"><s aria-label="原價 ${it.price} 元">$${it.price}</s><b>$${it.deal}</b></span>`
      : `<span class="price is-before" title="現在是原價，${dealFrom(it.shop)} 起才有惜食價"><b aria-label="原價 ${it.price} 元">$${it.price}</b></span>`;
    return `<li class="row ${soldOut ? "is-out" : ""}">
      <div class="row-line">
        <h4>${esc(it.name)}</h4><span class="leader" aria-hidden="true"></span>${price}
      </div>
      <div class="row-sub">
        ${showShop ? `<p class="row-shop"><button class="linklike" data-focus-shop="${esc(it.shop)}">${esc(shop.name)}</button>，步行 ${walkMin(distOf(it.shop))} 分鐘</p>` : ""}
        ${note ? `<p class="row-note">${note}</p>` : ""}
        ${open ? "" : `<p class="row-soon">${dealFrom(it.shop)} 起惜食價 <b>$${it.deal}</b></p>`}
        <p class="row-meta"><span>${esc(it.cat)}</span>${nutriText(it)}${it.micro ? `<span>可微波</span>` : ""}<span class="left ${it.qty <= 1 && !soldOut ? "low" : ""}">${soldOut ? "已訂完" : `剩 ${it.qty} 份`}</span></p>
      </div>
      <div class="row-act">
        ${code ? `<span class="code" title="到店出示取餐碼">取餐碼 <b>${esc(code)}</b></span>`
          : !open && !soldOut ? `<span class="soon" title="${dealFrom(it.shop)} 起開放預訂">${dealFrom(it.shop)}<br>開放</span>`
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
      map.getContainer().classList.toggle("zoom-dot", map.getZoom() < 16);   // 拉遠時只留圓點：正門附近三家店太近，標籤會互相蓋住
    };
    map.on("zoomend", zoomClass); zoomClass();
    // 重新整理後仍畫出今天最後一筆預訂的取餐路線
    if (reservations.length) drawPickup(reservations[reservations.length - 1], { fit: false });
  }
  // 取餐路線：從政大正門依最近鄰順序走過預訂的店家（虛線），並把這幾家店框進畫面
  let pickupLayer = null;
  function drawPickup(rec, { fit = true } = {}) {
    if (!map) return;
    if (pickupLayer) { pickupLayer.remove(); pickupLayer = null; }
    if (!rec) return;
    const shops = [...new Set((rec.items || []).map((x) => x.shop))].filter((id) => shopById[id]);
    if (!shops.length) return;
    const { order } = routeLength(shops);
    const pts = [[GATE.lat, GATE.lng], ...order.map((id) => [shopById[id].lat, shopById[id].lng])];
    pickupLayer = L.polyline(pts, { color: "#1F6B45", weight: 4, opacity: .85, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(map);
    if (fit) map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 18 });
  }
  function shortName(s) { return s.short || s.name.replace(/ 政大店| 給力盒子/g, ""); }
  // 標示「起」價時以完整餐盒為準，避免半顆蛋這類加購品讓價格看起來失真
  function fromLabel(list) {
    const boxes = list.filter((x) => x.cat === "完整餐盒");
    return boxes.length ? `餐盒 $${Math.min(...boxes.map((x) => x.deal))} 起` : `$${Math.min(...list.map((x) => x.deal))} 起`;
  }
  // 今天在這家店預訂的取餐碼
  const codesAt = (shopId) => reservations.filter((r) => (r.items || []).some((x) => x.shop === shopId)).map((r) => r.code);
  function refreshMarkers() {
    if (!map) return;
    for (const s of SHOPS) {
      const live = liveOf(s.id), codes = codesAt(s.id);
      const on = filt.shop === s.id ? " is-on" : "";
      const n = live.reduce((t, x) => t + x.qty, 0);
      const sub = codes.length ? `取餐碼 ${codes.join("、")}`
        : !dealOpen(s.id) ? `${n} 份，${dealFrom(s.id)} 開賣`
        : `${n} 份，${fromLabel(live)}`;
      const html = live.length || codes.length
        ? `<span class="shop-pin live pin-${s.pin || "ne"}${on}${codes.length ? " has-order" : ""}"><span class="lbl"><b>${esc(shortName(s))}</b><span>${esc(sub)}</span></span></span>`
        : `<span class="shop-pin${on}"><span class="dot"></span><span class="lbl"><b>${esc(shortName(s))}</b><span>洽談中</span></span></span>`;
      markers[s.id].setIcon(L.divIcon({ className: "", html, iconSize: null, iconAnchor: [0, 0] }));
      markers[s.id].setZIndexOffset(codes.length ? 2000 : live.length ? 1000 : 0);
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
    const n = live.reduce((t, x) => t + x.qty, 0);
    // 惜食時段前：預告今晚有多少、幾點開始；示範版可以直接切到傍晚
    if (live.length && !anyOpen()) {
      $("#tonight").innerHTML = `<p class="tonight-main">今晚 ${shops.size} 家店預計有 ${n} 份</p>
        <p class="tonight-sub">惜食價 <b>${esc(CFG.DEAL_FROM || "19:00")}</b> 開始，還有 ${untilOpenText()}。現在顯示的是原價。</p>
        ${CFG.APPS_SCRIPT_URL ? "" : `<button type="button" class="demo-time" data-demo-clock="on">示範：直接看 ${DEMO_TIME} 的畫面</button>`}`;
      return;
    }
    // 只有部分店家開始時（GET POWER 較早打烊、提早開始），價格只算已開始的店，其餘註明幾點開始
    const openBoxes = boxes.filter((x) => dealOpen(x.shop));
    const openBest = live.filter((x) => dealOpen(x.shop)).reduce((m, x) => Math.max(m, saveOf(x)), 0);
    const later = [...shops].filter((id) => !dealOpen(id));
    $("#tonight").innerHTML = live.length
      ? `<p class="tonight-main">今晚 ${shops.size} 家店還有 ${n} 份</p>
         <p class="tonight-sub">${openBoxes.length ? `完整餐盒 <b>$${Math.min(...openBoxes.map((x) => x.deal))}</b> 起，` : ""}單份最多省 <b>$${later.length ? openBest : best}</b></p>
         ${later.length ? `<p class="tonight-sub">${later.map((id) => esc(shortName(shopById[id]))).join("、")} ${dealFrom(later[0])} 起才有惜食價</p>` : ""}
         ${demoClock ? `<button type="button" class="demo-time" data-demo-clock="off">示範時間 ${DEMO_TIME}，改回現在時間</button>`
           : later.length && !CFG.APPS_SCRIPT_URL ? `<button type="button" class="demo-time" data-demo-clock="on">示範：直接看 ${DEMO_TIME} 的畫面</button>` : ""}`
      : `<p class="tonight-main">今晚的惜食都訂完了</p><p class="tonight-sub">明天傍晚再來看看。</p>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-demo-clock]"); if (!b) return;
    demoClock = b.dataset.demoClock === "on";
    store.set("re_demo_clock", demoClock);
    renderAll(); refreshMarkers();
    toast(demoClock ? `已切到示範時間 ${DEMO_TIME}，可以預訂惜食。` : "已改回現在時間。");
  });
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
          ${me && its.length ? `<button type="button" class="linklike order-share" data-share-item="${esc(`${its[0].shop}|${its[0].name}`)}">取餐了？開箱分享 +${POINTS.post} 點</button>` : ""}
        </div>
        ${CFG.APPS_SCRIPT_URL ? "" : `<button class="linklike" data-cancel="${i}">取消</button>`}
      </li>`;
    }).join("")}</ul>` : "";
  }
  function renderListings() {
    renderSummary();
    renderRewardStrip();
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
  // 第一次使用的三步驟說明，按「知道了」後不再出現
  $("#howto").hidden = !!store.get("re_seen_howto", false);
  $("#howtoClose").addEventListener("click", () => { $("#howto").hidden = true; store.set("re_seen_howto", true); });
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
    // 預訂時自動記下的飲食一起刪掉
    const n = eatenAll.length;
    eatenAll = eatenAll.filter((e) => e.rsv !== r.at);
    if (eatenAll.length !== n) saveEaten();
    drawPickup(reservations[reservations.length - 1] || null, { fit: false });
    renderAll();
    toast(eatenAll.length !== n ? "已取消預訂，份數已放回，飲食紀錄也一併刪除。" : "已取消預訂，份數已放回。");
  }
  // 重設示範資料：清掉訪客資料並登出；已註冊的示範帳號與其紀錄保留
  $("#resetDemo").addEventListener("click", () => {
    ["re_reservations", "re_eaten", "re_profile", "re_favs", "re_session", "re_seen_howto", "re_demo_clock"].forEach(store.del);
    location.reload();
  });

  // ---------- 預訂 ----------
  const dlg = $("#reserveDialog");
  let pendingIds = [];
  function openReserve(ids) {
    const its = ids.map((id) => items.find((x) => x.id === id));
    const closed = its.find((x) => !dealOpen(x.shop));
    if (closed) { toast(`${shortName(shopById[closed.shop])} ${dealFrom(closed.shop)} 起才開放預訂。`); return; }
    pendingIds = ids;
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
        if (!data.ok) { toast(/開放/.test(data.error || "") ? data.error : "有品項剛被訂走了，請重新整理後再試一次。"); return; }
      } catch { toast("預訂沒有送出，請檢查網路後再試一次。"); return; }
    }
    pendingIds.forEach((id) => { const it = items.find((x) => x.id === id); it.qty = Math.max(0, it.qty - 1); });
    // 存下當時的品名與價格，日後品項下架了，預訂紀錄還看得懂
    const snap = pendingIds.map((id) => {
      const it = items.find((x) => x.id === id);
      return { id, name: it.name, shop: it.shop, deal: it.deal, price: it.price, kcal: it.kcal, protein: it.protein, nsrc: it.nsrc };
    });
    const rec = { code, itemIds: pendingIds, at: new Date().toISOString(), items: snap };
    reservations.push(rec); reservationsAll.push(rec);
    saveReservations();
    // 預訂的品項自動記進今天的飲食；有標示或估算營養的才記，取消預訂時一起刪除
    const logged = snap.filter((x) => x.kcal != null);
    for (const x of logged) eatenAll.push({ menu: x.id, name: x.name, shop: shopById[x.shop].name, kcal: x.kcal, protein: x.protein, nsrc: x.nsrc, d: today(), rsv: rec.at, rcode: code });
    if (logged.length) saveEaten();
    const kcal = logged.reduce((t, x) => t + x.kcal, 0), prot = logged.reduce((t, x) => t + (x.protein || 0), 0);
    const unlocked = newBadges();
    renderAll();
    // 預訂完直接到剩食地圖：畫出取餐路線、我的預訂排在最上面
    if (!$("#view-map").classList.contains("is-active")) showView("map");
    drawPickup(rec);
    $(".panel").scrollTo({ top: 0 });
    $("#dlgTitle").textContent = "已預訂";
    $("#dlgBody").innerHTML = `<p>到店出示取餐碼：</p><p class="pickup-code">${code}</p>
      <ul class="done-list">
        ${logged.length ? `<li>已記入今天的飲食：<b>${fmt(kcal)} 大卡</b>，蛋白質 ${fmt(prot, 1)} g${logged.length < snap.length ? `（${snap.length - logged.length} 樣店家未標示營養，沒有記入）` : ""}</li>` : ""}
        <li>地圖上的虛線是取餐路線${new Set(snap.map((x) => x.shop)).size > 1 ? `，依序到 ${routeLength(snap.map((x) => x.shop)).order.map((id) => esc(shortName(shopById[id]))).join(" → ")}` : ""}</li>
        <li>${me ? `惜食點數 <b>+${POINTS.rescue * snap.length}</b>，累計 ${fmt(myStats().points)} 點` : `<a href="#account">登入會員</a>就能累積惜食點數、解鎖徽章`}</li>
        ${unlocked.map((b) => `<li class="badge-new">解鎖徽章：<b>${esc(b.name)}</b></li>`).join("")}
        ${me ? `<li>取餐後到「我的預訂」按「開箱分享」，再得 +${POINTS.post} 點</li>` : ""}
      </ul>
      ${CFG.APPS_SCRIPT_URL ? "" : `<p class="hint">示範模式：預訂只存在這台裝置，可以在剩食地圖的「我的預訂」取消。</p>`}`;
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
      // 有任何一家還沒到惜食時段：價格當預告，按鈕寫幾點開放
      const later = c.route.order.filter((id) => !dealOpen(id));
      const opensAt = later.map(dealFrom).sort().pop();
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
        <div class="combo-total"><span>${later.length ? `合計<small>${opensAt} 起的惜食價</small>` : "合計"}</span><s aria-label="原價 ${orig} 元">$${orig}</s><b>$${c.total}</b></div>
        <p class="meta">約 ${fmt(kcal)} 大卡，蛋白質 ${fmt(prot, 1)} g${parts.every((x) => !x.fried) ? "，非油炸" : ""}。${est ? `營養含${CFG.ESTIMATE_NOTE}。` : ""}${unknown ? "部分品項店家未標示營養，只計有標示的品項。" : ""}<br>取餐路線：${shops.map(esc).join("、")}，從正門走約 ${distLabel(c.route.total)}。<br>預訂後自動記入「我的營養」，並在地圖上畫出取餐路線。</p>
        <div class="combo-act">
          ${later.length ? `<button class="btn" disabled>${opensAt} 開放預訂</button>` : `<button class="btn" data-reserve-combo="${parts.map((x) => x.id).join(",")}">預訂這組</button>`}
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
      if (e.menu) return row(i, esc(e.name), e.kcal, `${e.rsv ? `<span class="from-rsv">預訂自動記錄・取餐碼 ${esc(e.rcode)}</span>・` : ""}${esc(e.shop)}・${e.nsrc === "official" ? "店家標示" : CFG.ESTIMATE_NOTE}，只計熱量與蛋白質`);
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
    // 手機的固定小橫條：記錄時也看得到累計熱量
    $("#nutriPeek").innerHTML = `<span class="peek-text">${dayName()} <b>${fmt(ate)}</b>／${fmt(N.kcal)} 大卡</span>
      <span class="peek-bar ${left < 0 ? "over" : ""}"><i style="width:${Math.min(100, ate / N.kcal * 100)}%"></i></span><span class="peek-go">看結果 ↓</span>`;
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
    const unlocked = newBadges();
    toast(`已記錄 ${label}・${dayName()}共 ${todayKcal()} 大卡${unlocked.length ? `・解鎖徽章「${unlocked.map((b) => b.name).join("、")}」` : ""}`);
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
  $("#nutriPeek").addEventListener("click", () => $("#todaySum").scrollIntoView({ behavior: "smooth", block: "start" }));
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
  function toggle(set, v, btn) {
    set.has(v) ? set.delete(v) : set.add(v); btn.classList.toggle("is-on"); btn.setAttribute("aria-pressed", set.has(v));
    const n = rSel.equip.size + rSel.ing.size;
    $("#filterSum").textContent = n ? `已選 ${[...rSel.equip, ...rSel.ing].join("、")}` : "設備、手邊食材";
    renderRecipes();
  }
  // 手機與平板：篩選先收起來，打開頁面先看到食譜
  if (matchMedia("(max-width: 1000px)").matches) $("#filterBox").open = false;
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
    $("#recipes").innerHTML = list.length ? list.map(({ r, match }) => `<li class="recipe eq-${EQ_KEY[r.equip[0]]}" data-recipe="${esc(r.name)}">
      <div class="recipe-top">${r.equip.map((x) => `<span class="equip eq-${EQ_KEY[x]}">${esc(x)}</span>`).join("")}${rSel.ing.size ? `<span class="have-count ${match ? "" : "none"}">你有 ${match}／${r.items.length} 樣</span>` : ""}${star("recipes", r.name, r.name)}</div>
      <h4>${esc(r.name)}</h4>
      <ul class="recipe-ings">${r.items.map((it) => `<li class="${have(it) ? "have" : ""}">${esc(it.label)}<small>${it.g} g</small></li>`).join("")}</ul>
      <dl class="recipe-stats">
        <div><dt>熱量</dt><dd>${fmt(r.kcal)}<small>大卡</small></dd></div>
        <div><dt>蛋白質</dt><dd>${fmt(r.protein, 1)}<small>g</small></dd></div>
        <div><dt>時間</dt><dd>${r.min}<small>分鐘</small></dd></div>
      </dl>
      <details class="recipe-steps"><summary>看做法・${r.steps.length} 步</summary><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        <button type="button" class="linklike made-it" data-share-recipe="${esc(r.name)}">我做了這道，分享到惜食圈（+${POINTS.post} 點）</button></details>
    </li>`).join("") : `<li class="empty">${favOnly ? "還沒有符合條件的收藏食譜。點食譜右上角的 ☆ 就能收藏。" : "這個設備還沒有食譜。取消一個設備條件看看。"}</li>`;
  }

  $("#favOnly").addEventListener("change", renderRecipes);

  // ---------- 回饋：惜食點數、等級、徽章 ----------
  // 全部由紀錄推算、不另外存分數：取消預訂或刪除貼文，點數自然跟著變
  const POINTS = { rescue: 10, post: 5, logDay: 2 };
  const LEVELS = [[0, "惜食新手"], [50, "惜食學徒"], [150, "惜食達人"], [300, "惜食英雄"], [600, "惜食傳奇"]];
  const KG_PER_MEAL = 0.35, CO2_PER_KG = 2.5;   // 與「社會影響力」報告相同的假設：每份約 0.35 kg、每公斤食物浪費約 2.5 kg CO₂e
  // 連續記錄天數：今天還沒記不算中斷，從昨天往回數
  function streakOf(days) {
    const d = new Date(); let n = 0;
    if (!days.has(d.toLocaleDateString("sv"))) d.setDate(d.getDate() - 1);
    while (days.has(d.toLocaleDateString("sv"))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function myStats() {
    const rItems = reservationsAll.flatMap((r) => r.items || r.itemIds.map((id) => items.find((x) => x.id === id)).filter(Boolean));
    // 舊的預訂紀錄沒存原價，用菜單補
    const priceOf = (x) => x.price ?? window.RE_LISTINGS.items.find((y) => y.name === x.name && y.shop === x.shop)?.price ?? x.deal;
    const days = new Set(eatenAll.map((e) => e.d));
    const needP = needsFor(readProfile()).row.protein_g;
    const rescued = rItems.length, nPosts = me ? posts.filter((p) => p.by === me.email).length : 0;
    return {
      rescued, posts: nPosts, logDays: days.size, streak: streakOf(days),
      saved: rItems.reduce((t, x) => t + priceOf(x) - x.deal, 0),
      kg: rescued * KG_PER_MEAL, co2: rescued * KG_PER_MEAL * CO2_PER_KG,
      multiShop: reservationsAll.some((r) => new Set((r.items || []).map((x) => x.shop)).size > 1),
      proteinDays: [...days].filter((d) => (eatenTotals(eatenAll.filter((e) => e.d === d)).protein_g || 0) >= needP).length,
      points: rescued * POINTS.rescue + nPosts * POINTS.post + days.size * POINTS.logDay,
    };
  }
  const BADGES = [
    { id: "first", mark: "1", name: "第一份惜食", how: "預訂 1 份惜食", ok: (s) => s.rescued >= 1 },
    { id: "multi", mark: "跨", name: "跨店組餐", how: "一次預訂兩家店以上的組合", ok: (s) => s.multiShop },
    { id: "ten", mark: "10", name: "救下 10 份", how: "累計預訂 10 份惜食", ok: (s) => s.rescued >= 10 },
    { id: "co2", mark: "碳", name: "減碳 10 公斤", how: "累計減少約 10 kg CO₂e（約 12 份惜食）", ok: (s) => s.co2 >= 10 },
    { id: "streak3", mark: "3", name: "連續記錄 3 天", how: "連續 3 天記錄飲食", ok: (s) => s.streak >= 3 },
    { id: "streak7", mark: "7", name: "連續記錄 7 天", how: "連續 7 天記錄飲食", ok: (s) => s.streak >= 7 },
    { id: "protein", mark: "蛋", name: "蛋白質達標", how: "有一天蛋白質達到建議量", ok: (s) => s.proteinDays >= 1 },
    { id: "share", mark: "享", name: "第一次分享", how: "在惜食圈發一篇貼文", ok: (s) => s.posts >= 1 },
  ];
  const levelOf = (p) => { let i = LEVELS.length - 1; while (p < LEVELS[i][0]) i--; return { name: LEVELS[i][1], at: LEVELS[i][0], next: LEVELS[i + 1] }; };
  const updateAccountBtn = () => { $("#accountName").textContent = me ? `${me.name}・${fmt(myStats().points)} 點` : "登入"; };
  // 新解鎖的徽章：只有會員會累積，每個只提示一次
  function newBadges() {
    if (!me) return [];
    const seen = store.get(ukey("badges"), []);
    const fresh = BADGES.filter((b) => b.ok(myStats()) && !seen.includes(b.id));
    if (fresh.length) store.set(ukey("badges"), [...seen, ...fresh.map((b) => b.id)]);
    updateAccountBtn();
    return fresh;
  }
  function renderAchievements() {
    const s = myStats(), lv = levelOf(s.points);
    const pct = lv.next ? (s.points - lv.at) / (lv.next[0] - lv.at) * 100 : 100;
    $("#achBox").innerHTML = `<div class="ach-level">
        <p class="ach-name">${esc(lv.name)}</p>
        <p class="ach-pts"><b>${fmt(s.points)}</b><span>惜食點數</span></p>
        <div class="ach-bar"><span style="width:${pct}%"></span></div>
        <p class="hint">${lv.next ? `再 ${fmt(lv.next[0] - s.points)} 點升到「${lv.next[1]}」` : "已經是最高等級"}・預訂 1 份 +${POINTS.rescue}、發文 +${POINTS.post}、有記錄飲食的每一天 +${POINTS.logDay}</p>
      </div>
      <dl class="ach-impact">
        <div><dt>救下的餐點</dt><dd>${fmt(s.rescued)}<small>份</small></dd></div>
        <div><dt>省下</dt><dd>$${fmt(s.saved)}</dd></div>
        <div><dt>少丟的食物</dt><dd>${fmt(s.kg, 1)}<small>kg</small></dd></div>
        <div><dt>減少碳排</dt><dd>${fmt(s.co2, 1)}<small>kg CO₂e</small></dd></div>
        <div><dt>連續記錄</dt><dd>${fmt(s.streak)}<small>天</small></dd></div>
      </dl>
      <p class="hint">食物重量與碳排是估算：每份約 ${KG_PER_MEAL} kg、每公斤食物浪費約 ${CO2_PER_KG} kg CO₂e（FAO）。正式上線後，點數預計可以和合作店家兌換優惠（洽談中）。</p>`;
    const got = BADGES.filter((b) => b.ok(s));
    $("#badgeCount").textContent = `${got.length}／${BADGES.length}`;
    $("#badgeList").innerHTML = BADGES.map((b) => { const on = b.ok(s); return `<li class="${on ? "is-on" : ""}">
      <span class="badge-mark" aria-hidden="true">${esc(b.mark)}</span><b>${esc(b.name)}</b><small>${on ? "已解鎖" : esc(b.how)}</small></li>`; }).join("");
  }

  // ---------- 惜食圈（示範版：貼文存在這台瀏覽器，換裝置看不到；正式版要接後端） ----------
  const KIND = { cook: "剩食料理", unbox: "惜食開箱", tip: "省錢撇步" };
  const ago = (iso) => { const m = (Date.now() - new Date(iso)) / 60000; return m < 1 ? "剛剛" : m < 60 ? `${Math.floor(m)} 分鐘前` : m < 1440 ? `${Math.floor(m / 60)} 小時前` : `${Math.floor(m / 1440)} 天前`; };
  // 示範貼文：時間以第一次打開為準往回推，讓動態看起來是最近的
  function seedPosts() {
    const t = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const likes = (n) => [...Array(n)].map((_, i) => `demo${i}`);
    return [
      { id: "s1", demo: true, name: "小安・資管二", kind: "cook", recipe: "微波雞腿高麗菜炒飯", at: t(2), likes: likes(12),
        text: "昨晚在雞肉本家拿的雞肉一份吃不完，今天加剩白飯和高麗菜微波 4 分鐘，變成炒飯！宿舍只有微波爐也做得出來。" },
      { id: "s2", demo: true, name: "阿哲", kind: "unbox", item: { id: "chickenhome-26", name: "好吃雞肉飯", shop: "chickenhome" }, rate: 5, at: t(5), likes: likes(8),
        text: "8 點去拿還是熱的，配菜有高麗菜、油豆腐、半顆滷蛋，$100 很夠吃。" },
      { id: "s3", demo: true, name: "宿舍 302", kind: "tip", at: t(20), likes: likes(15),
        text: "組一餐選 $80 也組得出來：楽坡加購雞胸＋加購蔬菜＋蛋白盒子的黑米飯，三樣不到 $80，蛋白質快 20 g。" },
      { id: "s4", demo: true, name: "Mina", kind: "cook", recipe: "電鍋番茄豆腐雞湯", at: t(27), likes: likes(6),
        text: "蛋白盒子的雞胸放冰箱一天，丟進電鍋跟番茄豆腐一起煮，外鍋一杯水，很適合期中考週。" },
      { id: "s5", demo: true, name: "Ken・企管三", kind: "unbox", item: { id: "getpower-12", name: "椒鹽水煮雞胸餐盒", shop: "getpower" }, rate: 4, at: t(49), likes: likes(4),
        text: "GET POWER 比較早打烊，5 點半就開始惜食價。雞胸很嫩，飯有點少，男生可能要再加一份主食。" },
    ];
  }
  let posts = store.get("re_posts", null);
  if (!Array.isArray(posts)) { posts = seedPosts(); store.set("re_posts", posts); }
  // 照片佔空間，存不下時要讓使用者知道，所以不用 store.set 的靜默失敗
  const savePosts = () => { try { localStorage.setItem("re_posts", JSON.stringify(posts)); return true; } catch { return false; } };
  const SEED_RANK = [["小安・資管二", 186], ["宿舍 302", 142], ["阿哲", 97], ["Mina", 64], ["Ken・企管三", 38]];
  let feedKind = "all", postKind = "cook", postRate = 0, postImg = "";

  // 浮動按鈕：上次打開惜食圈之後，別人發了幾篇（第一次來就是全部）
  function updateFab() {
    const seen = store.get(ukey("comm_seen"), "");
    const n = posts.filter((p) => p.at > seen && !(me && p.by === me.email)).length;
    $("#fabBadge").hidden = !n;
    $("#fabBadge").textContent = n > 9 ? "9+" : n;
    $("#fabNote").textContent = n ? `${n} 則新分享` : "看大家今晚吃什麼";
    $("#fabNote").classList.toggle("is-new", !!n);
    $("#communityFab").setAttribute("aria-label", `打開惜食圈${n ? `，有 ${n} 則新分享` : ""}`);
  }
  updateFab();
  // 大頭貼依名字固定配一個顏色，同一個人每次都一樣
  const avatarHue = (name) => [...name].reduce((t, c) => t + c.codePointAt(0), 0) % 4;
  const avatar = (name) => `<span class="avatar av-${avatarHue(name)}" aria-hidden="true">${esc([...name][0])}</span>`;
  const heart = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"${on ? ' class="fill"' : ""}/></svg>`;
  function postCard(p) {
    const mine = me && p.by === me.email, liked = me && p.likes.includes(me.email);
    let att = "", act = "";
    const r = p.recipe && RECIPES.find((x) => x.name === p.recipe);
    // 附上的食譜：左邊用設備顏色標示，整塊可以點去看做法
    if (r) {
      att = `<button type="button" class="post-att att-recipe eq-${EQ_KEY[r.equip[0]]}" data-goto-recipe="${esc(r.name)}">
        <span class="att-body"><span class="equip eq-${EQ_KEY[r.equip[0]]}">${esc(r.equip[0])}</span><b>${esc(r.name)}</b>
        <small>${fmt(r.kcal)} 大卡・蛋白質 ${fmt(r.protein, 1)} g・${r.min} 分鐘</small></span><span class="att-go">看做法 ›</span></button>`;
      act = `<button type="button" class="post-act" data-share-recipe="${esc(r.name)}">我也做了</button>`;
    }
    // 開箱的品項：店家、惜食價、星等；今晚還有就能直接去預訂
    if (p.item) {
      const s = shopById[p.item.shop], live = items.find((x) => x.id === p.item.id && x.qty > 0);
      const ref = live || window.RE_LISTINGS.items.find((x) => x.id === p.item.id);
      att = `<div class="post-att att-item"><span class="att-body"><b>${esc(p.item.name)}</b>
        <small>${esc(s ? s.name : p.item.shop)}${ref ? `・惜食價 $${ref.deal}` : ""}</small>
        ${p.rate ? `<span class="stars" aria-label="推薦 ${p.rate} 顆星">${"★".repeat(p.rate)}<i>${"★".repeat(5 - p.rate)}</i></span>` : ""}</span>
        ${live ? `<span class="att-left">今晚剩 ${live.qty} 份</span>` : ""}</div>`;
      if (live) act = `<button type="button" class="post-act" data-focus-shop="${esc(p.item.shop)}">去地圖看這家店</button>`;
    }
    return `<li class="post k-${p.kind}">
      <header class="post-head">${avatar(p.name)}
        <div class="who"><b>${esc(p.name)}</b><small>${ago(p.at)}${p.demo ? "・示範貼文" : ""}</small></div>
        <span class="kind-tag">${KIND[p.kind]}</span>
        ${mine ? `<button type="button" class="post-del" data-del-post="${esc(p.id)}" aria-label="刪除這篇貼文">刪除</button>` : ""}</header>
      ${p.img ? `<img class="post-img" src="${p.img}" alt="${esc(p.name)} 分享的照片" loading="lazy">` : ""}
      ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ""}
      ${att}
      <footer class="post-actions">
        <button type="button" class="like ${liked ? "is-on" : ""}" data-like="${esc(p.id)}" aria-pressed="${!!liked}" aria-label="${liked ? "收回讚" : "按讚"}，目前 ${p.likes.length} 個讚">${heart(liked)}<span>${p.likes.length}</span></button>
        ${act}
      </footer>
    </li>`;
  }
  function renderCommunity() {
    const list = posts.filter((p) => feedKind === "all" || p.kind === feedKind).sort((a, b) => b.at.localeCompare(a.at));
    // 分類標籤旁顯示篇數
    $$("#feedTabs [data-feed]").forEach((b) => { $("small", b).textContent = posts.filter((p) => b.dataset.feed === "all" || p.kind === b.dataset.feed).length; });
    $("#feed").innerHTML = list.map(postCard).join("")
      || `<li class="empty feed-empty"><b>這個分類還沒有貼文</b><span>成為第一個分享的人吧。</span><button type="button" class="btn" data-new-post="${feedKind}">分享${KIND[feedKind] || ""}</button></li>`;
    $("#shareAvatar").outerHTML = me ? avatar(me.name).replace('class="avatar', 'id="shareAvatar" class="avatar') : `<span class="avatar av-guest" id="shareAvatar" aria-hidden="true">你</span>`;
    renderReward();
    // 排行：示範同學＋自己（會員）；前三名用獎牌色
    const rows = SEED_RANK.map(([name, pts]) => ({ name, pts }));
    if (me) rows.push({ name: me.name, pts: myStats().points, me: true });
    rows.sort((a, b) => b.pts - a.pts);
    $("#rankList").innerHTML = rows.map((r, i) => `<li class="${r.me ? "is-me" : ""} ${i < 3 ? `top top-${i + 1}` : ""}">
      <span class="n">${i + 1}</span>${avatar(r.name)}<span class="rk-name">${esc(r.name)}${r.me ? "<small>你</small>" : ""}</span><b>${fmt(r.pts)}<small>點</small></b></li>`).join("");
  }
  // 點數怎麼來：三種方式各連到做那件事的地方
  const EARN = [["map", "預訂 1 份惜食", POINTS.rescue], ["nutri", "記錄今天的飲食", POINTS.logDay], ["share", "在惜食圈分享", POINTS.post]];
  const earnList = () => `<ul class="earn">${EARN.map(([to, label, pts]) => `<li>${to === "share"
    ? `<button type="button" class="linklike" data-new-post>${label}</button>` : `<a href="#${to}">${label}</a>`}<i class="leader" aria-hidden="true"></i><b>+${pts}</b></li>`).join("")}</ul>`;
  // 惜食圈最上方的點數卡：平常收成一行（點數、等級、進度條），點開才看怎麼拿點數與下一個徽章
  function renderReward() {
    const wasOpen = $("#myReward details")?.open;
    if (!me) {
      $("#myReward").innerHTML = `<details class="reward"${wasOpen ? " open" : ""}>
        <summary><span class="reward-head">惜食點數</span><span class="reward-sum">預訂、記錄、分享都能拿點數</span><span class="reward-more">怎麼拿</span></summary>
        ${earnList()}<a class="btn" href="#account">登入或註冊，開始累積</a></details>`;
      return;
    }
    const s = myStats(), lv = levelOf(s.points), next = BADGES.find((b) => !b.ok(s));
    const pct = lv.next ? (s.points - lv.at) / (lv.next[0] - lv.at) * 100 : 100;
    $("#myReward").innerHTML = `<details class="reward"${wasOpen ? " open" : ""}>
      <summary><span class="reward-head">${esc(lv.name)}</span><span class="reward-sum"><b>${fmt(s.points)}</b> 點</span><span class="reward-more">詳情</span>
        <span class="ach-bar"><span style="width:${pct}%"></span></span></summary>
      <p class="reward-next">${lv.next ? `再 ${fmt(lv.next[0] - s.points)} 點升到「${lv.next[1]}」` : "已經是最高等級"}</p>
      ${earnList()}
      ${next ? `<p class="reward-badge"><span class="badge-mark" aria-hidden="true">${esc(next.mark)}</span><span>下一個徽章<b>${esc(next.name)}</b><small>${esc(next.how)}</small></span></p>` : ""}
      <a class="linklike" href="#account">看全部徽章與我的成果（${BADGES.filter((b) => b.ok(s)).length}／${BADGES.length}）</a></details>`;
  }
  // 剩食地圖上方的一行：會員看自己的成果，訪客知道有點數可以拿
  function renderRewardStrip() {
    const s = me && myStats();
    $("#rewardStrip").innerHTML = me
      ? `<b>${esc(levelOf(s.points).name)}・${fmt(s.points)} 點</b><span>已救下 ${fmt(s.rescued)} 份，省 $${fmt(s.saved)}</span><i>看點數 ›</i>`
      : `<b>惜食點數</b><span>預訂 1 份 +${POINTS.rescue} 點，可升級、解鎖徽章</span><i>怎麼拿 ›</i>`;
  }
  // 發文視窗：可以先帶好類型、食譜或開箱的品項，使用者只要補一句話或一張照片
  function openComposer(kind = "cook", { recipe = "", item = "" } = {}) {
    if (!me) { toast("登入會員後就能分享，發文可得惜食點數。"); location.hash = "account"; return; }
    // 開箱只能選自己預訂過的惜食
    const seen = new Set(), mineItems = [];
    for (const r of [...reservationsAll].reverse()) for (const x of r.items || []) {
      const k = `${x.shop}|${x.name}`; if (!seen.has(k)) { seen.add(k); mineItems.push(x); }
    }
    $("#postItem").innerHTML = mineItems.length
      ? mineItems.map((x, i) => `<option value="${i}">${esc(shortName(shopById[x.shop] || { name: x.shop }))}・${esc(x.name)}</option>`).join("")
      : `<option value="">還沒有預訂過的惜食</option>`;
    $("#postItem").dataset.items = JSON.stringify(mineItems.map((x) => ({ id: x.id || "", name: x.name, shop: x.shop })));
    setPostKind(kind);
    $("#postRecipe").value = recipe;
    const i = mineItems.findIndex((x) => `${x.shop}|${x.name}` === item);
    if (i >= 0) $("#postItem").value = i;
    $("#composer .form-error").textContent = "";
    countText();      // 取消後再打開，上次沒發的草稿還在
    $("#postDialog").showModal();
    $("#postText").focus();
  }
  $("#postCancel").addEventListener("click", () => $("#postDialog").close());
  $("#postDialog").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });   // 點背景關閉
  $("#newPost").addEventListener("click", () => openComposer(feedKind === "all" ? "cook" : feedKind));
  document.addEventListener("click", (e) => {
    const np = e.target.closest("[data-new-post]");
    if (np) openComposer(KIND[np.dataset.newPost] ? np.dataset.newPost : "cook");
    const sr = e.target.closest("[data-share-recipe]");
    if (sr) openComposer("cook", { recipe: sr.dataset.shareRecipe });
    const si = e.target.closest("[data-share-item]");
    if (si) openComposer("unbox", { item: si.dataset.shareItem });
  });
  $("#postRecipe").innerHTML = `<option value="">不指定</option>` + RECIPES.map((r) => `<option>${esc(r.name)}</option>`).join("");
  $$("#feedTabs [data-feed]").forEach((b) => b.addEventListener("click", () => {
    $$("#feedTabs [data-feed]").forEach((x) => x.setAttribute("aria-selected", x === b));
    feedKind = b.dataset.feed; renderCommunity();
  }));
  function setPostKind(k) {
    postKind = k;
    $$("#composer [data-kind]").forEach((x) => x.setAttribute("aria-selected", x.dataset.kind === k));
    $$("#composer [data-for]").forEach((x) => { x.hidden = x.dataset.for !== k; });
    $("#postText").placeholder = { cook: "用剩食做了什麼？用了哪些設備？", unbox: "份量、味道、取餐時的狀況如何？", tip: "分享省錢或吃得均衡的小方法" }[k];
  }
  $$("#composer [data-kind]").forEach((b) => b.addEventListener("click", () => setPostKind(b.dataset.kind)));
  const countText = () => { $("#postCount").textContent = `${[...$("#postText").value].length}／200`; };
  $("#postText").addEventListener("input", countText);
  $("#rateStars").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rate]"); if (!b) return;
    postRate = +b.dataset.rate;
    $$("#rateStars [data-rate]").forEach((x) => x.classList.toggle("is-on", +x.dataset.rate <= postRate));
  });
  // 照片縮到長邊 900 px 再存，避免塞爆瀏覽器空間
  function shrinkPhoto(file) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 900 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        ok(c.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = fail;
      img.src = URL.createObjectURL(file);
    });
  }
  $("#postPhoto").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { postImg = await shrinkPhoto(f); } catch { postImg = ""; toast("這個檔案無法讀取，請換一張照片。"); }
    $("#photoPreview").src = postImg; $("#photoPreview").hidden = !postImg; $("#photoPick").classList.toggle("has-img", !!postImg);
  });
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const err = $("#composer .form-error"), text = $("#postText").value.trim();
    const pick = JSON.parse($("#postItem").dataset.items || "[]")[+$("#postItem").value];
    err.textContent = !text && !postImg ? "寫一點內容或放一張照片。"
      : postKind === "unbox" && !pick ? "先預訂一份惜食，取餐後再來開箱。"
      : postKind === "unbox" && !postRate ? "幫這份惜食打個分數。" : "";
    if (err.textContent) return;
    const p = { id: Date.now().toString(36), by: me.email, name: me.name, kind: postKind, text, img: postImg, at: new Date().toISOString(), likes: [] };
    if (postKind === "cook" && $("#postRecipe").value) p.recipe = $("#postRecipe").value;
    if (postKind === "unbox") { p.item = pick; p.rate = postRate; }
    posts.push(p);
    if (!savePosts()) { posts.pop(); err.textContent = "這台裝置的儲存空間不夠，換一張小一點的照片，或刪掉舊貼文再試。"; return; }
    e.target.reset(); postImg = ""; postRate = 0; countText();
    $("#photoPreview").hidden = true; $("#photoPick").classList.remove("has-img");
    $$("#rateStars [data-rate]").forEach((x) => x.classList.remove("is-on"));
    const unlocked = newBadges();
    $("#postDialog").close();
    // 發完帶到惜食圈，貼文排在最上面
    feedKind = "all"; $$("#feedTabs [data-feed]").forEach((x) => x.setAttribute("aria-selected", x.dataset.feed === "all"));
    if ($("#community").hidden) openCommunity(); else renderCommunity();
    $("#communityBody").scrollTo({ top: 0 });
    if ($("#view-account").classList.contains("is-active")) renderAccount();
    renderRewardStrip();
    toast(`已發佈・惜食點數 +${POINTS.post}${unlocked.length ? `・解鎖徽章「${unlocked.map((b) => b.name).join("、")}」` : ""}`);
  });
  document.addEventListener("click", (e) => {
    const lk = e.target.closest("[data-like]");
    if (lk) {
      if (!me) { toast("登入會員後才能按讚。"); return; }
      const p = posts.find((x) => x.id === lk.dataset.like), i = p.likes.indexOf(me.email);
      i < 0 ? p.likes.push(me.email) : p.likes.splice(i, 1);
      savePosts(); renderCommunity();
    }
    const dp = e.target.closest("[data-del-post]");
    if (dp && confirm("刪除這篇貼文？")) {
      posts = posts.filter((x) => x.id !== dp.dataset.delPost);
      savePosts(); updateAccountBtn(); renderCommunity();
    }
    const gr = e.target.closest("[data-goto-recipe]");
    if (gr) {
      // 清掉篩選，確定這道食譜會出現在清單裡
      rSel.equip.clear(); rSel.ing.clear(); $("#favOnly").checked = false;
      $$("#equipChips .chip, #ingChips .chip").forEach((c) => { c.classList.remove("is-on"); c.setAttribute("aria-pressed", "false"); });
      $("#filterSum").textContent = "設備、手邊食材";
      showView("recipe"); renderRecipes();
      const card = $$("#recipes [data-recipe]").find((x) => x.dataset.recipe === gr.dataset.gotoRecipe);
      if (card) { $("details", card).open = true; card.scrollIntoView({ behavior: "smooth", block: "center" }); card.classList.add("is-flash"); setTimeout(() => card.classList.remove("is-flash"), 1600); }
    }
  });

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
    renderAchievements();
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
        <span class="h-total">$${its.reduce((s, x) => s + x.deal, 0)}</span><b class="h-code" title="取餐碼">${esc(r.code)}</b>
        <button type="button" class="linklike h-share" data-share-item="${esc(`${its[0].shop}|${its[0].name}`)}">開箱分享</button></li>`;
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
    // 今晚的惜食裡，同樣花 $10 哪一樣買到最多蛋白質（用惜食價算）
    const cp = items.filter((x) => x.qty > 0 && x.protein && x.deal).map((x) => ({ x, v: x.protein / x.deal * 10 })).sort((a, b) => b.v - a.v).slice(0, 8);
    $("#topProtein").innerHTML = cp.map(({ x, v }) => `<li><span><button class="linklike" data-focus-shop="${esc(x.shop)}">${esc(x.name)}</button><small>${esc(shortName(shopById[x.shop]))}・$${x.deal}・蛋白質 ${fmt(x.protein, 1)} g</small></span><i class="leader" aria-hidden="true"></i><b>${fmt(v, 1)} g</b></li>`).join("")
      || `<li class="empty">今晚的惜食都訂完了。</li>`;
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
    updateAccountBtn();
    newBadges();      // 改版前就達成的徽章先記下來，之後只提示新的
    setupApp();
    $("#favOnlyWrap").hidden = !me;
    try { const m = sessionStorage.getItem("re_flash"); if (m) { sessionStorage.removeItem("re_flash"); setTimeout(() => toast(m), 300); } } catch { /* 不支援時略過 */ }
    if (viewFromHash() !== "map") showView(viewFromHash());
  })();
})();
