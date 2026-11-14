"""
把營養資料分析的成果轉成前端可直接載入的 JS 資料檔（data/*.js）。
執行：python scripts/build_web_data.py   （需先跑過 analysis/run_pipeline.py）

產出：
  data/foods.js     食藥署食品營養成分（清理後 2,207 項，每 100 g）
  data/dris.js      國健署 DRIs 第八版 16 歲以上成人需求
  data/stats.js     資料集分析摘要（清理、分類統計）
  data/shops.js     合作店家（座標、營業時間）
  data/listings.js  示範剩食品項（價格取自已確認的官方菜單）
  data/recipes.js   示範剩食料理（營養以食藥署資料計算）
  data/meals.js     常用餐點（我的營養一鍵記錄，組成取自 meal_mapping.csv）
"""
import json
import math
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
AN = ROOT / "analysis" / "data"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

KEYS = ["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg",
        "calcium_mg", "iron_mg", "vitC_mg"]


def write_js(name, var, obj):
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    (OUT / f"{name}.js").write_text(
        f"// 自動產生：scripts/build_web_data.py，請勿手動修改\nwindow.{var} = {txt};\n", encoding="utf-8")
    print(f"data/{name}.js  {len(txt)/1024:.0f} KB")


def clean(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), 2)


# ---------- 食材資料庫 ----------
foods = pd.read_csv(AN / "processed" / "foods_tagged.csv")
food_rows = []
for _, r in foods.iterrows():
    food_rows.append({
        "id": r["food_id"], "n": r["name"], "a": "" if pd.isna(r["alias"]) else str(r["alias"]),
        "c": r["tfnd_category"], "g": r["food_group"],
        **{k: clean(r[k]) for k in KEYS},
    })
write_js("foods", "RE_FOODS", food_rows)
F = {r["id"]: r for r in food_rows}


def estimate(parts):
    """parts = [(食藥署整合編號, 克數), ...] → 估算營養（四捨五入）"""
    tot = {k: 0.0 for k in KEYS}
    for fid, g in parts:
        f = F[fid]
        for k in KEYS:
            tot[k] += (f[k] or 0) * g / 100
    return {k: round(v, 1) for k, v in tot.items()}


# ---------- DRIs ----------
dris = pd.read_csv(AN / "reference" / "dris_adult.csv", comment="#", encoding="utf-8-sig")
write_js("dris", "RE_DRIS", json.loads(dris.to_json(orient="records", force_ascii=False)))

# ---------- 資料集分析摘要 ----------
report = (AN / "processed" / "clean_report.txt").read_text(encoding="utf-8")
def num(label):
    m = re.search(rf"{label}：(\d+)", report)
    return int(m.group(1)) if m else None
cov = dict(re.findall(r"  (\w+)：([\d.]+)%", report))
group_counts = foods["food_group"].value_counts().to_dict()
prot = foods[(foods["food_group"] == "蛋白質") & (foods["energy_kcal"] > 40)].nlargest(8, "protein_per_100kcal")
fiber = foods[(foods["food_group"] == "蔬菜")].nlargest(8, "fiber_g")
write_js("stats", "RE_STATS", {
    "rawRows": num("原始列數"), "rawFoods": num("原始食材數"), "kept": num("保留食材數"),
    "droppedCore": num("剔除_核心營養素缺值"), "droppedSparse": num("剔除_缺值比例過高"),
    "imputedFiber": num("fiber_g"), "imputedB12": num("vitB12_ug"),
    "coverage": {k: float(v) for k, v in cov.items()},
    "groups": group_counts,
    "topProtein": [{"n": r["name"], "v": round(r["protein_per_100kcal"], 1)} for _, r in prot.iterrows()],
    "topFiber": [{"n": r["name"], "v": round(r["fiber_g"], 1)} for _, r in fiber.iterrows()],
})

