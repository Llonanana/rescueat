"""
步驟 4：個人化營養缺口計算 + 預算內推薦
  1. 個人每日需求：熱量（DRIs 熱量表 或 身高體重公式 × DRIs 活動係數）＋ DRIs 各營養素
  2. 缺口 = 每日需求 − 今日已攝取
  3. 下一餐應補多少 = 缺口 × 這一餐佔剩餘餐次的比例
  4. 在預算內的餐點中，挑「最能補足缺口、又不讓熱量/鈉超標」的組合
所有數字都來自：TFND（餐點營養）、DRIs（需求）、台師大六大類份量（均衡判斷）。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import config as C

# 每日需求中屬於「要補足」的營養素（DRIs 表有填值才會被使用）
GAP_NUTRIENTS = ["protein_g", "fiber_g", "calcium_mg", "iron_mg", "zinc_mg", "magnesium_mg",
                 "vitA_ugRE", "vitC_mg", "vitB1_mg", "vitB2_mg", "vitB6_mg", "vitB12_ug", "folate_ug",
                 "niacin_mg", "vitE_mg", "potassium_mg", "phosphorus_mg", "vitD_ug", "vitK_ug", "carb_g"]

LABELS = {
    "energy_kcal": "熱量(kcal)", "protein_g": "蛋白質(g)", "fat_g": "脂肪(g)", "carb_g": "碳水化合物(g)",
    "fiber_g": "膳食纖維(g)", "sodium_mg": "鈉(mg)", "calcium_mg": "鈣(mg)", "iron_mg": "鐵(mg)",
    "zinc_mg": "鋅(mg)", "magnesium_mg": "鎂(mg)", "vitA_ugRE": "維生素A(μg RE)", "vitC_mg": "維生素C(mg)",
    "vitB1_mg": "維生素B1(mg)", "vitB2_mg": "維生素B2(mg)", "vitB6_mg": "維生素B6(mg)",
    "vitB12_ug": "維生素B12(μg)", "folate_ug": "葉酸(μg)", "niacin_mg": "菸鹼素(mg)",
    "vitE_mg": "維生素E(mg α-TE)", "potassium_mg": "鉀(mg)", "phosphorus_mg": "磷(mg)",
    "vitD_ug": "維生素D(μg)", "vitK_ug": "維生素K(μg)",
}


def low_coverage() -> list[str]:
    """步驟1 判定為資料庫覆蓋率不足的營養素（不評估，以免把『沒驗』當成『沒吃到』）。"""
    p = C.OUT_DIR / "low_coverage.json"
    import json
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


@dataclass
class User:
    sex: str            # "男" / "女"
    age: int
    height_cm: float
    weight_kg: float
    activity: str = "稍低"   # 低 / 稍低 / 適度 / 高
    eaten_meals: list[str] = field(default_factory=list)   # 今天已吃的餐點（餐點名稱）
    next_meal: str = "午餐"
    budget: float = 120


# ---------- 1. 個人每日需求 ----------
def load_dris(path=None) -> pd.DataFrame:
    path = path or (C.REF_DIR / "dris_adult.csv")
    return pd.read_csv(path, encoding="utf-8-sig", comment="#")


def dris_row(dris: pd.DataFrame, sex: str, age: int) -> pd.Series:
    hit = dris[(dris["性別"] == sex) & (dris["年齡下限"] <= age) & (age <= dris["年齡上限"])]
    if hit.empty:
        raise ValueError(f"DRIs 表沒有 {sex} {age} 歲的資料")
    return hit.iloc[0]


def bmr_mifflin(u: User) -> float:
    s = 5 if u.sex == "男" else -161
    return 10 * u.weight_kg + 6.25 * u.height_cm - 5 * u.age + s


def daily_needs(u: User, dris: pd.DataFrame) -> tuple[pd.Series, dict]:
    row = dris_row(dris, u.sex, u.age)
    note = {}
    if pd.isna(row.get(f"熱量_{u.activity}")):
        raise ValueError(f"DRIs 總表 {row['年齡下限']} 歲以上沒有「{u.activity}」活動量")
    table_kcal = float(row[f"熱量_{u.activity}"])
    if C.ENERGY_METHOD == "personal":
        kcal = bmr_mifflin(u) * C.PAL[u.activity]
        note["熱量算法"] = (f"基礎代謝 {bmr_mifflin(u):.0f} kcal (Mifflin-St Jeor) × 活動係數 {C.PAL[u.activity]}"
                         f"；DRIs 表同齡同性別參考值 {table_kcal:.0f} kcal")
    else:
        kcal = table_kcal
        note["熱量算法"] = f"DRIs 熱量表 {u.sex} {row['年齡下限']}-{row['年齡上限']} 歲、活動量{u.activity}"
    needs = {"energy_kcal": round(kcal)}
    skip = low_coverage()
    for k in GAP_NUTRIENTS:
        if k in skip:
            continue
        col = f"fiber_{u.activity}" if k == "fiber_g" else k
        if col in row and pd.notna(row[col]):
            needs[k] = float(row[col])
    if skip:
        note["資料庫覆蓋率不足、暫不評估"] = "、".join(LABELS.get(k, k) for k in skip)
    missing = [LABELS.get(k, k) for k in GAP_NUTRIENTS if k not in needs and k not in skip]
    if missing:
        note["DRIs 無數值、暫不評估"] = "、".join(missing)
    note["鈉上限"] = f"{row['sodium_mg']:.0f} mg（DRIs 第八版 CDRR）"
    return pd.Series(needs), note


# ---------- 2. 缺口 ----------
def intake_of(meals: pd.DataFrame, names: list[str]) -> pd.Series:
    sel = meals[meals["餐點名稱"].isin(names)]
    unknown = set(names) - set(sel["餐點名稱"])
    if unknown:
        raise ValueError(f"找不到已吃餐點：{unknown}（請先加入 meal_mapping.csv）")
    return sel[list(C.NUTRIENTS)].sum(min_count=1).fillna(0)


def gap_table(needs: pd.Series, eaten: pd.Series) -> pd.DataFrame:
    df = pd.DataFrame({"每日建議": needs, "已攝取": eaten.reindex(needs.index).fillna(0)})
    df["缺口"] = (df["每日建議"] - df["已攝取"]).clip(lower=0)
    df["達成率%"] = (df["已攝取"] / df["每日建議"] * 100).round(0)
    df.index = [LABELS.get(i, i) for i in df.index]
    return df.round(1)


def meal_targets(needs: pd.Series, eaten: pd.Series, u: User) -> pd.Series:
    """下一餐應補的量：剩餘需求按剩餘餐次的熱量分配比例分攤。"""
    order = list(C.MEAL_SHARE)
    remaining_meals = order[order.index(u.next_meal):]
    share = C.MEAL_SHARE[u.next_meal] / sum(C.MEAL_SHARE[m] for m in remaining_meals)
    remain = (needs - eaten.reindex(needs.index).fillna(0)).clip(lower=0)
    return remain * share


# ---------- 3. 推薦 ----------
def score_meal(meal: pd.Series, target: pd.Series, needs: pd.Series, eaten: pd.Series) -> tuple[float, str]:
    num, den, gains = 0.0, 0.0, []
    for k in target.index:
        if k == "energy_kcal" or target[k] <= 0:
            continue
        # 權重 = 這個營養素今天整體還缺多少比例（缺越多越重要）
        w = float(target[k] / needs[k]) if needs[k] else 0
        cover = min(float(meal.get(k, 0) or 0), target[k]) / target[k]
        num += w * cover
        den += w
        if cover >= 0.3:
            gains.append((w * cover, f"{LABELS[k]} 補足 {cover*100:.0f}%"))
    coverage = num / den if den else 0
    # 熱量：超過下一餐熱量額度 10% 開始扣分；低於 60% 表示吃不飽，也小幅扣分
    e_budget = target["energy_kcal"]
    e = float(meal["energy_kcal"])
    pen_e = max(0, e - e_budget * 1.1) / e_budget + 0.5 * max(0, e_budget * 0.6 - e) / e_budget
    # 鈉：加上這餐後超過每日上限就扣分
    pen_na = 0.0
    if "sodium_mg" in C.UPPER_LIMIT_NUTRIENTS:
        lim = C.UPPER_LIMIT_NUTRIENTS["sodium_mg"]
        over = eaten.get("sodium_mg", 0) + float(meal.get("sodium_mg", 0) or 0) - lim
        pen_na = max(0, over) / lim
    score = coverage - pen_e - pen_na
    why = "；".join(t for _, t in sorted(gains, reverse=True)[:3]) or "無明顯補足項目"
    if pen_e > 0:
        why += f"；⚠ 熱量 {e:.0f} kcal（本餐額度 {e_budget:.0f}）"
    if pen_na > 0:
        why += "；⚠ 鈉將超過每日上限"
    return round(score, 3), why


def recommend(u: User, meals: pd.DataFrame, dris: pd.DataFrame, top_k: int = 3):
    needs, note = daily_needs(u, dris)
    eaten = intake_of(meals, u.eaten_meals) if u.eaten_meals else pd.Series(0.0, index=list(C.NUTRIENTS))
    gaps = gap_table(needs, eaten)
    target = meal_targets(needs, eaten, u)

    cand = meals[(meals["價格"] <= u.budget) & ~meals["餐點名稱"].isin(u.eaten_meals)].copy()
    results = [score_meal(r, target, needs, eaten) for _, r in cand.iterrows()]
    cand["推薦分數"] = [r[0] for r in results]
    cand["推薦理由"] = [r[1] for r in results]
    cols = ["餐點名稱", "店家類型", "價格", "energy_kcal", "protein_g", "fiber_g", "sodium_mg", "推薦分數", "推薦理由"]
    top = cand.sort_values("推薦分數", ascending=False)[cols].head(top_k)
    top = top.rename(columns={k: LABELS.get(k, k) for k in cols})
    return {"needs_note": note, "gaps": gaps, "meal_target": target.round(1), "top": top,
            "food_groups": food_group_check(meals, u.eaten_meals)}


# ---------- 4. 六大類均衡檢查（台師大成人每日建議量） ----------
def food_group_check(meals: pd.DataFrame, eaten_names: list[str]) -> pd.DataFrame:
    sel = meals[meals["餐點名稱"].isin(eaten_names)]
    rows = []
    for g, (lo, hi, unit, _) in C.FOOD_GROUP_SERVINGS.items():
        col = f"份數_{g}"
        got = float(sel[col].sum()) if col in sel else 0.0
        status = "不足" if got < lo else ("超過" if got > hi else "達標")
        rows.append({"類別": g, "已攝取": round(got, 1), "每日建議": f"{lo}~{hi} {unit}" if lo != hi else f"{lo} {unit}",
                     "狀態": status})
    return pd.DataFrame(rows)
