"""
步驟 3：建立關聯對應表 (Mapping)
輸入：data/reference/meal_mapping.csv（店家菜單/常見餐點 → 組成食材關鍵字 + 克數）
      foods_tagged.csv
輸出：mapping_resolved.csv  每個組成食材對應到哪一筆 TFND 資料（含比對方式與是否需人工確認）
      meals_nutrition.csv   每道餐點的總營養素、六大類份數、價格
"""
from __future__ import annotations

import difflib

import numpy as np
import pandas as pd

from . import config as C

NUTRI_KEYS = list(C.NUTRIENTS)


def _aliases(s) -> list[str]:
    if pd.isna(s):
        return []
    for sep in ("、", ",", "，", ";", "；", "/"):
        s = str(s).replace(sep, "|")
    return [a.strip() for a in s.split("|") if a.strip()]


class FoodMatcher:
    """把使用者/菜單上的食材名稱對應到 TFND 標準樣品名稱。"""

    def __init__(self, foods: pd.DataFrame):
        self.foods = foods.reset_index(drop=True)
        self.by_id = {str(fid): i for i, fid in enumerate(self.foods["food_id"])}
        self.alias_index: dict[str, int] = {}
        for i, row in self.foods.iterrows():
            self.alias_index.setdefault(str(row["name"]), i)
            for a in _aliases(row.get("alias")):
                self.alias_index.setdefault(a, i)
        self.names = list(self.alias_index)

    def match(self, keyword: str, food_id=None) -> dict:
        if pd.notna(food_id) and str(food_id) in self.by_id:
            return self._res(self.by_id[str(food_id)], "指定整合編號", 1.0)
        kw = str(keyword).strip()
        if kw in self.alias_index:
            return self._res(self.alias_index[kw], "名稱/俗名完全相符", 1.0)
        # 包含關鍵字：取名稱最短者（最接近原型食材，例如「雞蛋」優先於「雞蛋布丁」）
        contains = [n for n in self.names if kw in n]
        if contains:
            best = min(contains, key=len)
            return self._res(self.alias_index[best], "名稱包含關鍵字", round(len(kw) / len(best), 2))
        close = difflib.get_close_matches(kw, self.names, n=1, cutoff=0.4)
        if close:
            score = difflib.SequenceMatcher(None, kw, close[0]).ratio()
            return self._res(self.alias_index[close[0]], "字串相似度", round(score, 2))
        return {"food_id": None, "matched_name": None, "match_method": "找不到", "match_score": 0.0}

    def _res(self, i: int, method: str, score: float) -> dict:
        r = self.foods.iloc[i]
        return {"food_id": r["food_id"], "matched_name": r["name"], "match_method": method, "match_score": score}


def serving_grams(food_name: str, group: str) -> float | None:
    if group not in C.FOOD_GROUP_SERVINGS:
        return None
    for grp, kws, g in C.SERVING_OVERRIDES:
        if grp == group and any(k in str(food_name) for k in kws):
            return g
    return C.FOOD_GROUP_SERVINGS[group][3]


def resolve(mapping: pd.DataFrame, foods: pd.DataFrame) -> pd.DataFrame:
    m = FoodMatcher(foods)
    rows = []
    for _, r in mapping.iterrows():
        res = m.match(r["食材關鍵字"], r.get("指定整合編號"))
        rows.append({**r.to_dict(), **res})
    out = pd.DataFrame(rows)
    out["需人工確認"] = out["match_method"].isin(["字串相似度", "找不到"]) | (out["match_score"] < 0.5)
    return out


def meal_nutrition(resolved: pd.DataFrame, foods: pd.DataFrame) -> pd.DataFrame:
    f = foods.set_index("food_id")
    comp = resolved.dropna(subset=["food_id"]).copy()
    comp = comp.join(f[NUTRI_KEYS + ["food_group"]], on="food_id")
    factor = comp["克數"].astype(float) / 100.0
    for k in NUTRI_KEYS:
        comp[k] = comp[k] * factor
    comp["servings"] = [
        (g / sg) if (sg := serving_grams(n, grp)) else 0.0
        for g, n, grp in zip(comp["克數"].astype(float), comp["matched_name"], comp["food_group"])
    ]
    agg = comp.groupby("餐點名稱")[NUTRI_KEYS].sum(min_count=1).round(1)
    servings = comp.pivot_table(index="餐點名稱", columns="food_group", values="servings", aggfunc="sum").round(2)
    servings.columns = [f"份數_{c}" for c in servings.columns]
    meta = resolved.groupby("餐點名稱").agg(
        店家類型=("店家類型", "first"),
        價格=("價格", "first"),
        組成=("食材關鍵字", lambda s: "＋".join(s)),
        組成需確認=("需人工確認", "any"),
    )
    return meta.join(agg).join(servings).reset_index()


def run(foods: pd.DataFrame, mapping_path=None) -> pd.DataFrame:
    mapping_path = mapping_path or (C.REF_DIR / "meal_mapping.csv")
    mapping = pd.read_csv(mapping_path, encoding="utf-8-sig", dtype={"指定整合編號": str})
    resolved = resolve(mapping, foods)
    resolved.to_csv(C.OUT_DIR / "mapping_resolved.csv", index=False, encoding="utf-8-sig")
    meals = meal_nutrition(resolved, foods)
    meals.to_csv(C.OUT_DIR / "meals_nutrition.csv", index=False, encoding="utf-8-sig")
    n_review = int(resolved["需人工確認"].sum())
    print(f"[步驟3] {mapping['餐點名稱'].nunique()} 道餐點、{len(resolved)} 個組成食材；需人工確認 {n_review} 筆")
    return meals