# ---------- 合作店家（座標與營業時間查自 Google 地圖；楽坡、GET POWER 2026/11/01，蛋白盒子、雞肉本家 2026/11/09） ----------
# pin：地圖標籤往哪個方向展開（ne 右上、nw 左上、sw 左下、se 右下），正門附近三家店相距不到 100 公尺，分開方向才不會疊在一起
shops = [
    {"id": "bonbox", "name": "楽坡 BonBox 政大店", "short": "楽坡 BonBox", "pin": "nw", "type": "健康餐盒", "addr": "指南路二段18號", "lat": 24.9878084, "lng": 121.5744771,
     "hours": "10:30–13:30、16:00–19:30", "close": "19:30", "status": "示範上架",
     "menuSource": "https://bonbox.tw/menu/", "menuDate": "2026-07-13"},
    {"id": "getpower", "name": "GET POWER 給力盒子 政大店", "short": "GET POWER", "pin": "sw", "type": "健康餐盒", "addr": "集英樓", "lat": 24.9873122, "lng": 121.5743977,
     "hours": "10:30–14:00、16:00–18:30", "close": "18:30", "status": "示範上架",
     "menuSource": "https://www.foodpanda.com.tw/restaurant/b933/get-power-gei-li-he-zi-zheng-da-dian-b933", "menuDate": "2026-11-01"},
    {"id": "proteinbox", "name": "蛋白盒子 台北木柵店", "short": "蛋白盒子", "type": "健康餐盒", "addr": "木柵路三段87號1樓", "lat": 24.9888302, "lng": 121.5677108,
     "hours": "週一至週五 11:00–14:00、16:30–20:00（週末公休）", "close": "20:00", "status": "示範上架",
     "menuSource": "https://order.ocard.co/theproteinbox/mWgWOm", "menuDate": "2026-11-09"},
    {"id": "chickenhome", "name": "雞肉本家 政大店", "short": "雞肉本家", "type": "雞肉飯", "addr": "指南路二段81號", "lat": 24.9878824, "lng": 121.575156,
     "hours": "每日 11:00–20:30", "close": "20:30", "status": "示範上架",
     "menuSource": "https://shop.ichefpos.com/store/4OJ-oIjT/ordering", "menuDate": "2026-11-09"},
]
write_js("shops", "RE_SHOPS", {"gate": {"lat": 24.98763, "lng": 121.57618}, "shops": shops})

# ---------- 示範剩食品項 ----------
# 原價：楽坡官網菜單（2026/07/13）、GET POWER foodpanda 原價（2026/11/01）、
#       蛋白盒子台北木柵店官方線上點餐門市價（2026/11/09）、雞肉本家官方 iCHEF 線上菜單門市價（2026/11/09，頁面未標分店）。
# 惜食價、剩餘份數、取餐截止為示範值；正式上線改由店家每日上架。
# 營養：店家有標示的用官方數字（source=official，楽坡營養表 2026/02/09 版）；
# 官方沒列的才用食藥署資料 × 假設份量估算（source=estimate）。
# 蛋白盒子用官網「最新菜單」的熱量與蛋白質（2026/11/09 查詢）；香煎雞胸系列官網只給三種口味的範圍，取中間值並標為估算。
# 雞肉本家沒有公布營養標示，熱量與蛋白質留空，畫面會顯示「營養待店家標示」。
# 楽坡菜單註明「加購商品恕不單售」，這裡假設打烊前可單獨出清，正式上線前要和店家確認。
DEMO_DISCOUNT = 0.8
L = []
def add(shop, name, cat, price, qty, until, official=None, est=None, est_note="", approx=None, micro=None, fried=False):
    item = {"id": f"{shop}-{len(L)+1}", "shop": shop, "name": name, "cat": cat, "price": price,
            "deal": round(price * DEMO_DISCOUNT), "qty": qty, "until": until,   # 照實打折，四捨五入到整數元
            "fried": fried, "micro": micro}
    if official:
        item.update({"kcal": official[0], "protein": official[1], "nsrc": "official"})
    elif est:
        n = estimate(est)
        item.update({"kcal": round(n["energy_kcal"]), "protein": round(n["protein_g"], 1),
                     "nsrc": "estimate", "nnote": est_note})
    elif approx:
        item.update({"kcal": approx[0], "protein": approx[1], "nsrc": "estimate", "nnote": approx[2]})
    L.append(item)

