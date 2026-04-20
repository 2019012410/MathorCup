import json
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

    print("[Problem2] All attacks idle state top3 defenses table generated.")
    print("Preview of first few lines:")
    for line in latex_lines_all[:15]:
        print(line)

if __name__ == "__main__":
    main()