"""
步驟 1：資料清理與標準化
輸入：食藥署「食品營養成分資料集」原始檔（長表格：一列 = 一個食材的一項分析值）
輸出：data/processed/foods_per100g.csv（寬表格：一列 = 一個食材，欄 = 每 100 g 營養素，單位統一）
      data/processed/clean_report.txt（清理紀錄，可直接放進報告）
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C


# ---------- 讀檔 ----------
def load_tfnd(path: Path) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() == ".json":
        with open(path, encoding="utf-8-sig") as f:
            df = pd.DataFrame(json.load(f))
    elif path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, dtype=str)
    else:
        df = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    missing = [v for v in C.TFND_COLS.values() if v not in df.columns and v not in ("資料類別", "樣品英文名稱")]
    if missing:
        raise ValueError(f"原始檔缺少欄位：{missing}\n實際欄位：{list(df.columns)}")
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip().replace({"nan": np.nan, "": np.nan})
    return df


# ---------- 數值解析 ----------
_TRACE = {"tr", "trace", "微量", "痕量"}

def parse_value(x) -> float:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return np.nan
    s = str(x).strip().replace(",", "")
    if s.lower() in _TRACE:
        return 0.0 if C.TRACE_AS_ZERO else np.nan
    if s in {"-", "--", "—", "N/A", "NA", "ND"}:
        return np.nan
    m = re.match(r"^[<≦]?\s*(-?\d+(\.\d+)?)", s)
    return float(m.group(1)) if m else np.nan


def convert_unit(value: float, unit_from: str, unit_to: str) -> float:
    """把 g/mg/ug、kJ/kcal 換算成標準單位；IU 等無法換算者回傳 NaN。"""
    if np.isnan(value):
        return np.nan
    uf = (unit_from or "").strip().lower()
    uf = re.sub(r"\s*(re|α-te|a-te|ne|dfe)$", "", uf)  # 「ug RE」「mg α-TE」→ 只看質量單位
    ut = unit_to.lower()
    if ut == "kcal":
        if uf in ("kcal", "大卡", "千卡"):
            return value
        if uf == "kj":
            return value / 4.184
        return np.nan
    if uf in C.UNIT_TO_MG and ut in C.UNIT_TO_MG:
        return value * C.UNIT_TO_MG[uf] / C.UNIT_TO_MG[ut]
    return np.nan


# ---------- 主流程 ----------
def build_wide_table(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    T = C.TFND_COLS
    report: dict = {"原始列數": len(raw), "原始食材數": raw[T["id"]].nunique()}

    # 建立「分析項名稱 → 標準欄位」對照（依優先序）
    item_names = set(raw[T["item"]].dropna().unique())
    chosen: dict[str, str] = {}
    for key, (_, aliases) in C.NUTRIENTS.items():
        for a in aliases:
            if a in item_names:
                chosen[key] = a
                break
    report["營養素對應"] = chosen
    report["找不到對應的營養素"] = [k for k in C.NUTRIENTS if k not in chosen]
    report["原始檔中未使用的分析項"] = sorted(item_names - set(chosen.values()))

    item_to_key = {v: k for k, v in chosen.items()}
    sub = raw[raw[T["item"]].isin(item_to_key)].copy()
    sub["key"] = sub[T["item"]].map(item_to_key)
    sub["raw_val"] = sub[T["per100g"]].map(parse_value)
    sub["val"] = [
        convert_unit(v, u, C.NUTRIENTS[k][0])
        for v, u, k in zip(sub["raw_val"], sub[T["unit"]], sub["key"])
    ]
    bad_units = sub[sub["raw_val"].notna() & sub["val"].isna()]
    report["單位無法換算筆數"] = int(len(bad_units))
    if len(bad_units):
        report["無法換算的單位"] = sorted(bad_units[T["unit"]].dropna().unique().tolist())

    wide = sub.pivot_table(index=T["id"], columns="key", values="val", aggfunc="first")
    meta_cols = [c for c in (T["category"], T["name"], T["alias"], T["desc"], T["waste"]) if c in raw.columns]
    meta = raw.groupby(T["id"])[meta_cols].first()
    wide = meta.join(wide)
    for k in C.NUTRIENTS:
        if k not in wide.columns:
            wide[k] = np.nan
    wide = wide.reset_index()

    # --- 結構性缺值補 0（例如肉類未驗膳食纖維）---
    imputed = {}
    for k, cats in C.IMPUTE_ZERO.items():
        mask = wide[k].isna() & wide[T["category"]].isin(cats)
        wide.loc[mask, k] = 0.0
        imputed[k] = int(mask.sum())
    simple = wide[T["category"]].isin(C.SIMPLE_FOOD_CATS) & wide["energy_kcal"].notna()
    for k in ["protein_g", "fat_g", "carb_g"]:
        mask = simple & wide[k].isna()
        wide.loc[mask, k] = 0.0
        imputed[f"{k}(單純型食品)"] = int(mask.sum())
    report["結構性缺值補0筆數"] = imputed

    # --- 各營養素在整個資料庫的覆蓋率 ---
    coverage = wide[list(C.NUTRIENTS)].notna().mean().round(3)
    report["營養素覆蓋率"] = {k: f"{v*100:.1f}%" for k, v in coverage.items()}
    low_cov = [k for k in C.NUTRIENTS if coverage[k] < C.MIN_NUTRIENT_COVERAGE]
    report["低覆蓋營養素(不納入缺口評估)"] = low_cov

    # --- 剔除：核心營養素缺值 ---
    n0 = len(wide)
    core_ok = wide[C.CORE_NUTRIENTS].notna().all(axis=1)
    dropped_core = wide.loc[~core_ok, [T["id"], T["name"]]]
    wide = wide[core_ok]
    # --- 剔除：整體缺值比例過高 ---
    avail = [k for k in C.NUTRIENTS if k in chosen and k not in low_cov]
    miss_ratio = wide[avail].isna().mean(axis=1)
    is_simple = wide[T["category"]].isin(C.SIMPLE_FOOD_CATS)
    too_sparse = (miss_ratio > C.MAX_MISSING_RATIO) & ~is_simple
    dropped_sparse = wide.loc[too_sparse, [T["id"], T["name"]]]
    wide = wide[~too_sparse].copy()
    # --- 剔除：同名重複（保留缺值最少的一筆）---
    wide["_miss"] = wide[avail].isna().sum(axis=1)
    wide = wide.sort_values("_miss").drop_duplicates(subset=[T["name"]], keep="first").drop(columns="_miss")
    # --- 合理性檢查：每 100 g 的巨量營養素加總不可能 > 100 g ---
    macro_sum = wide[["protein_g", "fat_g", "carb_g"]].sum(axis=1)
    implausible = wide.loc[macro_sum > 105, [T["id"], T["name"]]]
    wide = wide[macro_sum <= 105]

    report.update({
        "剔除_核心營養素缺值": len(dropped_core),
        "剔除_缺值比例過高": len(dropped_sparse),
        "剔除_同名重複": n0 - len(dropped_core) - len(dropped_sparse) - len(wide) - len(implausible),
        "剔除_數值不合理": len(implausible),
        "保留食材數": len(wide),
        "剔除清單": pd.concat([dropped_core.assign(原因="核心營養素缺值"),
                              dropped_sparse.assign(原因="缺值比例過高"),
                              implausible.assign(原因="巨量營養素加總>100g")]),
    })

    wide = wide.rename(columns={T["id"]: "food_id", T["category"]: "tfnd_category",
                                T["name"]: "name", T["alias"]: "alias",
                                T["desc"]: "description", T["waste"]: "waste_pct"})
    wide["waste_pct"] = wide["waste_pct"].map(parse_value) if "waste_pct" in wide else np.nan
    ordered = ["food_id", "name", "alias", "tfnd_category", "description", "waste_pct"] + list(C.NUTRIENTS)
    wide = wide[[c for c in ordered if c in wide.columns]].reset_index(drop=True)
    num = list(C.NUTRIENTS)
    wide[num] = wide[num].round(2)
    return wide, report


def write_report(report: dict, path: Path) -> None:
    lines = ["資料清理與標準化紀錄", "=" * 30]
    for k, v in report.items():
        if k == "剔除清單":
            continue
        if isinstance(v, dict):
            lines.append(f"{k}：")
            fmt = "  {} ← 「{}」" if k == "營養素對應" else "  {}：{}"
            lines += [fmt.format(kk, vv) for kk, vv in v.items()]
        elif isinstance(v, list):
            lines.append(f"{k}（{len(v)}）：{'、'.join(map(str, v)) if v else '無'}")
        else:
            lines.append(f"{k}：{v}")
    lines.append("\n處理規則：")
    lines.append(f"  1. 數值一律取「每100克含量」，單位統一為 kcal / g / mg / ug。")
    lines.append(f"  2. 「微量/Tr」視為 {'0' if C.TRACE_AS_ZERO else '缺值'}；'-' 或空白視為缺值。")
    lines.append(f"  3. 熱量、蛋白質、脂肪、碳水化合物任一缺值即剔除。")
    lines.append(f"  4. 動物性食物未檢驗之膳食纖維、植物性食物未檢驗之維生素B12 視為 0（天然不含）。")
    lines.append(f"     油脂、糖、飲料、調味料有熱量值時，未檢驗之蛋白質/脂肪/碳水視為 0，且不套用缺值比例規則。")
    lines.append(f"  4b. 覆蓋率 ≥{int(C.MIN_NUTRIENT_COVERAGE*100)}% 的營養素中，該食材缺值超過 {int(C.MAX_MISSING_RATIO*100)}% 即剔除；"
                 f"覆蓋率不足的營養素保留但不做缺口評估。")
    lines.append(f"  5. 樣品名稱重複者保留缺值最少的一筆。")
    lines.append(f"  6. 蛋白質+脂肪+碳水化合物 > 105 g/100 g 視為輸入錯誤剔除。")
    path.write_text("\n".join(lines), encoding="utf-8")


def run(raw_path: Path) -> pd.DataFrame:
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = load_tfnd(raw_path)
    wide, report = build_wide_table(raw)
    wide.to_csv(C.OUT_DIR / "foods_per100g.csv", index=False, encoding="utf-8-sig")
    report["剔除清單"].to_csv(C.OUT_DIR / "dropped_foods.csv", index=False, encoding="utf-8-sig")
    write_report(report, C.OUT_DIR / "clean_report.txt")
    import json as _j
    (C.OUT_DIR / "low_coverage.json").write_text(_j.dumps(report["低覆蓋營養素(不納入缺口評估)"]), encoding="utf-8")
    print(f"[步驟1] 原始 {report['原始食材數']} 項 → 保留 {report['保留食材數']} 項")
    return wide
