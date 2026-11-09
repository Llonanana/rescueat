/**
 * RescuEat 後端：Google 試算表 + Apps Script（提案「資料串接」）
 *
 * 設定步驟（詳見 README「接上 Google 試算表」）：
 *   1. 新增一份 Google 試算表 → 擴充功能 → Apps Script → 貼上本檔並儲存
 *   2. 上方函式選 setup → 執行（第一次要授權），會建好 listings、reservations 兩個工作表和示範品項
 *   3. 部署 → 新增部署作業 → 類型「網頁應用程式」；執行身分：我；誰可以存取：所有人
 *   4. 複製網址貼到 js/config.js 的 APPS_SCRIPT_URL
 *   之後改了本檔，要到「管理部署作業」發布新版本才會生效。
 *
 * 店家每天只改 listings 工作表的黃色欄位：qty（剩幾份）、deal（惜食價）、until（取餐截止）。
 * 不賣的品項把 qty 改成 0。新增品項時，id 不可重複，shop 用 data/shops.js 裡的店家 id。
 */

const LISTING_HEAD = ["id", "shop", "name", "cat", "price", "deal", "qty", "until", "kcal", "protein", "nsrc", "nnote", "micro", "fried"];
const RESERVATION_HEAD = ["time", "code", "itemIds", "items"];
const FORM_ROWS = 200;      // 預先套用格式與檢查的列數
const SEED = [
  ["bonbox-1", "bonbox", "威力雞胸弁當", "完整餐盒", 130, 104, 2, "19:15", 504, 31, "official", "", false, false],
  ["bonbox-2", "bonbox", "楽坡雞腿弁當", "完整餐盒", 140, 112, 1, "19:15", 557, 30, "official", "", false, false],
  ["bonbox-3", "bonbox", "舒浮彩蔬弁當（可素）", "完整餐盒", 105, 84, 2, "19:15", 431, 15, "official", "", false, false],
  ["bonbox-4", "bonbox", "超級白肉蛋白（無飯）", "蛋白質", 199, 159, 1, "19:15", 651, 68, "official", "", false, false],
  ["bonbox-5", "bonbox", "加購 威力雞胸", "蛋白質", 49, 39, 3, "19:15", 73, 16, "official", "", false, false],
  ["bonbox-6", "bonbox", "加購 楽坡雞腿", "蛋白質", 59, 47, 2, "19:15", 126, 15, "official", "", false, false],
  ["bonbox-7", "bonbox", "加購 水煮蛋（半顆）", "蛋白質", 10, 8, 4, "19:15", 50, 5, "official", "", false, false],
  ["bonbox-8", "bonbox", "加購 杏鮑菇", "蔬菜", 39, 31, 2, "19:15", 35, 2.7, "estimate", "官方營養表未列，以「杏鮑菇平均值」100 g 估算", false, false],
  ["bonbox-9", "bonbox", "加購 蔬菜", "蔬菜", 30, 24, 3, "19:15", 42, 3, "official", "", false, false],
  ["bonbox-10", "bonbox", "加購 黑金麥飯", "主食", 20, 16, 4, "19:15", 282, 6, "official", "", false, false],
  ["bonbox-11", "bonbox", "加購 地瓜泥球", "主食", 20, 16, 3, "19:15", 46, 1, "official", "", false, false],
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
}

function doGet(e) {
  if ((e.parameter.action || "") !== "listings") return json_({ error: "unknown action" });
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
  const body = JSON.parse(e.postData.contents);
  if (body.action !== "reserve" || !Array.isArray(body.itemIds)) return json_({ error: "unknown action" });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);               // 同時有人預訂時，避免把份數扣成負的
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName("listings");
    const values = sheet.getDataRange().getValues();
    const head = values[0], idCol = head.indexOf("id"), qtyCol = head.indexOf("qty"), nameCol = head.indexOf("name");
    const rowOf = (id) => values.findIndex((r, i) => i > 0 && String(r[idCol]) === String(id));
    for (const id of body.itemIds) {
      const row = rowOf(id);
      if (row < 0 || !(Number(values[row][qtyCol]) > 0)) return json_({ ok: false, error: `已訂完：${id}` });
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