add("bonbox", "威力雞胸弁當", "完整餐盒", 130, 2, "19:30", official=(504, 31))
add("bonbox", "楽坡雞腿弁當", "完整餐盒", 140, 1, "19:30", official=(557, 30))
add("bonbox", "舒浮彩蔬弁當（可素）", "完整餐盒", 105, 2, "19:30", official=(431, 15))
add("bonbox", "超級白肉蛋白（無飯）", "蛋白質", 199, 1, "19:30", official=(651, 68))
add("bonbox", "加購 威力雞胸", "蛋白質", 49, 3, "19:30", official=(73, 16))
add("bonbox", "加購 楽坡雞腿", "蛋白質", 59, 2, "19:30", official=(126, 15))
add("bonbox", "加購 水煮蛋（半顆）", "蛋白質", 10, 4, "19:30", official=(50, 5))
add("bonbox", "加購 杏鮑菇", "蔬菜", 39, 2, "19:30", est=[("G13002", 100)], est_note="官方營養表未列，以「杏鮑菇平均值」100 g 估算")
add("bonbox", "加購 蔬菜", "蔬菜", 30, 3, "19:30", official=(42, 3))
add("bonbox", "加購 黑金麥飯", "主食", 20, 4, "19:30", official=(282, 6))
add("bonbox", "加購 地瓜泥球", "主食", 20, 3, "19:30", official=(46, 1))
add("getpower", "椒鹽水煮雞胸餐盒", "完整餐盒", 220, 2, "18:15", official=(605, 43), micro=True)
add("getpower", "泰式打拋雞胸餐盒", "完整餐盒", 220, 1, "18:15", official=(596, 41), micro=True)
add("getpower", "爐烤鮮時蔬餐盒", "完整餐盒", 190, 2, "18:15", official=(510, 16), micro=True)
PB_RANGE = "官網只標示香煎雞胸系列三種口味為 526–535 大卡、蛋白質 29.9–30.6 g，取中間值"
add("proteinbox", "香煎黑胡椒雞胸餐盒", "完整餐盒", 125, 3, "19:45", approx=(530, 30.2, PB_RANGE))
add("proteinbox", "香煎海苔雞胸餐盒", "完整餐盒", 125, 2, "19:45", approx=(530, 30.2, PB_RANGE))
add("proteinbox", "青蔥海鹽雞胸餐盒", "完整餐盒", 135, 2, "19:45", official=(581, 30.1))
add("proteinbox", "四川麻辣雞胸餐盒", "完整餐盒", 135, 1, "19:45", official=(597, 32.0))
add("proteinbox", "檸檬雞腿排餐盒", "完整餐盒", 135, 2, "19:45", official=(565, 28.6))
add("proteinbox", "漢方藥膳嫩雞腿餐盒", "完整餐盒", 125, 1, "19:45", official=(602, 33.2))
add("proteinbox", "減鹽味噌烤鱸魚餐盒", "完整餐盒", 165, 1, "19:45", official=(592, 43.1))
add("proteinbox", "素排骨餐盒", "完整餐盒", 130, 1, "19:45", official=(722, 27.7))
add("proteinbox", "單點 黑米飯", "主食", 10, 4, "19:45")
add("proteinbox", "單點 蒸地瓜", "主食", 30, 2, "19:45")
add("proteinbox", "單點 青花菜", "蔬菜", 30, 2, "19:45")
# 雞肉本家沒有公布營養，以食藥署資料 × 本專案假設的份量估算：
#   雞肉＝去骨雞腿肉（清腿平均值）100 g；獅子頭依食記「3 肥 7 瘦」用豬絞肉(70％瘦肉率)，一顆 90 g；
#   獅子頭飯以 2 顆計（單點一顆 $43，兩顆約等於雞肉一份 $90）；白飯一碗 200 g；咖哩醬以咖哩塊 20 g 計；
#   配菜依食記為高麗菜 50 g、油豆腐 30 g、半顆滷蛋 27 g，另計蔥油（雞油）5 g。份量待實際秤重或向店家確認。
CH_RICE, CH_CHICKEN, CH_BALL = ("A0550601", 200), ("I04042", 100), ("I0310401", 90)
CH_SIDES = [("E30001", 50), ("R4701101", 30), ("K01201", 27), ("M0300101", 5)]
CH_NOTE = "店家未公布營養，以食藥署資料與假設份量估算："
add("chickenhome", "好吃雞肉飯", "完整餐盒", 125, 3, "20:15", est=[CH_RICE, CH_CHICKEN, *CH_SIDES],
    est_note=CH_NOTE + "白飯 200 g、去骨雞腿肉 100 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g")
