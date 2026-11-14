# RescuEat 政大惜食地圖

乞丐超人的勝利｜AI 實務專案。政大周邊打烊前的剩食地圖：找剩食、跨店組一份均衡的餐、看今天還缺多少營養、用宿舍設備把剩食煮完。

技術依提案：HTML／CSS／JavaScript＋Leaflet（底圖用國土測繪中心臺灣通用電子地圖，可切換 OpenStreetMap），資料串接 Google 試算表＋Apps Script，之後部署到 Railway。

## 在 VS Code 開起來

```bash
git clone https://github.com/<你的帳號>/rescueat.git
cd rescueat
code .
```

執行 `python scripts/serve.py`，再打開 http://127.0.0.1:5500/ 。這個本機伺服器每次都回傳最新檔案，改完程式重新整理就會生效。也可以用 VS Code 的 **Live Server** 擴充功能，或直接雙擊 `index.html`，只是地圖底圖需要網路。

## 功能

| 分頁 | 做什麼 | 資料來源 |
| --- | --- | --- |
| 剩食地圖 | 地圖標出合作店家；依類別、可否微波篩選，依餐盒優先、價格、省最多、蛋白質排序；每天 19:00 起才顯示惜食價、開放預訂（之前顯示原價）；預訂後產生 4 位數取餐碼，地圖畫出取餐路線，熱量自動記進「我的營養」，可在「我的預訂」取消 | `data/shops.js`、`data/listings.js` |
| 組一餐 | 預算內挑主食＋蛋白質＋蔬菜各一樣，依總價與步行距離排出 3 組，附 Google 地圖取餐路線；預訂後自動跳到剩食地圖並記入營養 | 同上 |
| 我的營養 | 依身高體重年齡算每日熱量，DRIs 第八版查各營養素建議量；搜尋食藥署資料庫或點選 13 道常用餐點記錄今天吃的東西，顯示缺口與下一餐推薦 | `data/foods.js`、`data/dris.js`、`data/meals.js` |
| 剩食料理 | 依設備（微波爐、電鍋、快煮鍋、免開火）與手邊食材找 15 分鐘內的料理 | `data/recipes.js` |
| 惜食圈（示範版） | 不佔分頁：右下角的浮動按鈕打開，從右側滑出（手機佔滿畫面）。分享剩食料理（可附照片、連到食譜）、惜食開箱（只能評自己預訂過的品項）、省錢撇步；按讚、惜食點數排行。貼文只存在這台瀏覽器，其他同學與貼文是示範資料 | 瀏覽器 localStorage |
| 資料來源 | 資料集清理結果與來源 | `data/stats.js` |
| 我的帳號（示範版） | 註冊、登入；會員的飲食紀錄保留歷史並可切換日期回看、最近 7 天熱量趨勢、預訂紀錄、收藏餐點與食譜、惜食點數與等級、8 個徽章、個人減量成果（救下幾份、省多少錢、減少多少碳排）。帳號只存在這台瀏覽器（密碼加鹽 SHA-256 後保存），不是正式會員系統 | 瀏覽器 localStorage |

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

## 手機 App（PWA）

網站本身就是手機 App：用手機打開網址後「加到主畫面」，就會有自己的圖示、全螢幕開啟，沒網路也能打開（`manifest.webmanifest`、`sw.js`）。

1. 把網站放上 GitHub Pages：repo 的 Settings → Pages → Source 選「Deploy from a branch」，Branch 選 `main`、資料夾 `/ (root)`，按 Save。私人 repo 需要 GitHub Pro（學生可用 GitHub Education 免費申請），或把 repo 改成公開
2. 一兩分鐘後用手機打開 `https://<帳號>.github.io/rescueat/`
3. Android（Chrome）：按頁面上方的「安裝成 App」，或選單裡的「安裝應用程式」；iPhone（Safari）：按「分享」→「加入主畫面」

離線快取對自己網站的檔案採「網路優先」：有網路一定拿最新版，所以更新網站後不用清快取。

## 接上 Google 試算表

1. 新增一份 Google 試算表，到「擴充功能 → Apps Script」，貼上 `apps-script/Code.gs` 並儲存
2. 上方函式選 `setup` 後按執行（第一次要授權），會建好 `listings`、`reservations` 工作表和示範品項
3. 「部署 → 新增部署作業」，類型選「網頁應用程式」，執行身分選「我」，誰可以存取選「所有人」
4. 把網址貼到 `js/config.js` 的 `APPS_SCRIPT_URL`

店家每天只改 `listings` 的黃色欄位：`qty`（剩幾份）、`deal`（惜食價）、`until`（取餐截止）。網站重新整理就會更新，學生預訂時會自動扣份數並記到 `reservations`。改了 `Code.gs` 之後，要到「管理部署作業」發布新版本才會生效。

試算表不用分享給大眾，但網頁應用程式的網址是公開的，任何人都能透過它讀取品項和送出預訂，目前沒有防止惡意預訂的機制；每家店也都能改到別家的資料，所以這個做法適合展示，正式上線前要加上店家驗證。

## 示範資料說明

- 品項與原價只取自已公開的官方菜單：楽坡 BonBox 官網（2026/07/13 更新）、GET POWER foodpanda（2026/11/01 查詢）、蛋白盒子官方線上點餐與雞肉本家 iCHEF 線上菜單（2026/11/09 查詢）
- 惜食價（原價 8 折，四捨五入到整數元）、剩餘份數、取餐時間為示範值
- 惜食時段：`js/config.js` 的 `DEAL_FROM`（預設 19:00）；18:30 打烊的 GET POWER 用 `DEAL_FROM_SHOP` 提早到 17:30。白天展示時，剩食地圖上方有「示範：直接看 19:30 的畫面」按鈕。`apps-script/Code.gs` 有同樣的設定，兩邊要一致
- 惜食點數：預訂 1 份 +10、發文 +5、有記錄飲食的每一天 +2；減量估算以每份 0.35 kg、每公斤食物浪費 2.5 kg CO₂e 計算
- 楽坡菜單註明加購品不單售；組一餐假設打烊前可單獨出清，正式上線前要和店家確認
- 營養：店家有標示的用官方數字（楽坡營養表 2026/02/09 版）；官方沒列的品項（楽坡杏鮑菇、雞肉本家全部品項）用食藥署資料 × 假設份量估算，畫面上標註「估算值，僅供參考」
- 食譜為示範，正式版需請具營養背景的同學審閱

## 資料來源

- 衛福部食藥署 食品營養成分資料集：https://data.gov.tw/dataset/8543
- 國健署「國人膳食營養素參考攝取量」第八版總表（民國 111 年）
- 台師大 成人每日均衡飲食建議量：https://web.ntnu.edu.tw/~499002011/evaluation.html
- 地圖底圖：內政部國土測繪中心「臺灣通用電子地圖」（政府資料開放授權）；可切換 © OpenStreetMap contributors
