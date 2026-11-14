// RescuEat 設定
// 店家每日上架的資料放在 Google 試算表，用 Google Apps Script 發布成網頁服務後，把網址貼到這裡。
// 留空時，網站使用 data/listings.js 的示範資料，預訂也只存在這台裝置。
window.RE_CONFIG = {
  APPS_SCRIPT_URL: "",
  // 估算營養時顯示的提醒文字（提案要求所有估算值都要標示）
  ESTIMATE_NOTE: "估算值，僅供參考",
  // 惜食時段：這個時間起才顯示惜食價、開放預訂（台灣時間，24 小時制）
  DEAL_FROM: "19:00",
  // 19:00 前就打烊的店家另訂開始時間（打烊前 1 小時）
  DEAL_FROM_SHOP: { getpower: "17:30" },
};