add("chickenhome", "獅子頭飯", "完整餐盒", 125, 2, "20:15", est=[CH_RICE, ("I0310401", 180), *CH_SIDES],
    est_note=CH_NOTE + "白飯 200 g、獅子頭 2 顆（豬絞肉 7 瘦 3 肥，共 180 g）、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g")
add("chickenhome", "咖哩雞肉飯", "完整餐盒", 145, 2, "20:15", est=[CH_RICE, CH_CHICKEN, ("P0200501", 20), *CH_SIDES],
    est_note=CH_NOTE + "白飯 200 g、去骨雞腿肉 100 g、咖哩塊 20 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g")
add("chickenhome", "獅子頭雞肉飯", "完整餐盒", 165, 1, "20:15", est=[CH_RICE, CH_CHICKEN, CH_BALL, *CH_SIDES],
    est_note=CH_NOTE + "白飯 200 g、去骨雞腿肉 100 g、獅子頭 1 顆 90 g、高麗菜 50 g、油豆腐 30 g、滷蛋半顆、蔥油 5 g")
add("chickenhome", "單點 雞肉一份", "蛋白質", 90, 2, "20:15", est=[CH_CHICKEN], est_note=CH_NOTE + "去骨雞腿肉 100 g")
add("chickenhome", "單點 炒時蔬", "蔬菜", 40, 3, "20:15", est=[("E30001", 100), ("M1100101", 5)], est_note=CH_NOTE + "高麗菜 100 g、炒菜油 5 g")
add("chickenhome", "單點 白飯", "主食", 15, 4, "20:15", est=[CH_RICE], est_note=CH_NOTE + "白飯 200 g")
write_js("listings", "RE_LISTINGS", {"discount": DEMO_DISCOUNT, "items": L})

# Apps Script 的 setup() 種子資料跟著 data/listings.js 更新，避免試算表和示範資料不一致
CODE = ROOT / "apps-script" / "Code.gs"
seed = ",\n".join("  " + json.dumps([x["id"], x["shop"], x["name"], x["cat"], x["price"], x["deal"], x["qty"], x["until"],
                                       x.get("kcal", ""), x.get("protein", ""), x.get("nsrc", ""), x.get("nnote", ""),
                                       bool(x["micro"]), bool(x["fried"])], ensure_ascii=False) for x in L)
code = CODE.read_text(encoding="utf-8")
code, n = re.subn(r"(const SEED = \[\n).*?(\n\];)", lambda m: m.group(1) + seed + m.group(2), code, flags=re.S)
assert n == 1, "Code.gs 找不到 SEED 區塊"
CODE.write_text(code, encoding="utf-8")
print(f"apps-script/Code.gs  SEED {len(L)} 筆")

