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

# ---------- 合作店家（2026/11/01 Google 地圖查詢之座標與平日營業時間） ----------
shops = [
    {"id": "jiawei", "name": "佳味自助餐", "type": "自助餐", "addr": "指南路二段155號", "lat": 24.98744, "lng": 121.577428,
     "hours": "10:00–14:00、16:30–20:00", "close": "20:00", "status": "洽談中"},
    {"id": "laila", "name": "來來快餐", "type": "快餐", "addr": "政大正門旁", "lat": 24.9879032, "lng": 121.5765397,
     "hours": "11:00–14:00、17:00–20:00", "close": "20:00", "status": "洽談中"},
    {"id": "yunhao", "name": "允浩自助餐", "type": "自助餐（校內）", "addr": "政大校內（位置待確認）", "lat": 24.9796504, "lng": 121.5715547,
     "hours": "10:30–19:00", "close": "19:00", "status": "洽談中"},
    {"id": "bonbox", "name": "楽坡 BonBox 政大店", "type": "健康餐盒", "addr": "指南路二段18號", "lat": 24.9878084, "lng": 121.5744771,
     "hours": "10:30–13:30、16:00–19:30", "close": "19:30", "status": "示範上架",
     "menuSource": "https://bonbox.tw/menu/", "menuDate": "2026-07-13"},
    {"id": "getpower", "name": "GET POWER 給力盒子 政大店", "type": "健康餐盒", "addr": "集英樓", "lat": 24.9873122, "lng": 121.5743977,
     "hours": "10:30–14:00、16:00–18:30", "close": "18:30", "status": "示範上架",
     "menuSource": "https://www.foodpanda.com.tw/restaurant/b933/get-power-gei-li-he-zi-zheng-da-dian-b933", "menuDate": "2026-11-01"},
    {"id": "tongyang", "name": "同洋燒臘", "type": "燒臘", "addr": "指南路二段45巷2弄1號", "lat": 24.9882645, "lng": 121.57444,
     "hours": "11:00–14:00、17:00–20:00", "close": "20:00", "status": "洽談中"},
    {"id": "xiji", "name": "喜記港式燒臘", "type": "燒臘", "addr": "指南路二段131號", "lat": 24.9875721, "lng": 121.576922,
     "hours": "11:00–14:00、16:30–19:30", "close": "19:30", "status": "洽談中"},
    {"id": "tdb", "name": "TDB 傳統甜點麵包店", "type": "麵包店", "addr": "指南路二段119巷16號", "lat": 24.9882188, "lng": 121.5764861,
     "hours": "11:00–20:00（週六休）", "close": "20:00", "status": "洽談中"},
]
write_js("shops", "RE_SHOPS", {"gate": {"lat": 24.98763, "lng": 121.57618}, "shops": shops})

# ---------- 示範剩食品項 ----------
# 原價：楽坡官網菜單（2026/07/13）、GET POWER foodpanda 原價（2026/11/01）。
# 惜食價、剩餘份數、取餐截止為示範值；正式上線改由店家每日上架。
# 營養：餐盒用店家官方標示（source=official）；單點品項用食藥署資料 × 假設份量估算（source=estimate）。
DEMO_DISCOUNT = 0.7
L = []
def add(shop, name, cat, price, qty, until, official=None, est=None, est_note="", micro=None, fried=False):
    item = {"id": f"{shop}-{len(L)+1}", "shop": shop, "name": name, "cat": cat, "price": price,
            "deal": int(round(price * DEMO_DISCOUNT / 5) * 5), "qty": qty, "until": until,
            "fried": fried, "micro": micro}
    if official:
        item.update({"kcal": official[0], "protein": official[1], "nsrc": "official"})
    elif est:
        n = estimate(est)
        item.update({"kcal": round(n["energy_kcal"]), "protein": round(n["protein_g"], 1),
                     "nsrc": "estimate", "nnote": est_note})
    L.append(item)

add("bonbox", "威力雞胸弁當", "完整餐盒", 130, 2, "19:15", official=(504, 31))
add("bonbox", "楽坡雞腿弁當", "完整餐盒", 140, 1, "19:15", official=(557, 30))
add("bonbox", "舒浮彩蔬弁當（可素）", "完整餐盒", 105, 2, "19:15", official=(431, 15))
add("bonbox", "超級白肉蛋白（無飯）", "蛋白質", 199, 1, "19:15", official=(651, 68))
add("bonbox", "單點 威力雞胸", "蛋白質", 49, 3, "19:15", est=[("I04024", 100)], est_note="以「去皮清肉平均值」100 g 估算")
add("bonbox", "單點 楽坡雞腿", "蛋白質", 59, 2, "19:15", est=[("I04042", 100)], est_note="以「清腿平均值」100 g 估算")
add("bonbox", "加購 水煮蛋（半顆）", "蛋白質", 10, 4, "19:15", est=[("K01001", 25)], est_note="以「雞蛋平均值」25 g 估算")
add("bonbox", "單點 杏鮑菇", "蔬菜", 39, 2, "19:15", est=[("G13002", 100)], est_note="以「杏鮑菇平均值」100 g 估算")
add("bonbox", "加購 蔬菜", "蔬菜", 30, 3, "19:15", est=[("E5800101", 100)], est_note="以「花椰菜」100 g 估算")
add("bonbox", "加購 黑金麥飯", "主食", 20, 4, "19:15", est=[("A0550601", 150)], est_note="資料庫無麥飯，以「白飯」150 g 估算")
add("bonbox", "加購 地瓜泥球", "主食", 20, 3, "19:15", est=[("B0400601", 80)], est_note="以「黃肉甘藷」80 g 估算")
add("getpower", "椒鹽水煮雞胸餐盒", "完整餐盒", 220, 2, "18:15", official=(605, 43), micro=True)
add("getpower", "泰式打拋雞胸餐盒", "完整餐盒", 220, 1, "18:15", official=(596, 41), micro=True)
add("getpower", "爐烤鮮時蔬餐盒", "完整餐盒", 190, 2, "18:15", official=(510, 16), micro=True)
write_js("listings", "RE_LISTINGS", {"discount": DEMO_DISCOUNT, "items": L})

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
]
recipes = []
for r in R:
    n = estimate([(fid, g) for fid, g, _ in r["parts"]])
    recipes.append({"name": r["name"], "equip": r["equip"], "min": r["min"], "steps": r["steps"],
                    "items": [{"label": lab, "food": F[fid]["n"], "g": g, "group": F[fid]["g"]} for fid, g, lab in r["parts"]],
                    "kcal": round(n["energy_kcal"]), "protein": round(n["protein_g"], 1)})
write_js("recipes", "RE_RECIPES", recipes)
