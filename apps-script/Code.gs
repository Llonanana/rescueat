/**
 * RescuEat 後端：Google 試算表 + Apps Script（提案「資料串接」）
 *
 * 設定步驟（詳見 README「接上 Google 試算表」）：
 *   1. 新增一份 Google 試算表 → 擴充功能 → Apps Script → 貼上本檔並儲存
 *   2. 上方函式選 setup → 執行（第一次要授權），會建好 listings、reservations、posts 三個工作表和示範品項
 *   3. 部署 → 新增部署作業 → 類型「網頁應用程式」；執行身分：我；誰可以存取：所有人
 *   4. 複製網址貼到 js/config.js 的 APPS_SCRIPT_URL
 *   之後改了本檔，要到「管理部署作業」發布新版本才會生效。
 *
 * 店家每天只改 listings 工作表的黃色欄位：qty（剩幾份）、deal（惜食價）、until（取餐截止）。
 * 不賣的品項把 qty 改成 0。新增品項時，id 不可重複，shop 用 data/shops.js 裡的店家 id。
 */

// 惜食時段：這個時間起才接受預訂（台灣時間），要和 js/config.js 的 DEAL_FROM、DEAL_FROM_SHOP 一致
const DEAL_FROM = "00:00";
const DEAL_FROM_SHOP = { getpower: "00:00" };
// 展示用：網站切到「示範時間」送出的預訂不檢查時段，白天也能訂。正式上線改成 false
const ALLOW_DEMO = true;