# ---------- 示範剩食料理（營養由食藥署資料計算） ----------
R = [
    {"name": "微波番茄蛋燕麥粥", "equip": ["微波爐"], "min": 8,
     "parts": [("A0810101", 40, "燕麥片"), ("K01001", 55, "雞蛋 1 顆"), ("E74001", 150, "番茄 1 顆")],
     "steps": ["番茄切小丁，和燕麥片、150 ml 水放進微波碗", "微波 2 分鐘後拌勻", "打入雞蛋攪散", "再微波 1 分 30 秒到蛋熟", "加少許鹽或胡椒調味"]},
    {"name": "電鍋豆腐蒸蛋", "equip": ["電鍋"], "min": 15,
     "parts": [("R4700901", 150, "傳統豆腐 1 塊"), ("K01001", 55, "雞蛋 1 顆")],
     "steps": ["豆腐切塊鋪在碗底", "雞蛋加 100 ml 水打散，倒在豆腐上", "外鍋放半杯水，蓋上蒸到開關跳起", "淋一點醬油即可"]},
    {"name": "雞胸地瓜沙拉", "equip": ["免開火"], "min": 5,
     "parts": [("I04024", 100, "已煮熟雞胸肉"), ("B0400601", 100, "已蒸熟地瓜"), ("E53001", 80, "生菜"), ("E74001", 50, "番茄")],
     "steps": ["生菜洗淨撕小片", "雞胸肉撕條、地瓜切塊", "番茄切片，全部放進碗裡", "淋上少量和風醬拌勻"]},
    {"name": "快煮鍋青菜蛋花湯麵", "equip": ["快煮鍋"], "min": 10,
     "parts": [("R2001401", 150, "濕麵條"), ("E3200602", 100, "小白菜"), ("K01001", 55, "雞蛋 1 顆")],
     "steps": ["快煮鍋煮 500 ml 水", "水滾後放麵條煮 3 分鐘", "放進切段的小白菜", "淋入打散的蛋液，加鹽調味"]},
    {"name": "微波杏鮑菇雞丁", "equip": ["微波爐"], "min": 8,
     "parts": [("G13002", 100, "杏鮑菇"), ("I04024", 100, "雞胸肉")],
     "steps": ["杏鮑菇和雞胸肉切小丁", "加 1 小匙醬油、少許胡椒抓勻", "蓋保鮮膜留小縫", "微波 4 分鐘，拌一拌再微波 1 分鐘"]},
    {"name": "番茄蛋三明治", "equip": ["免開火"], "min": 5,
     "parts": [("Q1000101", 60, "吐司 2 片"), ("K0111101", 55, "水煮蛋 1 顆"), ("E74001", 50, "番茄")],
     "steps": ["水煮蛋切片", "番茄切片", "依序夾進兩片吐司中", "對切即可"]},
    # ---- 微波爐 ----
    {"name": "微波雞腿高麗菜炒飯", "equip": ["微波爐"], "min": 8,
     "parts": [("A0550601", 200, "剩白飯 1 碗"), ("I04042", 80, "雞腿肉（切丁）"), ("E30001", 60, "高麗菜"), ("K01001", 55, "雞蛋 1 顆"), ("P0700401", 5, "醬油")],
     "steps": ["高麗菜切絲，雞腿肉切小丁", "白飯撥鬆放進微波碗，鋪上高麗菜和雞腿肉", "打入雞蛋拌勻，淋上醬油", "蓋保鮮膜留小縫，微波 2 分鐘", "拌一拌再微波 1 分 30 秒"]},
    {"name": "微波青花菜滑蛋", "equip": ["微波爐"], "min": 6,
     "parts": [("E5800402", 80, "青花菜"), ("K01001", 110, "雞蛋 2 顆"), ("L01021", 30, "鮮奶")],
     "steps": ["青花菜切小朵，加 1 大匙水微波 1 分鐘", "雞蛋加鮮奶和少許鹽打散，倒在青花菜上", "微波 40 秒後取出攪拌", "再微波 30 秒到蛋剛好凝固"]},
    {"name": "微波地瓜鮮奶", "equip": ["微波爐"], "min": 5,
     "parts": [("B0400601", 120, "已蒸熟地瓜"), ("L01021", 240, "鮮奶 1 杯")],
     "steps": ["地瓜去皮切小塊，用湯匙壓成泥", "倒入鮮奶攪拌均勻", "微波 1 分 30 秒，取出拌勻即可"]},
    {"name": "微波鮪魚玉米烘蛋", "equip": ["微波爐"], "min": 6,
     "parts": [("K01001", 110, "雞蛋 2 顆"), ("J0414601", 40, "鮪魚"), ("R1600101", 40, "玉米粒")],
     "steps": ["雞蛋打散，加一點鹽和胡椒", "拌入瀝乾的鮪魚和玉米粒", "倒進抹油的微波碗，微波 1 分 30 秒", "取出翻面再微波 30 秒"]},
    # ---- 電鍋 ----
    {"name": "電鍋白菜滷獅子頭", "equip": ["電鍋"], "min": 15,
     "parts": [("I0310401", 90, "獅子頭 1 顆"), ("E3300104", 200, "大白菜"), ("E02001", 30, "胡蘿蔔"), ("P0700401", 15, "醬油")],
     "steps": ["大白菜切大片鋪在碗底，胡蘿蔔切片", "放上獅子頭，淋醬油並加 100 ml 水", "外鍋放 1 杯水，蒸到開關跳起", "燜 3 分鐘讓白菜吸飽湯汁"]},
    {"name": "電鍋香菇雞腿蒸高麗菜", "equip": ["電鍋"], "min": 15,
     "parts": [("I04042", 120, "去骨雞腿肉"), ("E30001", 150, "高麗菜"), ("G08001", 30, "香菇"), ("P0700401", 10, "醬油")],
     "steps": ["雞腿肉切塊，用醬油抓醃 5 分鐘", "高麗菜撕片鋪碗底，香菇切片", "放上雞腿肉，外鍋放 1 杯水", "蒸到開關跳起即可"]},
    {"name": "電鍋番茄豆腐雞湯", "equip": ["電鍋"], "min": 15,
     "parts": [("E74001", 150, "番茄 1 顆"), ("R4701201", 150, "嫩豆腐"), ("I04024", 80, "雞胸肉"), ("E1900102", 5, "薑片")],
     "steps": ["番茄切塊，豆腐和雞胸肉切丁", "全部放進內鍋，加 400 ml 水和薑片", "外鍋放 1 杯水，蒸到開關跳起", "加鹽調味"]},
    {"name": "電鍋南瓜燕麥粥", "equip": ["電鍋"], "min": 15,
     "parts": [("E63001", 100, "南瓜"), ("A0810101", 40, "燕麥片"), ("L01021", 200, "鮮奶")],
     "steps": ["南瓜去籽切小塊", "南瓜和燕麥片放進內鍋，加 150 ml 水", "外鍋放半杯水，蒸到開關跳起", "倒入鮮奶，把南瓜壓碎拌勻"]},
    # ---- 快煮鍋 ----
    {"name": "快煮鍋味噌豆腐湯", "equip": ["快煮鍋"], "min": 8,
     "parts": [("R4701201", 150, "嫩豆腐"), ("P1200101", 20, "味噌"), ("F07001", 30, "海帶"), ("E23001", 5, "青蔥")],
     "steps": ["快煮鍋煮 400 ml 水", "水滾後放入切丁的豆腐和海帶，煮 2 分鐘", "關火後用湯匙把味噌化開拌入", "撒上蔥花"]},
    {"name": "快煮鍋泡菜冬粉", "equip": ["快煮鍋"], "min": 10,
     "parts": [("R4600201", 40, "冬粉 1 把"), ("R4400301", 80, "韓式泡菜"), ("K01001", 55, "雞蛋 1 顆"), ("E3200602", 60, "小白菜")],
     "steps": ["冬粉先泡水 5 分鐘", "快煮鍋煮 400 ml 水，放入泡菜煮滾", "放冬粉和切段的小白菜煮 2 分鐘", "打入雞蛋，蓋上鍋蓋燜 1 分鐘"]},
    {"name": "快煮鍋雞肉蔬菜粥", "equip": ["快煮鍋"], "min": 12,
     "parts": [("A0550601", 150, "剩白飯"), ("I04024", 80, "雞胸肉"), ("E3200602", 60, "小白菜"), ("E1900102", 5, "薑絲")],
     "steps": ["快煮鍋放白飯和 400 ml 水，煮滾後轉保溫", "雞胸肉切絲，和薑絲一起放入煮 5 分鐘", "放入切碎的小白菜煮 1 分鐘", "加鹽調味"]},
    {"name": "快煮鍋雞腿烏龍麵", "equip": ["快煮鍋"], "min": 10,
     "parts": [("R2001301", 200, "冷凍烏龍麵"), ("I04042", 80, "雞腿肉"), ("E30001", 60, "高麗菜"), ("P0700401", 10, "醬油")],
     "steps": ["快煮鍋煮 500 ml 水，放入切塊的雞腿肉煮 4 分鐘", "放入烏龍麵和高麗菜煮 3 分鐘", "淋醬油調味"]},
    # ---- 免開火 ----
    {"name": "香蕉隔夜燕麥", "equip": ["免開火"], "min": 5,
     "parts": [("A0810101", 40, "燕麥片"), ("L01021", 200, "鮮奶"), ("D08001", 60, "香蕉半根")],
     "steps": ["燕麥片和鮮奶倒進有蓋的杯子拌勻", "蓋上放冰箱一晚", "隔天早上切香蕉片放上即可"]},
    {"name": "優格水果杯", "equip": ["免開火"], "min": 3,
     "parts": [("L0322101", 150, "優格"), ("D08001", 60, "香蕉半根"), ("D15002", 80, "芭樂"), ("A0810101", 20, "燕麥片")],
     "steps": ["香蕉和芭樂切小塊", "優格倒進杯子", "鋪上水果和燕麥片"]},
    {"name": "鮪魚蛋沙拉吐司", "equip": ["免開火"], "min": 5,
     "parts": [("Q1000101", 60, "吐司 2 片"), ("J0414601", 40, "鮪魚"), ("K0111101", 55, "水煮蛋 1 顆"), ("P1100102", 10, "沙拉醬"), ("E53001", 30, "生菜")],
     "steps": ["水煮蛋壓碎，和瀝乾的鮪魚、沙拉醬拌勻", "吐司鋪上生菜", "抹上鮪魚蛋沙拉，蓋上另一片吐司", "對切即可"]},
    {"name": "皮蛋豆腐", "equip": ["免開火"], "min": 3,
     "parts": [("R4701201", 150, "嫩豆腐"), ("K01131", 50, "皮蛋 1 顆"), ("P0700701", 10, "醬油膏"), ("E23001", 5, "青蔥")],
     "steps": ["嫩豆腐倒扣在盤子上", "皮蛋剝殼切小塊放在豆腐上", "淋上醬油膏，撒蔥花"]},
    {"name": "鮪魚飯糰", "equip": ["免開火"], "min": 5,
     "parts": [("A0550601", 150, "剩白飯（溫熱）"), ("J0414601", 40, "鮪魚"), ("P1100102", 8, "沙拉醬"), ("F9900201", 3, "海苔 1 片")],
     "steps": ["鮪魚瀝乾，和沙拉醬拌勻", "手沾一點鹽水，取一半白飯攤平", "放上鮪魚餡，蓋上另一半白飯捏成三角形", "包上海苔即可"]},
]
recipes = []
for r in R:
    n = estimate([(fid, g) for fid, g, _ in r["parts"]])
    recipes.append({"name": r["name"], "equip": r["equip"], "min": r["min"], "steps": r["steps"],
                    "items": [{"label": lab, "food": F[fid]["n"], "g": g, "group": F[fid]["g"]} for fid, g, lab in r["parts"]],
                    "kcal": round(n["energy_kcal"]), "protein": round(n["protein_g"], 1)})
write_js("recipes", "RE_RECIPES", recipes)

# ---------- 常用餐點（我的營養一鍵記錄）：組成與克數取自分析的餐點對應表，食材已人工指定食藥署整合編號 ----------
MEAL_TYPES = ["早餐店", "便利商店", "便當店", "自助餐", "小吃店", "麵店"]
mm = pd.read_csv(AN / "reference" / "meal_mapping.csv", encoding="utf-8-sig", dtype={"指定整合編號": str})
missing = sorted(set(mm["指定整合編號"]) - set(F))
assert not missing, f"meal_mapping.csv 有食藥署資料庫裡找不到的編號：{missing}"
meals = [{"name": name, "type": g["店家類型"].iloc[0],
          "parts": [{"id": r["指定整合編號"], "g": int(r["克數"]), "label": r["食材關鍵字"]} for _, r in g.iterrows()]}
         for name, g in mm.groupby("餐點名稱", sort=False)]
meals.sort(key=lambda m: MEAL_TYPES.index(m["type"]))
write_js("meals", "RE_MEALS", meals)
