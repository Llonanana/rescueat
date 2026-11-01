# RescuEat 政大惜食地圖

乞丐超人的勝利｜AI 實務專案。政大周邊打烊前的剩食地圖：找剩食、跨店組一份均衡的餐、看今天還缺多少營養、用宿舍設備把剩食煮完。

技術依提案：HTML／CSS／JavaScript＋Leaflet＋OpenStreetMap，資料串接 Google 試算表＋Apps Script，之後部署到 Railway。

## 在 VS Code 開起來

```bash
git clone https://github.com/<你的帳號>/rescueat.git
cd rescueat
code .
```

在 VS Code 安裝 **Live Server** 擴充功能，對 `index.html` 按右鍵選「Open with Live Server」。直接雙擊 `index.html` 也能開，只是地圖底圖需要網路。

## 功能

| 分頁 | 做什麼 | 資料來源 |
| --- | --- | --- |
| 剩食地圖 | 地圖標出合作店家；依類別、惜食價、可否微波篩選；預訂後產生 4 位數取餐碼 | `data/shops.js`、`data/listings.js` |
| 組一餐 | 預算內挑主食＋蛋白質＋蔬菜各一樣，依總價與步行距離排出 3 組，附 Google 地圖取餐路線 | 同上 |
| 我的營養 | 依身高體重年齡算每日熱量，DRIs 第八版查各營養素建議量；搜尋食藥署資料庫記錄今天吃的東西，顯示缺口與下一餐推薦 | `data/foods.js`、`data/dris.js` |
| 剩食料理 | 依設備（微波爐、電鍋、快煮鍋、免開火）與手邊食材找 15 分鐘內的料理 | `data/recipes.js` |
| 資料來源 | 資料集清理結果與來源 | `data/stats.js` |

## 資料夾

```
index.html, css/, js/       前端
js/config.js                填入 Apps Script 網址後改用即時資料
data/*.js                   前端資料（由腳本產生，勿手改）
scripts/build_web_data.py   從營養分析結果產生 data/*.js
analysis/                   營養資料前處理（食藥署清理、分類、DRIs、餐點 Mapping）
apps-script/Code.gs         Google 試算表後端範本
```

## 重新產生資料

```bash
pip install pandas
# 1. 把 data.gov.tw/dataset/8543 下載的食品營養成分資料集放到 analysis/data/raw/
python analysis/run_pipeline.py analysis/data/raw/20_2.csv --out analysis/data/processed
# 2. 轉成前端資料
python scripts/build_web_data.py
```

原始檔約 66 MB，不放進 Git（見 `.gitignore`）。

## 接上 Google 試算表

1. 依 `apps-script/Code.gs` 開頭說明建立 `listings`、`reservations` 兩個工作表
2. 部署為網頁應用程式，把網址貼到 `js/config.js` 的 `APPS_SCRIPT_URL`
3. 店家用 Google 表單上架，資料寫進 `listings`；網站改讀即時資料，預訂會扣試算表裡的份數

## 示範資料說明

- 品項與原價只取自已公開的官方菜單：楽坡 BonBox 官網（2026/07/13 更新）、GET POWER foodpanda（2026/11/01 查詢）
- 惜食價（原價 7 折）、剩餘份數、取餐時間為示範值
- 其餘 6 家合作店家尚未確認菜單，地圖上標為「洽談中」，不放任何價格
- 營養：餐盒用店家官方標示；單點品項用食藥署資料 × 假設份量估算，畫面上都標註「估算值，僅供參考」
- 食譜為示範，正式版需請具營養背景的同學審閱

## 資料來源

- 衛福部食藥署 食品營養成分資料集：https://data.gov.tw/dataset/8543
- 國健署「國人膳食營養素參考攝取量」第八版總表（民國 111 年）
- 台師大 成人每日均衡飲食建議量：https://web.ntnu.edu.tw/~499002011/evaluation.html
- 地圖底圖：© OpenStreetMap contributors
