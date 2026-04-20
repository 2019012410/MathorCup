import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULT_DIR = ROOT / "Experiment" / "results"
OUT_CSV = RESULT_DIR / "all_results_summary.csv"


def load_json(name: str):
    path = RESULT_DIR / name
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def add_row(rows, **kwargs):
    row = {
        "source": "",
        "section": "",
        "item_id": "",
        "item_name_cn": "",
        "state": "",
        "rank": "",
        "metric": "",
        "value": "",
        "extra": "",
    }
    row.update(kwargs)
    rows.append(row)


def export_problem1(rows):
    data = load_json("problem1_results.json")
    if not data:
        return

    add_row(rows, source="problem1_results.json", section="problem1", metric="alpha", value=data.get("alpha", ""))
    add_row(rows, source="problem1_results.json", section="problem1", metric="beta", value=data.get("beta", ""))

    for st, p in (data.get("state_prior") or {}).items():
        add_row(
            rows,
            source="problem1_results.json",
            section="problem1",
            state=st,
            metric="state_prior",
            value=p,
        )

    for idx, item in enumerate(data.get("ranking") or [], start=1):
        base = {
            "source": "problem1_results.json",
            "section": "problem1",
            "item_id": item.get("id", ""),
            "item_name_cn": item.get("name_cn", ""),
            "rank": idx,
            "extra": item.get("type", ""),
        }
        add_row(rows, **base, metric="D", value=item.get("D", ""))
        add_row(rows, **base, metric="U", value=item.get("U", ""))
        add_row(rows, **base, metric="V", value=item.get("V", ""))


def export_problem2(rows):
    data = load_json("problem2_results.json")
    if not data:
        return

    add_row(rows, source="problem2_results.json", section="problem2", metric="attack_count", value=data.get("attack_count", ""))

    for k, v in (data.get("states") or {}).items():
        add_row(rows, source="problem2_results.json", section="problem2", state=k, metric="state_name", value=v)

    all_rankings = data.get("all_attacks_ranking_by_defender_state") or {}
    for attack_id, state_map in all_rankings.items():
        for state, top_list in state_map.items():
            for item in top_list:
                add_row(
                    rows,
                    source="problem2_results.json",
                    section="problem2",
                    item_id=attack_id,
                    item_name_cn=item.get("defense_name_cn", ""),
                    state=state,
                    rank=item.get("rank", ""),
                    metric="defense_score",
                    value=item.get("score", ""),
                    extra=item.get("defense_id", ""),
                )


def export_problem3(rows):
    data = load_json("problem3_results.json")
    if not data:
        return

    for key in ["opponent_profile", "horizon", "gamma", "lambda", "early_stable_ratio"]:
        add_row(rows, source="problem3_results.json", section="problem3", metric=key, value=data.get(key, ""))

    ids = data.get("best_sequence_ids") or []
    cns = data.get("best_sequence_cn") or []
    n = max(len(ids), len(cns))
    for i in range(n):
        add_row(
            rows,
            source="problem3_results.json",
            section="problem3",
            rank=i + 1,
            item_id=ids[i] if i < len(ids) else "",
            item_name_cn=cns[i] if i < len(cns) else "",
            metric="best_sequence",
            value=i + 1,
        )


def export_problem4(rows):
    data = load_json("problem4_results.json")
    if not data:
        return

    for key in ["model", "horizon", "gamma", "fault_rate", "iterations", "self_play_win_rate", "win_rate_vs_random", "random_vs_random"]:
        add_row(rows, source="problem4_results.json", section="problem4", metric=key, value=data.get(key, ""))

    for i, s in enumerate(data.get("policy_snippets") or [], start=1):
        st = s.get("state", {})
        act = s.get("action", {})
        add_row(
            rows,
            source="problem4_results.json",
            section="problem4",
            rank=i,
            item_id=act.get("tactical_id", ""),
            item_name_cn=act.get("tactical_name_cn", ""),
            state=f"s={st.get('s','')},r1={st.get('r1','')},r2={st.get('r2','')},r3={st.get('r3','')},f={st.get('f','')}",
            metric="policy_snippet",
            value=act.get("resource", ""),
        )


def main():
    rows = []
    export_problem1(rows)
    export_problem2(rows)
    export_problem3(rows)
    export_problem4(rows)

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["source", "section", "item_id", "item_name_cn", "state", "rank", "metric", "value", "extra"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"[Export] Wrote {len(rows)} rows to {OUT_CSV}")


if __name__ == "__main__":
    main()
