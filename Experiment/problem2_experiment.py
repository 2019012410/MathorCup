import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLE_DIR = ROOT / "random_tables"
RESULT_DIR = ROOT / "Experiment" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

def load_json(name: str):
    with (TABLE_DIR / name).open("r", encoding="utf-8") as f:
        return json.load(f)

def generate_defense_matches(action_library, alpha=0.5, beta=0.3, gamma=0.2):
    """
    根据动作库计算所有 (攻击, 防御方状态) 组合下的防御排名。
    返回符合 defense_matching_table.json 格式的字典。
    """
    attacks = [a for a in action_library["actions"] if a["category"] == "attack"]
    defenses = [d for d in action_library["actions"] if d["category"] == "defense"]
    
    matches = []
    
    for attack in attacks:
        attack_id = attack["id"]
        for state in ["0", "1", "2", "3", "4"]:
            legal_defenses = [
                d for d in defenses
                if int(state) in d.get("legal_from", [0,1,2,3,4])
            ]
            
            scored = []
            for defense in legal_defenses:
                block_prob = defense.get("block_prob", {}).get(
                    attack_id, 
                    defense.get("block_prob", {}).get("default", 0.0)
                )
                p_mitigate = block_prob
                p_counter = defense.get("counter_window_prob", 0.0)
                stamina_cost = defense.get("stamina_cost", 0.0)
                
                score = alpha * p_mitigate + beta * p_counter - gamma * stamina_cost
                scored.append((defense["id"], score))
            
            scored.sort(key=lambda x: x[1], reverse=True)
            top_defenses = [
                {"rank": i+1, "defense": def_id, "score": round(score, 4)}
                for i, (def_id, score) in enumerate(scored[:3])
            ]
            
            matches.append({
                "attack": attack_id,
                "defender_state": state,
                "top_defenses": top_defenses
            })
    
    return {"defense_matches": matches}
