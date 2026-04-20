import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTION_LIBRARY_PATH = ROOT / "random_tables" / "action_library.json"
OUT_JSON_PATH = ROOT / "Experiment" / "results" / "problem1_results.json"
OUT_TEX_PATH = ROOT / "Experiment" / "results" / "problem1_top5_table.tex"

ALPHA = 1.0
BETA = 1.5

# Opponent state prior used for E_t[D(a|t)].
# Indexed by state id: 0=Idle,1=Guard,2=MinorUnstable,3=MajorUnstable,4=Down
STATE_PRIOR = {
    "0": 0.4,
    "1": 0.3,
    "2": 0.2,
    "3": 0.1,
    "4": 0.0,
}


def state_damage_weight(t: int, tp: int) -> float:
    # Only worsening transitions contribute to damage utility.
    return float(max(0, tp - t))


def escape_tex(text: str) -> str:
    return (
        text.replace("\\", "\\textbackslash{}")
        .replace("_", "\\_")
        .replace("%", "\\%")
        .replace("&", "\\&")
        .replace("#", "\\#")
    )


def compute_attack_metrics(action: dict) -> dict:
    action_id = action["id"]
    action_name_cn = action.get("name_cn", action_id)
    hit_prob = float(action.get("base_hit_prob", 0.0))
    opp_effect = action.get("opp_effect_on_hit", {})
    self_transition = action.get("self_transition", {})

    expected_damage = 0.0
    for t_str, p_t in STATE_PRIOR.items():
        t = int(t_str)
        trans = opp_effect.get(t_str, {})
        d_at_t = 0.0
        for tp_str, p_tp in trans.items():
            tp = int(tp_str)
            d_at_t += float(p_tp) * state_damage_weight(t, tp)
        expected_damage += float(p_t) * hit_prob * d_at_t

    instability = (
        float(self_transition.get("2", 0.0))
        + float(self_transition.get("3", 0.0))
        + float(self_transition.get("4", 0.0))
    )

    utility = ALPHA * expected_damage - BETA * instability

    return {
        "id": action_id,
        "name_cn": action_name_cn,
        "type": action.get("type", "unknown"),
        "D": expected_damage,
        "U": instability,
        "V": utility,
    }


def build_tex_table(top5: list[dict]) -> str:
    row_break = r"\\"
    lines = [
        "\\begin{table}[H]",
        "\\centering",
        "\\caption{攻击动作综合效用排名（前五，自动计算）}",
        "\\begin{tabular}{c l c c c}",
        "\\toprule",
        f"排名 & 攻击动作 & 期望破坏值 $D$ & 不稳定概率 $U$ & 综合效用 $V$ {row_break}",
        "\\midrule",
    ]

    for i, item in enumerate(top5, start=1):
        action_label = f"{escape_tex(item['name_cn'])} (\\texttt{{{escape_tex(item['id'])}}})"
        lines.append(
            f"{i} & {action_label} & {item['D']:.3f} & {item['U']:.3f} & {item['V']:.3f} {row_break}",
        )

    lines.extend(
        [
            "\\bottomrule",
            "\\end{tabular}",
            "\\end{table}",
        ],
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    data = json.loads(ACTION_LIBRARY_PATH.read_text(encoding="utf-8"))
    actions = [a for a in data.get("actions", []) if a.get("category") == "attack"]

    ranking = [compute_attack_metrics(a) for a in actions]
    ranking.sort(key=lambda x: x["V"], reverse=True)

    OUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_TEX_PATH.parent.mkdir(parents=True, exist_ok=True)

    result = {
        "source": str(ACTION_LIBRARY_PATH.relative_to(ROOT)).replace("\\", "/"),
        "alpha": ALPHA,
        "beta": BETA,
        "state_prior": STATE_PRIOR,
        "ranking": ranking,
    }
    OUT_JSON_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    top5 = ranking[:5]
    OUT_TEX_PATH.write_text(build_tex_table(top5), encoding="utf-8")


if __name__ == "__main__":
    main()
