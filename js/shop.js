/* RescuEat 店家後台：登入後只讀寫自己店的品項（後端 Code.gs 的 shopLogin、shopData、shopSave） */
(function () {
  "use strict";
  const API = (window.RE_CONFIG || {}).APPS_SCRIPT_URL;
  const SHOPS = window.RE_SHOPS.shops;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "re_shop";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const save = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* 私密瀏覽 */ } };
  let session = load();
  let items = [];          // 後端回傳的原始值
  let toastTimer = null;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

  // 手機數字鍵盤打不出冒號：「1930」「930」也接受，自動變成 19:30、09:30
  const normTime = (v) => { v = String(v).trim().replace("：", ":"); if (/^\d{3,4}$/.test(v)) v = v.padStart(4, "0").replace(/(\d\d)$/, ":$1"); return v.replace(/^(\d):/, "0$1:"); };
  async function call(body) {
    const res = await fetch(API, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    return res.json();
  }

  $("#spShop").innerHTML = SHOPS.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  if (!API) {
    $("#spLoginForm .form-error").textContent = "網站還沒接上後端（js/config.js 的 APPS_SCRIPT_URL），無法使用店家後台。";
    $("#spLoginForm button").disabled = true;
  }

  $("#spLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $(".form-error", f), btn = $("button", f);
    const shop = f.shop.value, pass = f.pass.value.trim();
    if (!pass) { err.textContent = "請輸入店家密碼。"; return; }
    err.textContent = ""; btn.disabled = true;
    try {
      const r = await call({ action: "shopLogin", shop, pass });
      if (!r.ok) { err.textContent = r.error || "登入沒有成功。"; return; }
      session = { shop: r.shop, token: r.token }; save(session);
      f.reset();
      await open();
    } catch { err.textContent = "連不到伺服器，請稍後再試。"; }
    finally { btn.disabled = false; }
  });
  $("#spLogout").addEventListener("click", () => {
    if (changes().length && !confirm("還有修改沒有儲存，確定要登出？")) return;
    session = null; save(null); show(false);
  });
  $("#spReload").addEventListener("click", () => {
    if (changes().length && !confirm("還有修改沒有儲存，重新整理會放棄這些修改。")) return;
    open();
  });

  function show(on) {
    $("#spLogin").hidden = on; $("#spApp").hidden = !on;
    $("#spWho").hidden = !on; $("#spLogout").hidden = !on;
    if (on) { const s = SHOPS.find((x) => x.id === session.shop); $("#spWho").textContent = s ? s.name : session.shop; }
  }

  async function open() {
    show(true);
    $("#spItems").innerHTML = `<p class="hint">讀取中…</p>`;
    try {
      const r = await call({ action: "shopData", token: session.token });
      if (!r.ok) return expired(r);
      render(r);
    } catch { $("#spItems").innerHTML = `<p class="hint">連不到伺服器，請稍後按「重新整理」。</p>`; }
  }
  function expired(r) {
    if (r.relogin) { session = null; save(null); show(false); $("#spLoginForm .form-error").textContent = "登入已過期，請重新登入。"; return; }
    toast(r.error || "沒有成功，請再試一次。");
  }

  function render(r) {
    // 依類別排：完整餐盒、主食、蛋白質、蔬菜；同類別照試算表順序
    const CAT = ["完整餐盒", "主食", "蛋白質", "蔬菜"], rank = (c) => (CAT.indexOf(c) + 5) % 5;
    items = r.items.map((x, i) => ({ ...x, i })).sort((a, b) => rank(a.cat) - rank(b.cat) || a.i - b.i);
    $("#spItems").innerHTML = items.length ? items.map((x) => `
      <div class="sp-item" data-id="${esc(x.id)}">
        <p class="sp-name">${esc(x.name)}<small>${esc(x.cat)}・原價 $${x.price}</small></p>
        <label class="sp-f sp-deal">惜食價<input type="number" name="deal" min="1" max="${x.price}" step="1" inputmode="numeric" value="${x.deal}"></label>
        <div class="sp-f sp-qtyf">剩幾份<span class="sp-qty"><button type="button" data-step="-1" aria-label="${esc(x.name)} 少一份">−</button><input type="number" name="qty" min="0" max="999" step="1" inputmode="numeric" value="${x.qty}" aria-label="${esc(x.name)} 剩幾份"><button type="button" data-step="1" aria-label="${esc(x.name)} 多一份">＋</button></span></div>
        <label class="sp-f sp-until">取餐截止<input type="text" name="until" inputmode="numeric" maxlength="5" placeholder="19:30" value="${esc(x.until)}"></label>
        <button class="linklike sp-out" type="button" data-out>售完</button>
      </div>`).join("") : `<p class="hint">試算表裡還沒有你店裡的品項，請聯絡 RescuEat 新增。</p>`;
    const orders = r.orders || [], live = orders.filter((o) => o.status !== "已取消");
    $("#spOrderCount").textContent = orders.length ? `${live.length} 筆` : "";
    $("#spOrders").innerHTML = orders.length ? orders.map((o) => `<li class="${o.status === "已取消" ? "off" : ""}">
        <span class="t">${esc(o.time)}</span><b class="code">${esc(o.code)}</b><span class="its">${o.items.map(esc).join("、")}</span></li>`).join("")
      : `<li class="empty">今天還沒有人預訂。</li>`;
    refresh();
    $("#spStatus").textContent = ""; $("#spStatus").classList.remove("is-err");
    renderWeek(r.week);
    renderProfile(r.profile || {});
    const rd = r.redeems || [];
    $("#spRedeemWrap").hidden = !rd.length;
    $("#spRedeems").innerHTML = rd.map((x) => `<li><span class="t">${esc(x.time)}</span><b class="code">${esc(x.code)}</b><span class="its">${esc(x.perk)}（${x.pts} 點）</span></li>`).join("");
    renderQr();
  }

  // ---------- 本週成效 ----------
  const num = (n, d = 0) => Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: d });
  function renderWeek(w) {
    if (!w) { $("#spWeek").innerHTML = ""; return; }
    $("#spWeek").innerHTML = [
      ["賣出", num(w.meals), "份"], ["惜食收入", `$${num(w.revenue)}`, ""], ["少丟的食物", num(w.kg, 1), "kg"],
      ["減少碳排", num(w.co2, 1), "kg CO₂e"], ["客人", num(w.people), "位"], ["回頭客", num(w.returning), "位"],
    ].map(([t, v, u]) => `<div><dt>${t}</dt><dd>${v}<small>${u}</small></dd></div>`).join("");
    $("#spWeekNote").textContent = w.meals
      ? `共 ${num(w.orders)} 筆預訂（不含取消）${w.redeems ? `、${num(w.redeems)} 次點數兌換` : ""}。收入以目前惜食價計算，是原本可能要丟掉的餐點換回來的。回頭客是近 30 天在你店裡訂過 2 次以上的人。食物重量與碳排以每份 0.35 kg、每公斤 2.5 kg CO₂e 估算。`
      : "這週還沒有透過 RescuEat 的預訂。打烊前一小時更新剩幾份，學生就會在剩食地圖上看到你。";
  }

  // ---------- 店家介紹、今晚公告、點數優惠 ----------
  function renderProfile(p) {
    const f = $("#spProfile");
    f.note.value = p.note || ""; f.intro.value = p.intro || ""; f.perk.value = p.perk || ""; f.perkPts.value = p.perkPts || "";
    $("#spProfileStatus").textContent = ""; $("#spProfileStatus").classList.remove("is-err");
  }
  $("#spProfile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, st = $("#spProfileStatus"), btn = $("button", f);
    const v = { note: f.note.value.trim(), intro: f.intro.value.trim(), perk: f.perk.value.trim(), perkPts: +f.perkPts.value || 0 };
    if (v.perk && !(v.perkPts >= 20 && v.perkPts <= 1000)) { st.textContent = "有填點數優惠的話，需要點數請填 20 到 1000。"; st.classList.add("is-err"); return; }
    if (changes().length && !confirm("上面的品項還有修改沒有儲存，儲存店家資料後會重新讀取、放棄那些修改。要繼續嗎？")) return;
    btn.disabled = true; st.textContent = "儲存中…"; st.classList.remove("is-err");
    try {
      const r = await call({ action: "shopProfile", token: session.token, ...v });
      if (!r.ok) { expired(r); st.textContent = r.error || ""; st.classList.add("is-err"); return; }
      render(r);
      toast("店家資料已儲存，剩食地圖上馬上看得到。");
    } catch { st.textContent = "連不到伺服器，請再試一次。"; st.classList.add("is-err"); }
    finally { btn.disabled = false; }
  });

  // ---------- 店門口 QR code：掃了直接打開這家店今晚的惜食 ----------
  const shopUrl = () => new URL(`./?shop=${encodeURIComponent(session.shop)}`, location.href).href;
  function qrSvg(text) {
    if (typeof qrcode !== "function") return "";
    const q = qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  }
  function renderQr() {
    const url = shopUrl(), svg = qrSvg(url);
    $("#spQr").innerHTML = svg || `<p class="hint">QR code 產生器沒有載入，請檢查網路後重新整理。</p>`;
    $("#spQrUrl").textContent = url;
    $("#spPrint").disabled = !svg;
  }
  $("#spPrint").addEventListener("click", () => {
    const s = SHOPS.find((x) => x.id === session.shop);
    $("#ppShop").textContent = s ? s.name : session.shop;
    $("#ppQr").innerHTML = qrSvg(shopUrl());
    window.print();
  });

  // 和後端的值比較，只送出有改的欄位
  function changes() {
    return items.map((x) => {
      const row = $(`.sp-item[data-id="${CSS.escape(x.id)}"]`); if (!row) return null;
      const c = { id: x.id };
      const qty = row.querySelector("[name=qty]").value, deal = row.querySelector("[name=deal]").value, until = normTime(row.querySelector("[name=until]").value);
      if (qty !== "" && +qty !== x.qty) c.qty = +qty;
      if (deal !== "" && +deal !== x.deal) c.deal = +deal;
      if (until && until !== x.until) c.until = until;
      return Object.keys(c).length > 1 ? c : null;
    }).filter(Boolean);
  }
  function invalid(row, x) {
    const q = row.querySelector("[name=qty]"), d = row.querySelector("[name=deal]"), u = row.querySelector("[name=until]");
    const bad = [
      [q, !(q.value !== "" && Number.isInteger(+q.value) && +q.value >= 0 && +q.value <= 999), "份數要是 0 以上的整數"],
      [d, !(d.value !== "" && +d.value > 0 && +d.value <= x.price), `惜食價要大於 0，不能高於原價 $${x.price}`],
      [u, !/^([01]\d|2[0-3]):[0-5]\d$/.test(normTime(u.value)), "取餐截止請填像 19:30 的時間"],
    ];
    bad.forEach(([el, b]) => el.setAttribute("aria-invalid", b));
    const hit = bad.find(([, b]) => b);
    return hit ? `${x.name}：${hit[2]}` : "";
  }
  function refresh() {
    const ch = new Set(changes().map((c) => c.id));
    let err = "";
    for (const x of items) {
      const row = $(`.sp-item[data-id="${CSS.escape(x.id)}"]`); if (!row) continue;
      row.classList.toggle("is-changed", ch.has(x.id));
      row.classList.toggle("is-out", +row.querySelector("[name=qty]").value === 0);
      err = err || invalid(row, x);
    }
    const st = $("#spStatus");
    st.textContent = err || (ch.size ? `改了 ${ch.size} 樣，還沒儲存` : "");
    st.classList.toggle("is-err", !!err);
    $("#spSave").disabled = !ch.size || !!err;
  }
  $("#spItems").addEventListener("input", refresh);
  $("#spItems").addEventListener("click", (e) => {
    const row = e.target.closest(".sp-item"); if (!row) return;
    const q = row.querySelector("[name=qty]");
    const step = e.target.closest("[data-step]");
    if (step) q.value = Math.max(0, Math.min(999, (+q.value || 0) + +step.dataset.step));
    if (e.target.closest("[data-out]")) q.value = 0;
    if (step || e.target.closest("[data-out]")) refresh();
  });
  $("#spSave").addEventListener("click", async () => {
    const list = changes(); if (!list.length) return;
    const btn = $("#spSave"); btn.disabled = true; $("#spStatus").textContent = "儲存中…";
    try {
      const r = await call({ action: "shopSave", token: session.token, items: list });
      if (!r.ok) { expired(r); $("#spStatus").textContent = r.error || ""; $("#spStatus").classList.add("is-err"); btn.disabled = false; return; }
      render(r);
      toast(`已儲存 ${list.length} 樣，網站上馬上看得到。`);
    } catch { $("#spStatus").textContent = "連不到伺服器，請再按一次儲存。"; $("#spStatus").classList.add("is-err"); btn.disabled = false; }
  });
  addEventListener("beforeunload", (e) => { if (changes().length) { e.preventDefault(); e.returnValue = ""; } });

  if (session && API) open(); else show(false);
})();
