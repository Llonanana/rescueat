/**
 * RescuEat 後端：Google 試算表 + Apps Script（提案「資料串接」）
 *
 * 試算表需要一個名為「listings」的工作表，第一列為欄位名稱：
 *   id | shop | name | cat | price | deal | qty | until | kcal | protein | nsrc | nnote | micro | fried
 *   shop 用 data/shops.js 裡的店家 id（例如 bonbox）；cat 為 主食／蛋白質／蔬菜／完整餐盒。
 * 再建一個名為「reservations」的工作表，第一列：time | code | itemIds
 *
 * 部署：擴充功能 → Apps Script → 貼上本檔 → 部署 → 新增部署作業 → 類型「網頁應用程式」
 *       執行身分：我；誰可以存取：所有人 → 複製網址貼到 js/config.js 的 APPS_SCRIPT_URL。
 * 店家上架：用 Google 表單把回應寫進 listings 工作表（或直接編輯試算表）。
 */

function doGet(e) {
  if ((e.parameter.action || "") !== "listings") return json_({ error: "unknown action" });
  const sheet = SpreadsheetApp.getActive().getSheetByName("listings");
  const [head, ...rows] = sheet.getDataRange().getValues();
  const items = rows
    .filter((r) => r[0])
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
    .map((x) => ({ ...x, price: +x.price, deal: +x.deal, qty: +x.qty,
                   kcal: x.kcal === "" ? null : +x.kcal, protein: x.protein === "" ? null : +x.protein,
                   micro: x.micro === true || x.micro === "TRUE", fried: x.fried === true || x.fried === "TRUE" }));
  return json_({ items });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.action !== "reserve") return json_({ error: "unknown action" });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);               // 同時有人預訂時，避免把份數扣成負的
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName("listings");
    const values = sheet.getDataRange().getValues();
    const head = values[0], idCol = head.indexOf("id"), qtyCol = head.indexOf("qty");
    for (const id of body.itemIds) {
      const row = values.findIndex((r, i) => i > 0 && r[idCol] === id);
      if (row < 0 || values[row][qtyCol] <= 0) return json_({ ok: false, error: `已訂完：${id}` });
    }
    for (const id of body.itemIds) {
      const row = values.findIndex((r, i) => i > 0 && r[idCol] === id);
      sheet.getRange(row + 1, qtyCol + 1).setValue(values[row][qtyCol] - 1);
    }
    SpreadsheetApp.getActive().getSheetByName("reservations")
      .appendRow([new Date(), body.code, body.itemIds.join(",")]);
    return json_({ ok: true, code: body.code });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
