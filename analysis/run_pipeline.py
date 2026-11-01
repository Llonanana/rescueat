"""
一鍵執行：python run_pipeline.py data/raw/食品營養成分資料集.csv
  [步驟1] 清理與標準化 → [步驟2] 分類標籤 → [步驟3] Mapping → [示範] 缺口計算與推薦
"""
import argparse
from pathlib import Path

import pandas as pd

from nutri import config as C
from nutri import step1_clean, step2_tag, step3_mapping
from nutri.step4_recommend import User, load_dris, recommend

pd.set_option("display.unicode.east_asian_width", True)
pd.set_option("display.width", 200)
pd.set_option("display.max_colwidth", 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tfnd", help="食藥署食品營養成分資料集（CSV / JSON / XLSX）")
    ap.add_argument("--dris", default=str(C.REF_DIR / "dris_adult.csv"))
    ap.add_argument("--mapping", default=str(C.REF_DIR / "meal_mapping.csv"))
    ap.add_argument("--out", default=str(C.OUT_DIR))
    a = ap.parse_args()
    C.OUT_DIR = Path(a.out)
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)

    foods = step1_clean.run(Path(a.tfnd))
    tagged = step2_tag.run(foods)
    meals = step3_mapping.run(tagged, a.mapping)

    # ---- 示範情境：22 歲女性，早餐吃了蛋餅＋豆漿，午餐預算 120 元 ----
    user = User(sex="女", age=22, height_cm=160, weight_kg=52, activity="稍低",
                eaten_meals=["蛋餅＋無糖豆漿"], next_meal="午餐", budget=120)
    r = recommend(user, meals, load_dris(a.dris))
    lines = ["示範情境：女 22 歲 160 cm 52 kg、活動量稍低；早餐＝蛋餅＋無糖豆漿；午餐預算 120 元", ""]
    lines += [f"{k}：{v}" for k, v in r["needs_note"].items()]
    lines += ["", "【今日營養缺口】", r["gaps"].to_string(), "",
              "【六大類均衡（台師大成人建議量）】", r["food_groups"].to_string(index=False), "",
              "【午餐推薦 Top 3】", r["top"].to_string(index=False)]
    text = "\n".join(lines)
    (C.OUT_DIR / "demo_recommendation.txt").write_text(text, encoding="utf-8")
    print("\n" + text)


if __name__ == "__main__":
    main()
