"""
步驟 2：特徵萃取與分類標籤
輸入：foods_per100g.csv
輸出：foods_tagged.csv（新增 food_group、feature_tags、熱量來源比例等欄位）
"""
from __future__ import annotations

import operator

import numpy as np
import pandas as pd

from . import config as C

_OPS = {">=": operator.ge, "<=": operator.le, ">": operator.gt, "<": operator.lt}


def assign_group(name: str, category: str) -> tuple[str, str]:
    """回傳 (類別, 判定依據)。規則：先看樣品名稱關鍵字，再看 TFND 食品分類。"""
    name = str(name or "")
    base = C.CATEGORY_TO_GROUP.get(str(category), None)
    if category == "蔬菜類" and any(k in name for k in C.VEGETABLE_KEEP):
        return "蔬菜", f"蔬菜類且名稱含「{next(k for k in C.VEGETABLE_KEEP if k in name)}」"
    if category in C.NO_KEYWORD_OVERRIDE:
        return base or "其他", f"食品分類={category}"
    # 「加工調理食品」「豆類」等需要靠關鍵字細分；其他分類只在名稱含全穀雜糧關鍵字時覆寫
    for keywords, group in C.KEYWORD_GROUP_RULES:
        hit = next((k for k in keywords if k in name), None)
        if hit:
            if base in (None, "其他") or group == "主食" and category in ("豆類", "蔬菜類"):
                return group, f"名稱含「{hit}」"
    if base:
        return base, f"食品分類={category}"
    return "其他", "無對應規則"


def tag(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    res = [assign_group(n, c) for n, c in zip(out["name"], out["tfnd_category"])]
    out["food_group"] = [r[0] for r in res]
    out["group_rule"] = [r[1] for r in res]

    # 營養特徵標籤
    tags = []
    for _, row in out.iterrows():
        t = [label for label, (col, op, thr) in C.FEATURE_TAGS.items()
             if pd.notna(row.get(col)) and _OPS[op](row[col], thr)]
        tags.append("、".join(t))
    out["feature_tags"] = tags

    # 熱量來源比例（Atwater 4/9/4），可用來判斷「這個食材主要提供什麼」
    e = out["protein_g"] * 4 + out["fat_g"] * 9 + out["carb_g"] * 4
    e = e.replace(0, np.nan)
    out["pct_kcal_protein"] = (out["protein_g"] * 4 / e * 100).round(1)
    out["pct_kcal_fat"] = (out["fat_g"] * 9 / e * 100).round(1)
    out["pct_kcal_carb"] = (out["carb_g"] * 4 / e * 100).round(1)
    # 營養密度：每 100 kcal 提供的蛋白質（g）——推薦時判斷「用最少熱量補蛋白質」
    out["protein_per_100kcal"] = (out["protein_g"] / out["energy_kcal"].replace(0, np.nan) * 100).round(2)

    out["standalone_ok"] = ~out["tfnd_category"].isin(C.EXCLUDE_FROM_STANDALONE)
    return out


def run(df: pd.DataFrame) -> pd.DataFrame:
    tagged = tag(df)
    tagged.to_csv(C.OUT_DIR / "foods_tagged.csv", index=False, encoding="utf-8-sig")
    review = tagged[(tagged["tfnd_category"] == "加工調理食品及其他類") & (tagged["food_group"] == "其他")]
    review[["food_id", "name", "description", "energy_kcal", "protein_g", "carb_g"]].to_csv(
        C.OUT_DIR / "group_needs_review.csv", index=False, encoding="utf-8-sig")
    summary = tagged.groupby("food_group").size().sort_values(ascending=False)
    summary.to_csv(C.OUT_DIR / "group_summary.csv", header=["食材數"], encoding="utf-8-sig")
    print("[步驟2] 分類結果：" + "、".join(f"{g} {n}" for g, n in summary.items()))
    return tagged
