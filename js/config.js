// RescuEat 設定
// 店家每日上架的資料放在 Google 試算表，用 Google Apps Script 發布成網頁服務後，把網址貼到這裡。
// 留空時，網站使用 data/listings.js 的示範資料，預訂也只存在這台裝置。
window.RE_CONFIG = {
  APPS_SCRIPT_URL: "",
  // 估算營養時顯示的提醒文字（提案要求所有估算值都要標示）
  ESTIMATE_NOTE: "估算值，僅供參考",
};