const LISTING_HEAD = ["id", "shop", "name", "cat", "price", "deal", "qty", "until", "kcal", "protein", "nsrc", "nnote", "micro", "fried"];
const RESERVATION_HEAD = ["time", "code", "itemIds", "items"];
// 惜食圈貼文。by 是會員代號（email 的雜湊，不存 email 本身），likes 存按讚的會員代號
const POST_HEAD = ["id", "at", "by", "name", "kind", "text", "img", "recipe", "item", "rate", "likes"];
const POST_KINDS = ["cook", "unbox", "tip"];
const MAX_POSTS = 200;      // 只回傳最新的幾篇，避免越來越慢
const CELL_MAX = 49000;     // 試算表一格最多 5 萬字，照片要比這個小
const FORM_ROWS = 200;      // 預先套用格式與檢查的列數
const SEED = [
  ["bonbox-1", "bonbox", "威力雞胸弁當", "完整餐盒", 130, 104, 2, "19:30", 504, 31, "official", "", false, false],
  ["bonbox-2", "bonbox", "楽坡雞腿弁當", "完整餐盒", 140, 112, 1, "19:30", 557, 30, "official", "", false, false],
  ["bonbox-3", "bonbox", "舒浮彩蔬弁當（可素）", "完整餐盒", 105, 84, 2, "19:30", 431, 15, "official", "", false, false],
  ["bonbox-4", "bonbox", "超級白肉蛋白（無飯）", "蛋白質", 199, 159, 1, "19:30", 651, 68, "official", "", false, false],
  ["bonbox-5", "bonbox", "加購 威力雞胸", "蛋白質", 49, 39, 3, "19:30", 73, 16, "official", "", false, false],
  ["bonbox-6", "bonbox", "加購 楽坡雞腿", "蛋白質", 59, 47, 2, "19:30", 126, 15, "official", "", false, false],
  ["bonbox-7", "bonbox", "加購 水煮蛋（半顆）", "蛋白質", 10, 8, 4, "19:30", 50, 5, "official", "", false, false],
  ["bonbox-8", "bonbox", "加購 杏鮑菇", "蔬菜", 39, 31, 2, "19:30", 35, 2.7, "estimate", "官方營養表未列，以「杏鮑菇平均值」100 g 估算", false, false],
  ["bonbox-9", "bonbox", "加購 蔬菜", "蔬菜", 30, 24, 3, "19:30", 42, 3, "official", "", false, false],
  ["bonbox-10", "bonbox", "加購 黑金麥飯", "主食", 20, 16, 4, "19:30", 282, 6, "official", "", false, false],
  ["bonbox-11", "bonbox", "加購 地瓜泥球", "主食", 20, 16, 3, "19:30", 46, 1, "official", "", false, false],
  ["getpower-12", "getpower", "椒鹽水煮雞胸餐盒", "完整餐盒", 220, 176, 2, "18:15", 605, 43, "official", "", true, false],
  ["getpower-13", "getpower", "泰式打拋雞胸餐盒", "完整餐盒", 220, 176, 1, "18:15", 596, 41, "official", "", true, false],
  ["getpower-14", "getpower", "爐烤鮮時蔬餐盒", "完整餐盒", 190, 152, 2, "18:15", 510, 16, "official", "", true, false],
  ["proteinbox-15", "proteinbox", "香煎黑胡椒雞胸餐盒", "完整餐盒", 125, 100, 3, "19:45", 530, 30.2, "estimate", "官網只標示香煎雞胸系列三種口味為 526–535 大卡、蛋白質 29.9–30.6 g，取中間值", false, false],
  ["proteinbox-16", "proteinbox", "香煎海苔雞胸餐盒", "完整餐盒", 125, 100, 2, "19:45", 530, 30.2, "estimate", "官網只標示香煎雞胸系列三種口味為 526–535 大卡、蛋白質 29.9–30.6 g，取中間值", false, false],
  ["proteinbox-17", "proteinbox", "青蔥海鹽雞胸餐盒", "完整餐盒", 135, 108, 2, "19:45", 581, 30.1, "official", "", false, false],
  ["proteinbox-18", "proteinbox", "四川麻辣雞胸餐盒", "完整餐盒", 135, 108, 1, "19:45", 597, 32.0, "official", "", false, false],
  ["proteinbox-19", "proteinbox", "檸檬雞腿排餐盒", "完整餐盒", 135, 108, 2, "19:45", 565, 28.6, "official", "", false, false],
  ["proteinbox-20", "proteinbox", "漢方藥膳嫩雞腿餐盒", "完整餐盒", 125, 100, 1, "19:45", 602, 33.2, "official", "", false, false],
  ["proteinbox-21", "proteinbox", "減鹽味噌烤鱸魚餐盒", "完整餐盒", 165, 132, 1, "19:45", 592, 43.1, "official", "", false, false],
  ["proteinbox-22", "proteinbox", "素排骨餐盒", "完整餐盒", 130, 104, 1, "19:45", 722, 27.7, "official", "", false, false],
  ["proteinbox-23", "proteinbox", "單點 黑米飯", "主食", 10, 8, 4, "19:45", "", "", "", "", false, false],
  ["proteinbox-24", "proteinbox", "單點 蒸地瓜", "主食", 30, 24, 2, "19:45", "", "", "", "", false, false],
  ["proteinbox-25", "proteinbox", "單點 青花菜", "蔬菜", 30, 24, 2, "19:45", "", "", "", "", false, false],
  ["chickenhome-26", "chickenhome", "好吃雞肉飯", "完整餐盒", 125, 100, 3, "20:15", 673, 33.6, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 100 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-27", "chickenhome", "獅子頭飯", "完整餐盒", 125, 100, 2, "20:15", 908, 49.3, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、獅子頭 2 顆（豬絞肉 7 瘦 3 肥，共 180 g）、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-28", "chickenhome", "咖哩雞肉飯", "完整餐盒", 145, 116, 2, "20:15", 774, 34.7, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 100 g、咖哩塊 20 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-29", "chickenhome", "獅子頭雞肉飯", "完整餐盒", 165, 132, 1, "20:15", 869, 50.7, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 100 g、獅子頭 1 顆 90 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-30", "chickenhome", "單點 雞肉一份", "蛋白質", 90, 72, 2, "20:15", 157, 18.5, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：去骨雞腿肉 100 g", false, false],
  ["chickenhome-31", "chickenhome", "單點 炒時蔬", "蔬菜", 40, 32, 3, "20:15", 65, 1.3, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：高麗菜 100 g、炒菜油 5 g", false, false],
  ["chickenhome-32", "chickenhome", "單點 白飯", "主食", 15, 12, 4, "20:15", 364, 6.2, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g", false, false]
];

// 只需執行一次。工作表已有資料時不會覆蓋，避免洗掉店家填的內容。
function setup() {
  const ss = SpreadsheetApp.getActive();
  const listings = ss.getSheetByName("listings") || ss.insertSheet("listings");
  if (listings.getLastRow() === 0) {
    const col = (name) => LISTING_HEAD.indexOf(name) + 1;
    // 先把取餐時間設成純文字，否則試算表會把 19:15 轉成時間格式
    listings.getRange(2, col("until"), FORM_ROWS, 1).setNumberFormat("@");
    listings.getRange(1, 1, 1, LISTING_HEAD.length).setValues([LISTING_HEAD]).setFontWeight("bold");
    listings.getRange(2, 1, SEED.length, LISTING_HEAD.length).setValues(SEED);
    listings.setFrozenRows(1);
    ["qty", "deal", "until"].forEach((name) => listings.getRange(1, col(name), FORM_ROWS + 1, 1).setBackground("#FFF4C2"));
    listings.getRange(2, col("cat"), FORM_ROWS, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(["完整餐盒", "主食", "蛋白質", "蔬菜"]).build());
    ["qty", "deal", "price"].forEach((name) => listings.getRange(2, col(name), FORM_ROWS, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setHelpText("請填 0 以上的數字").build()));
  }
  const reservations = ss.getSheetByName("reservations") || ss.insertSheet("reservations");
  if (reservations.getLastRow() === 0) {
    reservations.getRange(1, 1, 1, RESERVATION_HEAD.length).setValues([RESERVATION_HEAD]).setFontWeight("bold");
    reservations.setFrozenRows(1);
  }
  setupPosts_();
}

// 已經建好試算表的人，只要再執行一次 setup（或這個函式）就會補上 posts 工作表
function setupPosts_() {
  const ss = SpreadsheetApp.getActive();
  const posts = ss.getSheetByName("posts") || ss.insertSheet("posts");
  if (posts.getLastRow() === 0) {
    posts.getRange(1, 1, 1, POST_HEAD.length).setValues([POST_HEAD]).setFontWeight("bold");
    posts.getRange(2, 1, FORM_ROWS, POST_HEAD.length).setNumberFormat("@");   // 全部當文字，時間和代號才不會被轉格式
    posts.setFrozenRows(1);
  }
  return posts;
}

function doGet(e) {
  const action = e.parameter.action || "";
  if (action === "posts") return json_({ posts: readPosts_() });
  if (action !== "listings") return json_({ error: "unknown action" });
  const range = SpreadsheetApp.getActive().getSheetByName("listings").getDataRange();
  const [head, ...rows] = range.getValues();
  const shown = range.getDisplayValues().slice(1);    // 時間用畫面上看到的文字，避免讀成 1899 年的日期
  const untilCol = head.indexOf("until");
  const items = rows
    .map((r, n) => ({ r, until: time_(shown[n][untilCol]) }))
    .filter(({ r }) => r[0])
    .map(({ r, until }) => ({ ...Object.fromEntries(head.map((h, i) => [h, r[i]])), until }))
    .map((x) => ({ ...x, price: +x.price || 0, deal: +x.deal || 0, qty: +x.qty || 0,
                   kcal: x.kcal === "" ? null : +x.kcal, protein: x.protein === "" ? null : +x.protein,
                   micro: x.micro === true || x.micro === "TRUE", fried: x.fried === true || x.fried === "TRUE" }));
  return json_({ items });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad json" }); }
  if (body.action === "post") return addPost_(body.post || {});
  if (body.action === "like") return toggleLike_(String(body.id || ""), String(body.user || ""));
  if (body.action === "delPost") return delPost_(String(body.id || ""), String(body.user || ""));
  if (body.action === "aiRecipe") return json_(aiRecipe_(body));
  if (body.action !== "reserve" || !Array.isArray(body.itemIds)) return json_({ error: "unknown action" });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);               // 同時有人預訂時，避免把份數扣成負的
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName("listings");
    const values = sheet.getDataRange().getValues();
    const head = values[0], idCol = head.indexOf("id"), qtyCol = head.indexOf("qty"), nameCol = head.indexOf("name"), shopCol = head.indexOf("shop");
    const rowOf = (id) => values.findIndex((r, i) => i > 0 && String(r[idCol]) === String(id));
    const now = Utilities.formatDate(new Date(), "Asia/Taipei", "HH:mm");
    for (const id of body.itemIds) {
      const row = rowOf(id);
      if (row < 0 || !(Number(values[row][qtyCol]) > 0)) return json_({ ok: false, error: `已訂完：${id}` });
      const from = DEAL_FROM_SHOP[values[row][shopCol]] || DEAL_FROM;
      if (now < from && !(ALLOW_DEMO && body.demo === true)) return json_({ ok: false, error: `${from} 起才開放預訂` });
    }
    for (const id of body.itemIds) {
      const row = rowOf(id);
      sheet.getRange(row + 1, qtyCol + 1).setValue(Number(values[row][qtyCol]) - 1);
    }
    SpreadsheetApp.getActive().getSheetByName("reservations")
      .appendRow([new Date(), body.code, body.itemIds.join(","), body.itemIds.map((id) => values[rowOf(id)][nameCol]).join("、")]);
    return json_({ ok: true, code: body.code });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 惜食圈 ----------
function postSheet_() { return SpreadsheetApp.getActive().getSheetByName("posts") || setupPosts_(); }
function rowToPost_(r) {
  const o = Object.fromEntries(POST_HEAD.map((h, i) => [h, r[i]]));
  const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (err) { return d; } };
  const p = { id: String(o.id), at: String(o.at), by: String(o.by), name: String(o.name), kind: String(o.kind),
              text: String(o.text), img: String(o.img), likes: parse(o.likes, []) };
  if (o.recipe) p.recipe = String(o.recipe);
  if (o.item) { p.item = parse(o.item, null); p.rate = +o.rate || 0; }
  return p;
}
function readPosts_() {
  const sheet = postSheet_();
  const n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  const from = Math.max(2, sheet.getLastRow() - MAX_POSTS + 1);
  return sheet.getRange(from, 1, sheet.getLastRow() - from + 1, POST_HEAD.length).getDisplayValues()
    .filter((r) => r[0]).map(rowToPost_);
}
function clip_(s, n) { return String(s == null ? "" : s).slice(0, n); }
function addPost_(p) {
  const kind = POST_KINDS.includes(p.kind) ? p.kind : "";
  const img = /^data:image\/(jpeg|png|webp);base64,/.test(p.img || "") ? String(p.img) : "";
  if (!kind || !p.by || !p.name) return json_({ ok: false, error: "資料不完整" });
  if (img.length > CELL_MAX) return json_({ ok: false, error: "照片太大" });
  if (!clip_(p.text, 500).trim() && !img) return json_({ ok: false, error: "沒有內容" });
  const post = { id: Utilities.getUuid().slice(0, 8), at: new Date().toISOString(), by: clip_(p.by, 40), name: clip_(p.name, 30),
                 kind, text: clip_(p.text, 500), img, likes: [] };
  const item = kind === "unbox" && p.item ? { id: clip_(p.item.id, 40), name: clip_(p.item.name, 60), shop: clip_(p.item.shop, 40) } : null;
  const rate = item ? Math.max(1, Math.min(5, Math.round(+p.rate || 0))) : "";
  const recipe = kind === "cook" ? clip_(p.recipe, 60) : "";
  // 開頭加 ' 避免文字被試算表當成公式（例如 =、+ 開頭）
  const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    postSheet_().appendRow([post.id, post.at, post.by, safe(post.name), kind, safe(post.text), img, safe(recipe), item ? JSON.stringify(item) : "", rate, "[]"]);
  } finally { lock.releaseLock(); }
  if (recipe) post.recipe = recipe;
  if (item) { post.item = item; post.rate = rate; }
  return json_({ ok: true, post });
}
function findPostRow_(sheet, id) {
  const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues();
  for (let i = ids.length - 1; i > 0; i--) if (ids[i][0] === id) return i + 1;
  return -1;
}
function toggleLike_(id, user) {
  if (!id || !user) return json_({ ok: false, error: "資料不完整" });
  const lock = LockService.getScriptLock(); lock.waitLock(10000);   // 兩個人同時按讚，不會互相蓋掉
  try {
    const sheet = postSheet_(), row = findPostRow_(sheet, id);
    if (row < 0) return json_({ ok: false, error: "找不到貼文" });
    const cell = sheet.getRange(row, POST_HEAD.indexOf("likes") + 1);
    let likes; try { likes = JSON.parse(cell.getDisplayValue() || "[]"); } catch (err) { likes = []; }
    const i = likes.indexOf(user);
    i < 0 ? likes.push(clip_(user, 40)) : likes.splice(i, 1);
    cell.setValue(JSON.stringify(likes));
    return json_({ ok: true, likes });
  } finally { lock.releaseLock(); }
}
function delPost_(id, user) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = postSheet_(), row = findPostRow_(sheet, id);
    if (row < 0) return json_({ ok: true });
    if (sheet.getRange(row, POST_HEAD.indexOf("by") + 1).getDisplayValue() !== user) return json_({ ok: false, error: "只能刪除自己的貼文" });
    sheet.deleteRow(row);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

// ---------- AI 食譜（Gemini） ----------
// 金鑰放在「專案設定 → 指令碼屬性」的 GEMINI_KEY，不寫在程式裡
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];   // 第一個找不到時改用下一個
const AI_PER_USER = 5;      // 每人每天幾次
const AI_PER_DAY = 200;     // 全站每天幾次，避免網址公開後額度被用光
const EQUIPS = ["微波爐", "電鍋", "快煮鍋", "免開火"];
const AI_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    equip: { type: "STRING", enum: EQUIPS },
    minutes: { type: "INTEGER" },
    kcal: { type: "INTEGER" },
    protein: { type: "NUMBER" },
    ingredients: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, amount: { type: "STRING" } }, required: ["name", "amount"] } },
    steps: { type: "ARRAY", items: { type: "STRING" } },
    tip: { type: "STRING" },
  },
  required: ["name", "equip", "minutes", "kcal", "protein", "ingredients", "steps", "tip"],
};

