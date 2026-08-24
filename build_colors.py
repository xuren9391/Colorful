# -*- coding: utf-8 -*-
"""合并传统色数据源，生成 data/colors.json（名称/拼音/HEX/色系/出处）。"""
import json
import colorsys
from pypinyin import lazy_pinyin

SRC_526 = "data-src/colors526.json"  # 526 色，自带拼音
SRC_161 = "data-src/colors161.json"  # 161 色，自带注释与色系
OUT = "data/colors.json"

# 名色补充（两个数据源都缺失的经典色，HEX 取自公开传统色表）
EXTRA_COLORS = {
    "天水碧": "#d5f0e6",
    "朱砂": "#ff461f",
    "竹青": "#789262",
    "黛蓝": "#4a4266",
}

# 名色出处补充（诗句/文献，宁缺毋滥）
FAMOUS_NOTES = {
    "天水碧": "南唐宫人染碧帛，经夜露褪成浅碧，史称天水碧",
    "胭脂": "燕支山所产红蓝花制脂，古称燕支，后作胭脂",
    "月白": "月光洒在白布上的颜色，古人以月白言淡蓝",
    "竹青": "竹之青色，亦称竹叶青",
    "黛蓝": "黛为画眉青黑之色，黛蓝为深青蓝",
    "玄色": "《说文》：玄，幽潜也，黑中扬赤之色",
    "朱砂": "即辰砂，古之正红矿物颜料",
    "湘妃": "湘妃竹上泪斑之色，亦称湘妃红",
    "藕荷": "浅紫而带灰，如藕荷花色",
    "秋香": "色黄绿相和，如秋叶初香，亦称秋香色",
    "绛紫": "绛为深红，绛紫为红中泛紫",
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def classify(hex_str):
    """按 HSL 色相推导色系分组：赤橙黄绿青蓝紫褐黑白。"""
    r, g, b = (v / 255 for v in hex_to_rgb(hex_str))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    chroma = max(r, g, b) - min(r, g, b)
    h *= 360
    if chroma < 0.05 or l < 0.08 or l > 0.96:
        return "黑白"
    if 15 <= h < 45 and s < 0.55 and l < 0.50:
        return "褐"
    if h >= 335 or h < 15:
        return "赤"
    if 15 <= h < 45:
        return "橙"
    if 45 <= h < 70:
        return "黄"
    if 70 <= h < 155:
        return "绿"
    if 155 <= h < 195:
        return "青"
    if 195 <= h < 255:
        return "蓝"
    return "紫"


def main():
    colors = {}
    # 526 色集（拼音权威）
    for d in json.load(open(SRC_526, encoding="utf-8")):
        colors[d["name"]] = {
            "name": d["name"],
            "pinyin": d["pinyin"].lower(),
            "hex": d["hex"].lower(),
        }
    # 161 色集：补名色与注释
    notes = {}
    for g in json.load(open(SRC_161, encoding="utf-8")):
        for c in g["colors"]:
            notes[c["name"]] = (c.get("intro") or "").strip()
            if c["name"] not in colors:
                colors[c["name"]] = {
                    "name": c["name"],
                    "pinyin": "".join(lazy_pinyin(c["name"])),
                    "hex": c["hex"].lower(),
                }
    # 补充名色
    for name, hex_str in EXTRA_COLORS.items():
        if name not in colors:
            colors[name] = {
                "name": name,
                "pinyin": "".join(lazy_pinyin(name)),
                "hex": hex_str.lower(),
            }
    out = []
    for name, d in colors.items():
        note = FAMOUS_NOTES.get(name) or notes.get(name) or ""
        out.append({
            "name": d["name"],
            "pinyin": d["pinyin"],
            "hex": d["hex"],
            "group": classify(d["hex"]),
            "note": note,
        })
    # 排序：按色系（光谱序）再按色相，保证色卡墙有渐进美感
    order = {"赤": 0, "橙": 1, "褐": 2, "黄": 3, "绿": 4, "青": 5, "蓝": 6, "紫": 7, "黑白": 8}
    def hue_of(hex_str):
        r, g, b = (v / 255 for v in hex_to_rgb(hex_str))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        return h * 360
    out.sort(key=lambda d: (order[d["group"]], hue_of(d["hex"])))
    import os
    os.makedirs("data", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # 同步生成 data/colors.js：file:// 协议下无法 fetch JSON，改用脚本注入加载
    with open("data/colors.js", "w", encoding="utf-8") as f:
        f.write("// 由 build_colors.py 生成，勿手改\nwindow.COLORS_DATA = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    from collections import Counter
    print("总数", len(out))
    print("分组", dict(Counter(d["group"] for d in out)))
    print("带出处", sum(1 for d in out if d["note"]))


if __name__ == "__main__":
    main()