def main():
    action_library = load_json("action_library.json")
    attacks = [a for a in action_library.get("actions", []) if a.get("category") == "attack"]
    defenses = [d for d in action_library.get("actions", []) if d.get("category") == "defense"]
    attack_name_cn = {a["id"]: a.get("name_cn", a["id"]) for a in attacks}
    recoil = load_json("recoil_table.json").get("recoil", {})

    # 生成并保存最新的防御匹配表
    match_data = generate_defense_matches(action_library)
    with (TABLE_DIR / "defense_matching_table.json").open("w", encoding="utf-8") as f:
        json.dump(match_data, f, ensure_ascii=False, indent=2)
    print("[Info] defense_matching_table.json has been regenerated.")

    matches = match_data["defense_matches"]
    defense_name = {d["id"]: d.get("name_cn", d["id"]) for d in defenses}

    # ---------- 构建包含所有攻击的排名字典 ----------
    all_rankings = {}
    for row in matches:
        aid = row["attack"]
        ds = row["defender_state"]
        converted = []
        for item in row["top_defenses"]:
            converted.append({
                "rank": item["rank"],
                "defense_id": item["defense"],
                "defense_name_cn": defense_name.get(item["defense"], item["defense"]),
                "score": round(float(item["score"]), 3),
            })
        all_rankings.setdefault(aid, {})[ds] = converted

    # ---------- 提取所有攻击在 Idle 状态下的前三防御 ----------
    idle_top3 = {}
    for attack_id, states in all_rankings.items():
        idle_top3[attack_id] = states.get("0", [])

    # ---------- 生成 JSON 结果文件（仅保留完整排名，不再包含单独下劈腿字段）----------
    result_json = {
        "schema": "five_state_transition",
        "states": action_library.get("states", {}),
        "attack_count": len(recoil) if recoil else len(attacks),
        "all_attacks_ranking_by_defender_state": all_rankings,
        "idle_state_top3_defenses": idle_top3
    }
    with (RESULT_DIR / "problem2_results.json").open("w", encoding="utf-8") as f:
        json.dump(result_json, f, ensure_ascii=False, indent=2)

    # ---------- 生成所有攻击汇总表格 (problem2_all_attacks_table.tex) ----------
    latex_lines_all = []
    latex_lines_all.append("\\begin{table}[H]")
    latex_lines_all.append("\\centering")
    latex_lines_all.append("\\caption{所有攻击在空闲状态下的最佳防御（前三）}")
    latex_lines_all.append("\\begin{tabular}{l l c l c l c}")
    latex_lines_all.append("\\toprule")
    latex_lines_all.append("攻击 & 第一名防御 & 得分 & 第二名防御 & 得分 & 第三名防御 & 得分 " + r"\\")
    latex_lines_all.append("\\midrule")

    sorted_attacks = sorted(idle_top3.keys())
    for attack_id in sorted_attacks:
        attack_tex = attack_id.replace("_", "\\_")
        top3 = idle_top3[attack_id]

        def1 = top3[0]["defense_name_cn"].replace("_", "\\_") if len(top3) >= 1 else "---"
        score1 = f"{top3[0]['score']:.3f}" if len(top3) >= 1 else "---"
        def2 = top3[1]["defense_name_cn"].replace("_", "\\_") if len(top3) >= 2 else "---"
        score2 = f"{top3[1]['score']:.3f}" if len(top3) >= 2 else "---"
        def3 = top3[2]["defense_name_cn"].replace("_", "\\_") if len(top3) >= 3 else "---"
        score3 = f"{top3[2]['score']:.3f}" if len(top3) >= 3 else "---"

        latex_lines_all.append(
            f"{attack_tex} & {def1} & {score1} & {def2} & {score2} & {def3} & {score3} \\\\" 
        )

    latex_lines_all.append("\\bottomrule")
    latex_lines_all.append("\\end{tabular}")
    latex_lines_all.append("\\end{table}")
    latex_lines_all.append("")

    with (RESULT_DIR / "problem2_all_attacks_table.tex").open("w", encoding="utf-8") as f:
        f.write("\n".join(latex_lines_all))

    # ---------- 生成“典型攻击动作”表格 (problem2_typical_table.tex) ----------
    typical_attack_ids = ["jab", "cross", "hook", "front_kick", "roundhouse", "low_kick"]
    latex_lines_typical = []
    latex_lines_typical.append("\\begin{table}[H]")
    latex_lines_typical.append("\\centering")
    latex_lines_typical.append("\\caption{典型攻击动作的前三名防守匹配结果（防守方状态为 Idle，自动计算）}")
    latex_lines_typical.append("\\label{tab:typical_defense_match}")
    latex_lines_typical.append("\\begin{tabular}{c|c|c|c}")
    latex_lines_typical.append("\\hline")
    latex_lines_typical.append("攻击动作 & 第1名防守 & 第2名防守 & 第3名防守 " + r"\\")
    latex_lines_typical.append("\\hline")

    for attack_id in typical_attack_ids:
        top3 = idle_top3.get(attack_id, [])
        attack_cn = attack_name_cn.get(attack_id, attack_id).replace("_", "\\_")

        def1 = f"{top3[0]['defense_name_cn']}({top3[0]['score']:.3f})" if len(top3) >= 1 else "---"
        def2 = f"{top3[1]['defense_name_cn']}({top3[1]['score']:.3f})" if len(top3) >= 2 else "---"
        def3 = f"{top3[2]['defense_name_cn']}({top3[2]['score']:.3f})" if len(top3) >= 3 else "---"

        def1 = def1.replace("_", "\\_")
        def2 = def2.replace("_", "\\_")
        def3 = def3.replace("_", "\\_")

        latex_lines_typical.append(f"{attack_cn} & {def1} & {def2} & {def3} " + r"\\")

    latex_lines_typical.append("\\hline")
    latex_lines_typical.append("\\end{tabular}")
    latex_lines_typical.append("\\end{table}")
    latex_lines_typical.append("")

    with (RESULT_DIR / "problem2_typical_table.tex").open("w", encoding="utf-8") as f:
        f.write("\n".join(latex_lines_typical))

    # ---------- 生成“结果规律分析”段落 (problem2_patterns.tex) ----------
    def _safe_name(name: str) -> str:
        return name.replace("_", "\\_")

    def _fmt_def(item: dict) -> str:
        return f"{_safe_name(item['defense_name_cn'])}({item['score']:.3f})"

    def _top3_desc(attack_id: str) -> str:
        top3 = idle_top3.get(attack_id, [])
        if len(top3) < 3:
            return "数据不足"
        return f"“{_fmt_def(top3[0])}”“{_fmt_def(top3[1])}”“{_fmt_def(top3[2])}”"

    # 统计倒地状态（state=4）下的最常见第一、第二防守动作
    down_top1 = []
    down_top2 = []
    for aid, states in all_rankings.items():
        s4 = states.get("4", [])
        if len(s4) >= 1:
            down_top1.append(s4[0]["defense_name_cn"])
        if len(s4) >= 2:
            down_top2.append(s4[1]["defense_name_cn"])

    common_down_1 = Counter(down_top1).most_common(1)
    common_down_2 = Counter(down_top2).most_common(1)
    down_first = _safe_name(common_down_1[0][0]) if common_down_1 else "倒地防御"
    down_second = _safe_name(common_down_2[0][0]) if common_down_2 else "快速起身"

    patterns_lines = []
    patterns_lines.append("从整体结果看，当前近似匹配方案表现出较强的攻击类型针对性，可归纳为以下规律。需要强调的是，该匹配表更适合用于提炼防守机制并支撑问题三的决策建模，不宜直接视作高保真仿真意义下的精确数值结论。")
    patterns_lines.append("")
    patterns_lines.append("\\analysisparagraph{1. 直线型拳法攻击优先采用快速格挡。}")
    patterns_lines.append(
        "对于刺拳和后手直拳，模型输出的前三防守分别为"
        + _top3_desc("jab")
        + "与"
        + _top3_desc("cross")
        + "。这说明面对轨迹清晰、正向突进的直线型拳法，低代价、短启动时间的拍挡动作最具性价比，而十字格挡与护头防御/侧闪可作为稳健型次优方案。"
    )
    patterns_lines.append("")
    patterns_lines.append("\\analysisparagraph{2. 弧线型拳法更依赖专项防守。}")
    patterns_lines.append(
        "对于摆拳，模型给出的前三防守为"
        + _top3_desc("hook")
        + "。这表明对大弧线、横向包络明显的攻击，单纯正面格挡并非最优，改变受击平面或采用更适合近身弧线攻击的肘挡更有效。"
    )
    patterns_lines.append("")
    patterns_lines.append("\\analysisparagraph{3. 腿法攻击会诱导模型在“格挡”和“位移规避”之间做折中。}")
    patterns_lines.append(
        "对前蹬腿，前三防守为"
        + _top3_desc("front_kick")
        + "；对回旋踢，前三防守为"
        + _top3_desc("roundhouse")
        + "。这说明当攻击范围扩大、动作恢复帧较长时，位移型闪避由于兼具防御效果与反击窗口，通常优于原地硬挡。"
    )
    patterns_lines.append("")
    patterns_lines.append("\\analysisparagraph{4. 低段平衡破坏类攻击强调专项低位拦截。}")
    patterns_lines.append(
        "对于低扫腿，模型给出的前三防守为"
        + _top3_desc("low_kick")
        + "。说明针对下肢攻击，模型不再只依赖一般性格挡能力，而是明显偏向更具针对性的低位防守动作。"
    )
    patterns_lines.append("")
    patterns_lines.append("\\analysisparagraph{5. 倒地状态下的防守逻辑发生根本改变。}")
    patterns_lines.append(
        "在状态 $4$（Down）下，跨攻击统计中第一、第二推荐动作分别集中于“"
        + down_first
        + "”与“"
        + down_second
        + "”。这说明一旦机器人失去站立能力，模型的决策目标将由主动拦截来袭攻击，切换为先降低地面追加伤害，再尽快恢复站立姿态。"
    )
    patterns_lines.append("")

    with (RESULT_DIR / "problem2_patterns.tex").open("w", encoding="utf-8") as f:
        f.write("\n".join(patterns_lines))

    print("[Problem2] All attacks idle state top3 defenses table generated.")
    print("[Problem2] Typical attacks idle state top3 defenses table generated.")
    print("[Problem2] Dynamic pattern analysis text generated.")
    print("Preview of first few lines:")
    for line in latex_lines_all[:15]:
        print(line)

if __name__ == "__main__":
    main()