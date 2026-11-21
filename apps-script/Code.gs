/**
 * RescuEat 後端：Google 試算表 + Apps Script（提案「資料串接」）
 *
 * 設定步驟（詳見 README「接上 Google 試算表」）：
 *   1. 新增一份 Google 試算表 → 擴充功能 → Apps Script → 貼上本檔並儲存
 *   2. 上方函式選 setup → 執行（第一次要授權），會建好 listings、reservations、posts、users 工作表和示範品項
 *      再選 setupShops → 執行，會產生每家店的後台密碼（在下方「執行記錄」看得到）
 *   3. 部署 → 新增部署作業 → 類型「網頁應用程式」；執行身分：我；誰可以存取：所有人
 *   4. 複製網址貼到 js/config.js 的 APPS_SCRIPT_URL
 *   之後改了本檔，要到「管理部署作業」發布新版本才會生效。
 *
 * 店家用網站的「店家後台」（shop.html）登入改自己的品項，不用碰試算表，也看不到別家的資料。
 * 你自己也可以直接改 listings 工作表的黃色欄位：qty（剩幾份）、deal（惜食價）、until（取餐截止）。
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
// ai：分享 AI 食譜時附上的整道食譜（JSON）
const POST_HEAD = ["id", "at", "by", "name", "kind", "text", "img", "recipe", "item", "rate", "likes", "ai"];
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
  ["getpower-12", "getpower", "椒鹽水煮雞胸餐盒", "完整餐盒", 125, 100, 2, "18:45", 605, 43, "official", "", true, false],
  ["getpower-13", "getpower", "泰式打拋雞胸餐盒", "完整餐盒", 125, 100, 1, "18:45", 596, 41, "official", "", true, false],
  ["getpower-14", "getpower", "爐烤鮮時蔬餐盒", "完整餐盒", 110, 88, 2, "18:45", 510, 16, "official", "", true, false],
  ["proteinbox-15", "proteinbox", "香煎黑胡椒雞胸餐盒", "完整餐盒", 125, 100, 3, "19:45", 530, 30.2, "estimate", "官網只標示香煎雞胸系列三種口味為 526–535 大卡、蛋白質 29.9–30.6 g，取中間值", false, false],
  ["proteinbox-16", "proteinbox", "香煎海苔雞胸餐盒", "完整餐盒", 125, 100, 2, "19:45", 530, 30.2, "estimate", "官網只標示香煎雞胸系列三種口味為 526–535 大卡、蛋白質 29.9–30.6 g，取中間值", false, false],
  ["proteinbox-17", "proteinbox", "青蔥海鹽雞胸餐盒", "完整餐盒", 135, 108, 2, "19:45", 581, 30.1, "official", "", false, false],
  ["proteinbox-18", "proteinbox", "四川麻辣雞胸餐盒", "完整餐盒", 135, 108, 1, "19:45", 597, 32.0, "official", "", false, false],
  ["proteinbox-19", "proteinbox", "檸檬雞腿排餐盒", "完整餐盒", 135, 108, 2, "19:45", 565, 28.6, "official", "", false, false],
  ["proteinbox-20", "proteinbox", "漢方藥膳嫩雞腿餐盒", "完整餐盒", 125, 100, 1, "19:45", 602, 33.2, "official", "", false, false],
  ["proteinbox-21", "proteinbox", "減鹽味噌烤鱸魚餐盒", "完整餐盒", 165, 132, 1, "19:45", 592, 43.1, "official", "", false, false],
  ["proteinbox-22", "proteinbox", "素排骨餐盒", "完整餐盒", 130, 104, 1, "19:45", 722, 27.7, "official", "", false, false],
  ["proteinbox-23", "proteinbox", "單點 黑米飯", "主食", 10, 8, 4, "19:45", 182, 3.1, "estimate", "官網未列營養，食藥署沒有熟黑米飯，以白飯 100 g 估算", false, false],
  ["proteinbox-24", "proteinbox", "單點 蒸地瓜", "主食", 30, 24, 2, "19:45", 115, 1.3, "estimate", "官網未列營養，以食藥署地瓜 100 g 估算", false, false],
  ["proteinbox-25", "proteinbox", "單點 青花菜", "蔬菜", 30, 24, 2, "19:45", 33, 3.4, "estimate", "官網未列營養，以食藥署青花菜 100 g 估算", false, false],
  ["chickenhome-26", "chickenhome", "好吃雞肉飯", "完整餐盒", 125, 100, 3, "20:15", 673, 33.6, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 100 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-27", "chickenhome", "獅子頭飯", "完整餐盒", 125, 100, 2, "20:15", 908, 49.3, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、獅子頭 2 顆（豬絞肉 7 瘦 3 肥，共 180 g）、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-28", "chickenhome", "咖哩雞肉飯", "完整餐盒", 145, 116, 2, "20:15", 774, 34.7, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 100 g、咖哩塊 20 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-29", "chickenhome", "獅子頭雞肉飯", "完整餐盒", 165, 132, 1, "20:15", 869, 50.7, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 100 g、獅子頭 1 顆 90 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-30", "chickenhome", "單點 雞肉一份", "蛋白質", 90, 72, 2, "20:15", 157, 18.5, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：去骨雞腿肉 100 g", false, false],
  ["chickenhome-31", "chickenhome", "單點 炒時蔬", "蔬菜", 40, 32, 3, "20:15", 65, 1.3, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：高麗菜 100 g、炒菜油 5 g", false, false],
  ["chickenhome-32", "chickenhome", "單點 白飯", "主食", 15, 12, 4, "20:15", 364, 6.2, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g", false, false],
  ["bonbox-33", "bonbox", "輕日照燒雞腿弁當", "完整餐盒", 149, 119, 0, "19:30", 562, 30, "official", "", false, false],
  ["bonbox-34", "bonbox", "炒雞喜歡弁當", "完整餐盒", 129, 103, 0, "19:30", 557, 22, "official", "", false, false],
  ["bonbox-35", "bonbox", "秘傳12牛排弁當", "完整餐盒", 189, 151, 0, "19:30", 548, 29, "official", "", false, false],
  ["bonbox-36", "bonbox", "極選厚馥鮭魚弁當（限量）", "完整餐盒", 259, 207, 0, "19:30", 597, 31, "official", "", false, false],
  ["bonbox-37", "bonbox", "厚切嫩雞胸弁當", "完整餐盒", 165, 132, 0, "19:30", 598, 51, "official", "", false, false],
  ["bonbox-38", "bonbox", "川麻椒香雞胸弁當", "完整餐盒", 140, 112, 0, "19:30", 509, 31, "official", "", false, false],
  ["bonbox-39", "bonbox", "浩克雞腿弁當", "完整餐盒", 165, 132, 0, "19:30", 767, 38, "official", "", false, false],
  ["bonbox-40", "bonbox", "炙烤青花魚弁當", "完整餐盒", 189, 151, 0, "19:30", 932, 33, "official", "", false, false],
  ["bonbox-41", "bonbox", "泰式酸甜魚弁當", "完整餐盒", 145, 116, 0, "19:30", 508, 25, "official", "", false, false],
  ["bonbox-42", "bonbox", "檸香巴沙魚弁當", "完整餐盒", 140, 112, 0, "19:30", 474, 25, "official", "", false, false],
  ["bonbox-43", "bonbox", "霜降62松阪豬弁當", "完整餐盒", 155, 124, 0, "19:30", 573, 24, "official", "", false, false],
  ["bonbox-44", "bonbox", "椒鹽梅花豬弁當", "完整餐盒", 135, 108, 0, "19:30", 626, 33, "official", "", false, false],
  ["bonbox-45", "bonbox", "胡麻牛老五弁當", "完整餐盒", 150, 120, 0, "19:30", 815, 38, "official", "", false, false],
  ["bonbox-46", "bonbox", "海鹽牛老五弁當", "完整餐盒", 140, 112, 0, "19:30", 714, 37, "official", "", false, false],
  ["bonbox-47", "bonbox", "深海魷船長弁當", "完整餐盒", 169, 135, 0, "19:30", 488, 25, "official", "", false, false],
  ["bonbox-48", "bonbox", "綠野仙菇弁當（可素）", "完整餐盒", 125, 100, 0, "19:30", 458, 17, "official", "", false, false],
  ["bonbox-49", "bonbox", "海陸白肉蛋白（無飯）", "蛋白質", 229, 183, 0, "19:30", 511, 53, "official", "", false, false],
  ["bonbox-50", "bonbox", "蛙人紅肉蛋白（無飯）", "蛋白質", 279, 223, 0, "19:30", 810, 57, "official", "", false, false],
  ["bonbox-51", "bonbox", "加購 楽坡炒雞", "蛋白質", 39, 31, 0, "19:30", 126, 7, "estimate", "官方未列加購營養，以「楽坡炒雞弁當」官方 557 大卡、22 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-52", "bonbox", "加購 椒鹽梅花豬", "蛋白質", 49, 39, 0, "19:30", 195, 18, "estimate", "官方未列加購營養，以「椒鹽梅花豬弁當」官方 626 大卡、33 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-53", "bonbox", "加購 川麻椒香雞胸", "蛋白質", 59, 47, 0, "19:30", 78, 16, "estimate", "官方未列加購營養，以「川麻椒香雞胸弁當」官方 509 大卡、31 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-54", "bonbox", "加購 海鹽牛老五", "蛋白質", 59, 47, 0, "19:30", 283, 22, "estimate", "官方未列加購營養，以「海鹽牛老五弁當」官方 714 大卡、37 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-55", "bonbox", "加購 檸香巴沙魚", "蛋白質", 59, 47, 0, "19:30", 43, 10, "estimate", "官方未列加購營養，以「檸香巴沙魚弁當」官方 474 大卡、25 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-56", "bonbox", "加購 輕日照燒雞腿", "蛋白質", 69, 55, 0, "19:30", 131, 15, "estimate", "官方未列加購營養，以「輕日照燒雞腿弁當」官方 562 大卡、30 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-57", "bonbox", "加購 泰式酸甜魚", "蛋白質", 69, 55, 0, "19:30", 77, 10, "estimate", "官方未列加購營養，以「泰式酸甜魚弁當」官方 508 大卡、25 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-58", "bonbox", "加購 胡麻牛老五", "蛋白質", 69, 55, 0, "19:30", 384, 23, "estimate", "官方未列加購營養，以「胡麻牛老五弁當」官方 815 大卡、38 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-59", "bonbox", "加購 霜降62松阪豬", "蛋白質", 79, 63, 0, "19:30", 142, 9, "estimate", "官方未列加購營養，以「霜降62松阪豬弁當」官方 573 大卡、24 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-60", "bonbox", "加購 厚切嫩雞胸", "蛋白質", 89, 71, 0, "19:30", 167, 36, "estimate", "官方未列加購營養，以「厚切嫩雞胸弁當」官方 598 大卡、51 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-61", "bonbox", "加購 浩克雞腿", "蛋白質", 89, 71, 0, "19:30", 336, 23, "estimate", "官方未列加購營養，以「浩克雞腿弁當」官方 767 大卡、38 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-62", "bonbox", "加購 深海魷船長", "蛋白質", 89, 71, 0, "19:30", 57, 10, "estimate", "官方未列加購營養，以「深海魷船長弁當」官方 488 大卡、25 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-63", "bonbox", "加購 炙烤青花魚", "蛋白質", 99, 79, 0, "19:30", 501, 18, "estimate", "官方未列加購營養，以「炙烤青花魚弁當」官方 932 大卡、33 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-64", "bonbox", "加購 秘傳12牛排", "蛋白質", 99, 79, 0, "19:30", 117, 14, "estimate", "官方未列加購營養，以「秘傳12牛排弁當」官方 548 大卡、29 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-65", "bonbox", "加購 極選厚馥鮭魚", "蛋白質", 160, 128, 0, "19:30", 166, 16, "estimate", "官方未列加購營養，以「極選厚馥鮭魚弁當」官方 597 大卡、31 g 減去弁當基底 431 大卡、15 g 估算", false, false],
  ["bonbox-66", "bonbox", "加購 戀戀泡菜", "蔬菜", 39, 31, 0, "19:30", 57, 0.9, "estimate", "官方未列營養，以食藥署「台式泡菜」100 g 估算", false, false],
  ["getpower-67", "getpower", "塔香烘烤雞胸餐盒", "完整餐盒", 125, 100, 0, "18:45", 613, 43, "official", "", true, false],
  ["getpower-68", "getpower", "南加州烤雞腿餐盒", "完整餐盒", 135, 108, 0, "18:45", 714, 48, "official", "", true, false],
  ["getpower-69", "getpower", "蒜泥醬豬肉片餐盒", "完整餐盒", 125, 100, 0, "18:45", 623, 38, "official", "", true, false],
  ["getpower-70", "getpower", "樹子汁蒸鱸魚餐盒", "完整餐盒", 140, 112, 0, "18:45", 555, 34, "official", "", true, false],
  ["getpower-71", "getpower", "鹽烤馬加魚餐盒", "完整餐盒", 130, 104, 0, "18:45", 594, 29, "official", "", true, false],
  ["getpower-72", "getpower", "大厚切烤鮭魚餐盒", "完整餐盒", 220, 176, 0, "18:45", 690, 44, "official", "", true, false],
  ["getpower-73", "getpower", "十三香滷牛腱餐盒", "完整餐盒", 160, 128, 0, "18:45", 573, 34, "official", "", true, false],
  ["proteinbox-74", "proteinbox", "麻油雞腿排餐盒", "完整餐盒", 145, 116, 0, "19:45", 609, 28.6, "estimate", "官網未列營養，以官方「檸檬雞腿排餐盒」565 大卡、28.6 g 為底，另加麻油 5 g 估算", false, false],
  ["proteinbox-75", "proteinbox", "醬濃香烤雞腿排餐盒", "完整餐盒", 145, 116, 0, "19:45", 580, 29.6, "estimate", "官網未列營養，以官方「檸檬雞腿排餐盒」565 大卡、28.6 g 為底，另加醬油膏 15 g 估算", false, false],
  ["proteinbox-76", "proteinbox", "紐奧良雞腿排餐盒", "完整餐盒", 135, 108, 0, "19:45", 565, 28.6, "estimate", "官網未列營養，以官方「檸檬雞腿排餐盒」565 大卡、28.6 g 為底估算（乾式香料，熱量差不多）", false, false],
  ["proteinbox-77", "proteinbox", "日式鹽味雞胸餐盒", "完整餐盒", 130, 104, 0, "19:45", 530, 30.2, "estimate", "官網未列營養，和香煎雞胸系列同底，以官方 526–535 大卡、29.9–30.6 g 取中間值估算", false, false],
  ["proteinbox-78", "proteinbox", "乾碟香辣雞胸餐盒", "完整餐盒", 130, 104, 0, "19:45", 530, 30.2, "estimate", "官網未列營養，和香煎雞胸系列同底，以官方 526–535 大卡、29.9–30.6 g 取中間值估算", false, false],
  ["proteinbox-79", "proteinbox", "炭火燒肉雞胸餐盒", "完整餐盒", 135, 108, 0, "19:45", 545, 31.2, "estimate", "官網未列營養，以香煎雞胸系列中間值 530 大卡、30.2 g 加燒肉醬 15 g 估算", false, false],
  ["proteinbox-80", "proteinbox", "香煎蒙特婁雞胸餐盒", "完整餐盒", 125, 100, 0, "19:45", 530, 30.2, "estimate", "官網未列營養，和香煎雞胸系列同底，以官方 526–535 大卡、29.9–30.6 g 取中間值估算", false, false],
  ["proteinbox-81", "proteinbox", "日式鹽味豬排餐盒", "完整餐盒", 150, 120, 0, "19:45", 665, 29.9, "estimate", "官網未列營養，以餐盒基底（香煎雞胸餐盒扣掉雞胸）加豬大里肌 120 g、煎油 5 g估算（食藥署資料）", false, false],
  ["proteinbox-82", "proteinbox", "乾碟香辣豬排餐盒", "完整餐盒", 150, 120, 0, "19:45", 665, 29.9, "estimate", "官網未列營養，以餐盒基底（香煎雞胸餐盒扣掉雞胸）加豬大里肌 120 g、煎油 5 g估算（食藥署資料）", false, false],
  ["proteinbox-83", "proteinbox", "菲力豬排餐盒", "完整餐盒", 145, 116, 0, "19:45", 578, 32.2, "estimate", "官網未列營養，以餐盒基底（香煎雞胸餐盒扣掉雞胸）加豬小里肌（菲力）120 g、煎油 5 g估算（食藥署資料）", false, false],
  ["proteinbox-84", "proteinbox", "壽喜牛五花餐盒", "完整餐盒", 145, 116, 0, "19:45", 824, 23.3, "estimate", "官網未列營養，以餐盒基底（香煎雞胸餐盒扣掉雞胸）加牛五花 100 g、醬油 10 g、糖 5 g估算（食藥署資料）", false, false],
  ["proteinbox-85", "proteinbox", "薄鹽烤鮭魚餐盒", "完整餐盒", 180, 144, 0, "19:45", 576, 31.7, "estimate", "官網未列營養，以餐盒基底（香煎雞胸餐盒扣掉雞胸）加鮭魚切片 120 g估算（食藥署資料）", false, false],
  ["proteinbox-86", "proteinbox", "無肉餐盒", "完整餐盒", 95, 76, 0, "19:45", 367, 6.9, "estimate", "官網未列營養，以香煎雞胸餐盒扣掉雞胸 100 g、煎油 5 g 估算，未計可能加量的配菜", false, false],
  ["chickenhome-87", "chickenhome", "雙倍雞肉飯", "完整餐盒", 200, 160, 0, "20:15", 830, 52.1, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、去骨雞腿肉 200 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-88", "chickenhome", "咖哩獅子頭飯", "完整餐盒", 145, 116, 0, "20:15", 1010, 50.4, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、獅子頭 2 顆 180 g、咖哩塊 20 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g", false, false],
  ["chickenhome-89", "chickenhome", "單點 獅子頭（一顆）", "蛋白質", 43, 34, 0, "20:15", 196, 17.1, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：獅子頭 1 顆（豬絞肉 7 瘦 3 肥）90 g", false, false],
  ["chickenhome-90", "chickenhome", "單點 水煮蛋", "蛋白質", 20, 16, 0, "20:15", 74, 7.0, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：雞蛋 1 顆 55 g", false, false],
  ["chickenhome-91", "chickenhome", "單點 黃金泡菜", "蔬菜", 39, 31, 0, "20:15", 108, 2.4, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：黃金泡菜 100 g", false, false],
  ["chickenhome-92", "chickenhome", "單點 咖哩飯", "主食", 85, 68, 0, "20:15", 465, 7.3, "estimate", "店家未公布營養，以食藥署資料與假設份量估算：白飯 200 g、咖哩塊 20 g", false, false]
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
  userSheet_();
}

// 補齊完整菜單：已經在用的試算表執行一次就好。
// 試算表裡沒有的品項加到最後（份數 0，店家有剩再改）；已有的品項只更新品名、類別、原價、營養這些菜單資料，
// 不動店家填的份數、取餐截止；惜食價只有在高於新原價時才改回八折
function addMenu() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("listings");
  const values = sheet.getDataRange().getValues();
  const col = (h) => LISTING_HEAD.indexOf(h);
  const MENU_COLS = ["name", "cat", "price", "kcal", "protein", "nsrc", "nnote", "micro", "fried"];
  let added = 0, updated = 0;
  for (const s of SEED) {
    const i = values.findIndex((r, n) => n > 0 && String(r[0]) === s[0]);
    if (i < 0) {
      const row = s.slice(); row[col("qty")] = 0;
      sheet.appendRow(row);
      sheet.getRange(sheet.getLastRow(), col("until") + 1).setNumberFormat("@").setValue(s[col("until")]);
      added++;
      continue;
    }
    let changed = false;
    for (const h of MENU_COLS) {
      if (String(values[i][col(h)]) !== String(s[col(h)])) { sheet.getRange(i + 1, col(h) + 1).setValue(s[col(h)]); changed = true; }
    }
    if (+values[i][col("deal")] > +s[col("price")]) { sheet.getRange(i + 1, col("deal") + 1).setValue(s[col("deal")]); changed = true; }
    if (changed) updated++;
  }
  console.log(`新增 ${added} 樣、更新 ${updated} 樣菜單資料`);
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
  if (body.action === "register") return json_(register_(body));
  if (body.action === "login") return json_(login_(body));
  if (body.action === "me") return json_(me_(body));
  if (body.action === "saveMe") return json_(saveMe_(body));
  if (body.action === "shopLogin") return json_(shopLogin_(body));
  if (body.action === "shopData") return json_(shopData_(body));
  if (body.action === "shopSave") return json_(shopSave_(body));
  if (body.action === "cancel") return json_(cancel_(String(body.code || ""), Array.isArray(body.itemIds) ? body.itemIds.map(String) : []));
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

// 取消預訂：份數加回 listings，reservations 那筆標「已取消」（不刪，店家查得到）
// 用取餐碼＋品項比對，從最新的往回找第一筆還沒取消的
function cancel_(code, itemIds) {
  if (!code || !itemIds.length) return { ok: false, error: "資料不完整" };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActive(), rs = ss.getSheetByName("reservations");
    const STATUS_COL = RESERVATION_HEAD.length + 1;
    if (rs.getRange(1, STATUS_COL).getDisplayValue() !== "status") rs.getRange(1, STATUS_COL).setValue("status").setFontWeight("bold");
    const rows = rs.getRange(1, 1, rs.getLastRow(), STATUS_COL).getDisplayValues();
    let row = -1;
    for (let i = rows.length - 1; i > 0; i--) {
      if (rows[i][1] === code && rows[i][2] === itemIds.join(",") && rows[i][STATUS_COL - 1] !== "已取消") { row = i + 1; break; }
    }
    if (row < 0) return { ok: true, already: true };     // 找不到或已取消過：當作已取消，不重複加回份數
    const sheet = ss.getSheetByName("listings"), values = sheet.getDataRange().getValues();
    const idCol = values[0].indexOf("id"), qtyCol = values[0].indexOf("qty");
    for (const id of itemIds) {
      const r = values.findIndex((x, i) => i > 0 && String(x[idCol]) === id);
      if (r > 0) { values[r][qtyCol] = Number(values[r][qtyCol]) + 1; sheet.getRange(r + 1, qtyCol + 1).setValue(values[r][qtyCol]); }
    }
    rs.getRange(row, STATUS_COL).setValue("已取消");
    return { ok: true };
  } finally { lock.releaseLock(); }
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
  if (o.ai) p.ai = parse(o.ai, null);
  return p;
}
// AI 食譜只留需要的欄位、限制長度，避免塞進奇怪或過大的內容
function cleanAi_(a) {
  if (!a || typeof a !== "object" || !a.name) return null;
  const list = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
  return {
    name: clip_(a.name, 30), equip: EQUIPS.includes(a.equip) ? a.equip : "微波爐",
    minutes: Math.max(1, Math.min(60, Math.round(+a.minutes || 10))),
    kcal: Math.max(0, Math.round(+a.kcal || 0)), protein: Math.max(0, Math.round((+a.protein || 0) * 10) / 10),
    ingredients: list(a.ingredients, 10).map((x) => ({ name: clip_(x && x.name, 20), amount: clip_(x && x.amount, 20) })).filter((x) => x.name),
    steps: list(a.steps, 8).map((s) => clip_(s, 120)).filter(Boolean),
    tip: clip_(a.tip, 120),
  };
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
  const ai = kind === "cook" ? cleanAi_(p.ai) : null;
  const recipe = kind === "cook" && !ai ? clip_(p.recipe, 60) : "";
  // 開頭加 ' 避免文字被試算表當成公式（例如 =、+ 開頭）
  const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = postSheet_();
    // 舊的 posts 工作表沒有 ai 欄，第一次用到時補上標題
    if (sheet.getRange(1, POST_HEAD.length).getDisplayValue() !== "ai") sheet.getRange(1, POST_HEAD.length).setValue("ai").setFontWeight("bold");
    sheet.appendRow([post.id, post.at, post.by, safe(post.name), kind, safe(post.text), img, safe(recipe), item ? JSON.stringify(item) : "", rate, "[]", ai ? JSON.stringify(ai) : ""]);
  } finally { lock.releaseLock(); }
  if (recipe) post.recipe = recipe;
  if (ai) post.ai = ai;
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
// 依序嘗試：找不到（404）或忙線（429、500、503）就換下一個。
// lite 版回應最快（幾秒內）、一人份食譜品質夠用，所以排前面；大模型只在 lite 忙線時才用
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-flash-latest"];
const AI_TIME_BUDGET = 40000;   // 已經花超過 40 秒就不再換下一個模型，避免使用者等太久
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
  const start = Date.now();
  for (const model of GEMINI_MODELS) {
    if (res && Date.now() - start > AI_TIME_BUDGET) break;
    // 2.5 系列關掉「先想再答」的思考模式：食譜用不到，關掉快很多（-latest 別名的模型不一定支援這個設定，就不加）
    const body = /^gemini-2\.5-/.test(model)
      ? { ...payload, generationConfig: { ...payload.generationConfig, thinkingConfig: { thinkingBudget: 0 } } } : payload;
    const t = Date.now();
    try {
      res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "post", contentType: "application/json", headers: { "x-goog-api-key": key },
        payload: JSON.stringify(body), muteHttpExceptions: true,
      });
    } catch (err) {     // 連線逾時等錯誤：當作忙線，換下一個
      console.warn(`Gemini ${model} 連線失敗（${err}），改用下一個模型`);
      res = { getResponseCode: () => 503, getContentText: () => String(err) };
      continue;
    }
    const c = res.getResponseCode();
    console.log(`Gemini ${model} 回 ${c}，花 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
    if (![404, 429, 500, 503].includes(c)) break;
  }
  const code = res.getResponseCode();
  if (code !== 200) {
    console.error(`Gemini ${code}: ${res.getContentText().slice(0, 500)}`);
    return { ok: false, error: code === 429 || code === 503 ? "AI 現在太多人在用，等一兩分鐘再試。" : code === 400 || code === 403 ? "AI 金鑰有問題，請檢查 GEMINI_KEY。" : "AI 暫時沒有回應，等一下再試。" };
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

// ---------- 會員：帳號存在 users 工作表，換裝置也能登入 ----------
// 密碼不存明碼：加鹽後重複雜湊。data 是這個會員的飲食紀錄、預訂、收藏、個人資料（JSON）
// salt、hash 前面加字母，避免試算表把全是數字的字串轉成數字
const USER_HEAD = ["id", "email", "name", "salt", "hash", "created", "updated", "data"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function userSheet_() {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName("users");
  if (!s) {
    s = ss.insertSheet("users");
    s.getRange(1, 1, 1, USER_HEAD.length).setValues([USER_HEAD]).setFontWeight("bold");
    s.getRange(2, 1, FORM_ROWS, USER_HEAD.length).setNumberFormat("@");
    s.setFrozenRows(1);
  }
  return s;
}
function findUser_(sheet, col, value) {
  const rows = sheet.getDataRange().getValues(), c = USER_HEAD.indexOf(col);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][c]) === value) return { row: i + 1, u: Object.fromEntries(USER_HEAD.map((h, j) => [h, rows[i][j]])) };
  }
  return null;
}
function hex_(bytes) { return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join(""); }
function pwHash_(pw, salt) {
  let h = `${salt}:${pw}`;
  for (let i = 0; i < 200; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  return "h" + h;
}
// 登入憑證：「對象.到期時間.簽章」，簽章金鑰第一次用到時自動產生，存在指令碼屬性
function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty("TOKEN_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty("TOKEN_SECRET", s); }
  return s;
}
function sign_(s) { return hex_(Utilities.computeHmacSha256Signature(s, secret_())).slice(0, 40); }
function makeToken_(sub, days) { const p = `${sub}.${Date.now() + days * 864e5}`; return `${p}.${sign_(p)}`; }
function readToken_(t, kind) {
  const [k, sub, exp, sig] = String(t || "").split(".");
  if (k !== kind || !sub || !(+exp > Date.now()) || sign_(`${k}.${sub}.${exp}`) !== sig) return "";
  return sub;
}
// 同一個帳號連續打錯密碼就先擋 10 分鐘
function tooMany_(key) { return +(CacheService.getScriptCache().get(key) || 0) >= 8; }
function failed_(key) { const c = CacheService.getScriptCache(); c.put(key, String(+(c.get(key) || 0) + 1), 600); }
function cleanData_(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "{}";
  const s = JSON.stringify(d);
  return s.length > CELL_MAX ? null : s;
}
function userOut_(u, token) {
  const parse = (s) => { try { return JSON.parse(s || "{}"); } catch (err) { return {}; } };
  return { ok: true, token, name: String(u.name), email: String(u.email), updated: +u.updated || 0, data: parse(u.data) };
}
function register_(b) {
  const email = String(b.email || "").trim().toLowerCase(), name = clip_(String(b.name || "").trim(), 20), pw = String(b.password || "");
  if (!name) return { ok: false, error: "請輸入暱稱。" };
  if (!EMAIL_RE.test(email) || email.length > 100) return { ok: false, error: "Email 格式不正確。" };
  if (pw.length < 6 || pw.length > 100) return { ok: false, error: "密碼至少要 6 個字元。" };
  const data = cleanData_(b.data);
  if (data === null) return { ok: false, error: "帶進帳號的資料太多。" };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = userSheet_();
    if (findUser_(sheet, "email", email)) return { ok: false, error: "這個 Email 已經註冊過，請直接登入。" };
    const id = "u" + Utilities.getUuid().replace(/-/g, "").slice(0, 16), salt = "s" + Utilities.getUuid().replace(/-/g, "");
    const now = Date.now();
    const u = { id, email, name, salt, hash: pwHash_(pw, salt), created: now, updated: now, data };
    sheet.appendRow(USER_HEAD.map((h) => u[h]));
    return userOut_(u, makeToken_(`u.${id}`, 60));
  } finally { lock.releaseLock(); }
}
function login_(b) {
  const email = String(b.email || "").trim().toLowerCase(), key = `lf:${email}`;
  if (tooMany_(key)) return { ok: false, error: "密碼錯太多次，請 10 分鐘後再試。" };
  const f = findUser_(userSheet_(), "email", email);
  if (!f) return { ok: false, error: "Email 或密碼不正確。", none: true };
  if (pwHash_(String(b.password || ""), String(f.u.salt)) !== String(f.u.hash)) { failed_(key); return { ok: false, error: "Email 或密碼不正確。" }; }
  return userOut_(f.u, makeToken_(`u.${f.u.id}`, 60));
}
// 打開網站時確認登入還有效；since 和伺服器一樣就不用再傳一次資料
function me_(b) {
  const id = readToken_(b.token, "u");
  const f = id && findUser_(userSheet_(), "id", id);
  if (!f) return { ok: false, error: "請重新登入。", relogin: true };
  if (+b.since && +b.since === +f.u.updated) return { ok: true, same: true, updated: +f.u.updated };
  return userOut_(f.u, b.token);
}
function saveMe_(b) {
  const id = readToken_(b.token, "u");
  if (!id) return { ok: false, error: "請重新登入。", relogin: true };
  const data = cleanData_(b.data);
  if (data === null) return { ok: false, error: "資料太多，存不下。" };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = userSheet_(), f = findUser_(sheet, "id", id);
    if (!f) return { ok: false, error: "請重新登入。", relogin: true };
    const now = Math.max(Date.now(), (+f.u.updated || 0) + 1);
    sheet.getRange(f.row, USER_HEAD.indexOf("updated") + 1, 1, 2).setValues([[now, data]]);
    return { ok: true, updated: now };
  } finally { lock.releaseLock(); }
}

// ---------- 店家後台：每家店用自己的密碼，只看得到、改得到自己的品項 ----------
// 密碼存在「專案設定 → 指令碼屬性」，名稱是 SHOP_PASS_店家id。第一次執行 setupShops 會自動產生
function setupShops() {
  const props = PropertiesService.getScriptProperties();
  const values = SpreadsheetApp.getActive().getSheetByName("listings").getDataRange().getValues();
  const shops = [...new Set(values.slice(1).map((r) => String(r[LISTING_HEAD.indexOf("shop")])).filter(Boolean))];
  shops.forEach((s) => {
    if (!props.getProperty(`SHOP_PASS_${s}`)) props.setProperty(`SHOP_PASS_${s}`, String(100000 + Math.floor(Math.random() * 900000)));
    console.log(`${s}：${props.getProperty(`SHOP_PASS_${s}`)}`);
  });
}
function shopLogin_(b) {
  const shop = String(b.shop || ""), key = `sf:${shop}`;
  if (tooMany_(key)) return { ok: false, error: "密碼錯太多次，請 10 分鐘後再試。" };
  const pass = PropertiesService.getScriptProperties().getProperty(`SHOP_PASS_${shop}`);
  if (!pass) return { ok: false, error: "這家店還沒有開通後台，請聯絡 RescuEat。" };
  if (String(b.pass || "").trim() !== pass) { failed_(key); return { ok: false, error: "店家密碼不正確。" }; }
  return { ok: true, token: makeToken_(`s.${shop}`, 14), shop };
}
function shopData_(b) {
  const shop = readToken_(b.token, "s");
  if (!shop) return { ok: false, error: "請重新登入。", relogin: true };
  const range = SpreadsheetApp.getActive().getSheetByName("listings").getDataRange();
  const values = range.getValues(), shown = range.getDisplayValues();
  const col = (h) => LISTING_HEAD.indexOf(h);
  const items = [], names = {};
  values.forEach((r, i) => {
    if (i === 0 || String(r[col("shop")]) !== shop || !r[col("id")]) return;
    names[String(r[col("id")])] = String(r[col("name")]);
    items.push({ id: String(r[col("id")]), name: String(r[col("name")]), cat: String(r[col("cat")]), price: +r[col("price")] || 0,
                 deal: +r[col("deal")] || 0, qty: +r[col("qty")] || 0, until: time_(shown[i][col("until")]) });
  });
  // 今天的預訂：只列出含有這家店品項的，而且只顯示這家店的品項
  const rs = SpreadsheetApp.getActive().getSheetByName("reservations");
  const rows = rs.getLastRow() > 1 ? rs.getRange(2, 1, rs.getLastRow() - 1, RESERVATION_HEAD.length + 1).getValues() : [];
  const today = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  const orders = rows.filter((r) => r[0] instanceof Date && Utilities.formatDate(r[0], "Asia/Taipei", "yyyy-MM-dd") === today)
    .map((r) => ({ time: Utilities.formatDate(r[0], "Asia/Taipei", "HH:mm"), code: String(r[1]),
                   items: String(r[2]).split(",").filter((id) => names[id]).map((id) => names[id]), status: String(r[4] || "") }))
    .filter((o) => o.items.length).reverse();
  return { ok: true, shop, items, orders };
}
function shopSave_(b) {
  const shop = readToken_(b.token, "s");
  if (!shop) return { ok: false, error: "請重新登入。", relogin: true };
  const changes = Array.isArray(b.items) ? b.items.slice(0, 100) : [];
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName("listings"), values = sheet.getDataRange().getValues();
    const col = (h) => LISTING_HEAD.indexOf(h);
    for (const c of changes) {
      const i = values.findIndex((r, n) => n > 0 && String(r[col("id")]) === String(c.id));
      if (i < 0 || String(values[i][col("shop")]) !== shop) return { ok: false, error: "只能修改自己店裡的品項。" };
      const price = +values[i][col("price")] || 0, name = values[i][col("name")];
      if ("qty" in c && !(Number.isInteger(+c.qty) && +c.qty >= 0 && +c.qty <= 999)) return { ok: false, error: `${name}：份數要是 0 到 999 的整數。` };
      if ("deal" in c && !(+c.deal > 0 && +c.deal <= price)) return { ok: false, error: `${name}：惜食價要大於 0，而且不能高於原價 $${price}。` };
      if ("until" in c && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(c.until))) return { ok: false, error: `${name}：取餐截止請填像 19:30 的時間。` };
    }
    for (const c of changes) {
      const i = values.findIndex((r, n) => n > 0 && String(r[col("id")]) === String(c.id));
      if ("qty" in c) sheet.getRange(i + 1, col("qty") + 1).setValue(+c.qty);
      if ("deal" in c) sheet.getRange(i + 1, col("deal") + 1).setValue(+c.deal);
      if ("until" in c) sheet.getRange(i + 1, col("until") + 1).setNumberFormat("@").setValue(time_(c.until));
    }
  } finally { lock.releaseLock(); }
  return shopData_(b);
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