function aiRecipe_(b) {
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_KEY");
  if (!key) return { ok: false, error: "AI 還沒設定好（缺少 GEMINI_KEY）。" };
  const list = (a, n) => (Array.isArray(a) ? a : []).map((x) => clip_(x, 20).trim()).filter(Boolean).slice(0, n);
  const equip = list(b.equip, 4).filter((x) => EQUIPS.includes(x));
  const ings = list(b.ings, 12), rescued = list(b.rescued, 6), extra = clip_(b.extra, 60).trim();
  if (!ings.length && !rescued.length && !extra) return { ok: false, error: "先選一樣手邊食材，或在「其他食材」寫一樣。" };

  // 次數限制：每人每天、全站每天
  const day = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd");
  const user = clip_(b.user, 40) || "anon";
  const cache = CacheService.getScriptCache(), uk = `ai:${day}:${user}`;
  const used = Number(cache.get(uk) || 0);
  if (used >= AI_PER_USER) return { ok: false, error: `今天的 ${AI_PER_USER} 次 AI 食譜用完了，明天再來。` };
  const props = PropertiesService.getScriptProperties(), tk = `ai_total_${day}`;
  if (Number(props.getProperty(tk) || 0) >= AI_PER_DAY) return { ok: false, error: "今天全站的 AI 次數用完了，明天再來。" };

  const prompt = [
    "你是幫台灣大學生把剩食煮完的料理助手。請設計 1 道一人份料理，用台灣繁體中文回答。",
    `可用設備：${equip.length ? equip.join("、") : "微波爐、電鍋、快煮鍋或免開火，任選一種"}。只能用這些設備，宿舍沒有瓦斯爐和烤箱。`,
    rescued.length ? `今天買到的惜食（已煮熟的餐盒或配菜，請拿來改造）：${rescued.join("、")}。` : "",
    ings.length || extra ? `手邊食材：${[...ings, extra].filter(Boolean).join("、")}。` : "",
    "以上面的食材為主，可以另外假設有鹽、醬油、糖、胡椒、食用油、水這些基本調味料，其他食材盡量不要加。",
    "30 分鐘內做完，步驟 3 到 6 步，每步一句話、寫出微波或加熱的時間。",
    "剩菜或惜食要加熱到全熱、冒煙；生肉、生蛋要煮到全熟。",
    "kcal 與 protein（公克）是整份的估算值；ingredients 的 amount 寫份量，例如「1 碗」「100 g」。",
    "tip 寫一句保存或變化的小提醒。",
  ].filter(Boolean).join("\n");
  const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.9, responseMimeType: "application/json", responseSchema: AI_SCHEMA } };

  let res = null;
  for (const model of GEMINI_MODELS) {
    res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "post", contentType: "application/json", headers: { "x-goog-api-key": key },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 404) break;
  }
  const code = res.getResponseCode();
  if (code !== 200) {
    console.error(`Gemini ${code}: ${res.getContentText().slice(0, 500)}`);
    return { ok: false, error: code === 429 ? "AI 現在太忙，等一下再試。" : code === 400 || code === 403 ? "AI 金鑰有問題，請檢查 GEMINI_KEY。" : "AI 暫時沒有回應，等一下再試。" };
  }
  let r;
  try {
    const data = JSON.parse(res.getContentText());
    r = JSON.parse(data.candidates[0].content.parts.map((p) => p.text || "").join(""));
  } catch (err) {
    console.error(`Gemini 回傳無法解析：${res.getContentText().slice(0, 500)}`);
    return { ok: false, error: "AI 這次的回答格式不對，再按一次試試。" };
  }
  const recipe = {
    name: clip_(r.name, 30), equip: EQUIPS.includes(r.equip) ? r.equip : (equip[0] || "微波爐"),
    minutes: Math.max(1, Math.min(60, Math.round(+r.minutes || 10))),
    kcal: Math.max(0, Math.round(+r.kcal || 0)), protein: Math.max(0, Math.round((+r.protein || 0) * 10) / 10),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 10).map((x) => ({ name: clip_(x && x.name, 20), amount: clip_(x && x.amount, 20) })).filter((x) => x.name),
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 8).map((s) => clip_(s, 120)).filter(Boolean),
    tip: clip_(r.tip, 120),
  };
  if (!recipe.name || !recipe.steps.length) return { ok: false, error: "AI 這次沒有想出完整的食譜，再按一次試試。" };

  cache.put(uk, String(used + 1), 21600);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { props.setProperty(tk, String(Number(props.getProperty(tk) || 0) + 1)); } finally { lock.releaseLock(); }
  return { ok: true, recipe, left: AI_PER_USER - used - 1 };
}

// 在編輯器選這個函式按「執行」：第一次會要求「連線到外部服務」的授權，並測試金鑰能不能用
function testGemini() {
  const r = aiRecipe_({ equip: ["微波爐"], ings: ["蛋", "白飯"], rescued: ["好吃雞肉飯"], user: "editor-test" });
  console.log(JSON.stringify(r, null, 2));
}

// 「19:15」「19:15:00」「下午 7:15:00」都統一成 19:15
function time_(s) {
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(s);
  let h = +m[1];
  if (/下午|PM/i.test(s) && h < 12) h += 12;
  if (/上午|AM/i.test(s) && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
