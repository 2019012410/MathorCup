import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLE_DIR = ROOT / "random_tables"

STATES = {
    "0": "Idle",
    "1": "Guard",
    "2": "MinorUnstable",
    "3": "MajorUnstable",
    "4": "Down",
}

MITIGATE_MAP = {"4": "3", "3": "2", "2": "1"}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data):
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def r3(x: float) -> float:
    return round(float(x), 3)


def normalize(dist):
    total = sum(dist.values())
    if total <= 0:
        return dist
    out = {k: v / total for k, v in dist.items()}
    keys = list(out.keys())
    if keys:
        # absorb floating error to keep exact sum=1
        diff = 1.0 - sum(out.values())
        out[keys[-1]] += diff
    return {k: r3(v) for k, v in out.items() if v > 1e-9}


def build_self_transition(stability: float):
    s0 = max(0.0, min(1.0, stability))
    rem = 1.0 - s0
    if rem <= 0.1:
        d = {"0": s0, "2": rem}
    else:
        d = {"0": s0, "2": rem * 0.7, "3": rem * 0.2, "4": rem * 0.1}
    return normalize(d)


def build_opp_effect_on_hit(damage: float):
    # State 0 (Idle)
    p4 = min(0.45, 0.03 + 0.32 * damage)
    p3 = min(0.40, 0.06 + 0.28 * damage)
    p2 = min(0.45, 0.14 + 0.30 * damage)
    p0 = max(0.0, 1.0 - p2 - p3 - p4)

    # State 1 (Guard): slightly more resilient than Idle
    g4 = max(0.0, p4 - 0.05)
    g3 = max(0.0, p3 - 0.03)
    g2 = p2
    g1 = max(0.0, 1.0 - g2 - g3 - g4)

    # State 2 (MinorUnstable)
    m4 = min(0.75, 0.10 + 0.45 * damage)
    m3 = min(0.75 - m4, 0.25 + 0.30 * damage)
    m2 = max(0.0, 1.0 - m3 - m4)

    # State 3 (MajorUnstable)
    j4 = min(0.90, 0.35 + 0.45 * damage)
    j3 = max(0.0, 1.0 - j4)

    return {
        "0": normalize({"0": p0, "2": p2, "3": p3, "4": p4}),
        "1": normalize({"1": g1, "2": g2, "3": g3, "4": g4}),
        "2": normalize({"2": m2, "3": m3, "4": m4}),
        "3": normalize({"3": j3, "4": j4}),
        "4": {"4": 1.0},
    }


def attack_type(raw_type: str):
    return "stable_attack" if raw_type in {"stable", "semi_stable"} else "unstable_attack"


def legal_from_for_attack(raw_type: str):
    if raw_type == "unstable":
        return [0, 1, 2]
    if raw_type == "semi_stable":
        return [0, 1, 2, 3]
    return [0, 1, 2, 3]


def build_attack_entries(attacks_raw):
    out = []
    for a in attacks_raw:
        dmg = float(a["base_damage"])
        stab = float(a["stability"])
        t = a["type"]
        base_hit_prob = max(0.55, min(0.9, 0.50 + 0.32 * stab + 0.18 * dmg))
        stamina_cost = max(4.0, min(20.0, 4.0 + 16.0 * dmg))
        if t == "stable":
            recovery_frames = 12
        elif t == "semi_stable":
            recovery_frames = 18
        else:
            recovery_frames = 30

        out.append(
            {
                "id": a["id"],
                "name": a["id"],
                "name_cn": a["name_cn"],
                "category": "attack",
                "attack_type": attack_type(t),
                "type": t,
                "base_damage": r3(dmg),
                "stability": r3(stab),
                "legal_from": legal_from_for_attack(t),
                "self_transition": build_self_transition(stab),
                "base_hit_prob": r3(base_hit_prob),
                "opp_effect_on_hit": build_opp_effect_on_hit(dmg),
                "blockable": True,
                "stamina_cost": r3(stamina_cost),
                "recovery_frames": recovery_frames,
            }
        )
    return out


def build_defense_entries(defenses_raw, effects_raw, attacks_ids):
    out = []
    for d in defenses_raw:
        did = d["id"]
        self_cost = float(d["self_cost"])
        block_map = {}
        counter_vals = []

        for aid in attacks_ids:
            eff = effects_raw.get(aid, {}).get(did)
            if eff:
                block_map[aid] = r3(eff["p_block"])
                counter_vals.append(float(eff["p_counter"]))

        if block_map:
            default_block = r3(sum(block_map.values()) / len(block_map))
            block_map["default"] = default_block
        else:
            block_map = {"default": 0.5}

        counter_window_prob = r3(sum(counter_vals) / len(counter_vals)) if counter_vals else 0.3

        guard_prob = max(0.62, min(0.90, 0.92 - 0.55 * self_cost))
        minor_prob = max(0.07, min(0.28, 0.08 + 0.30 * self_cost))
        major_prob = max(0.0, 1.0 - guard_prob - minor_prob)

        out.append(
            {
                "id": did,
                "name": did,
                "name_cn": d["name_cn"],
                "category": "defense",
                "legal_from": [0, 1, 2, 3],
                "self_transition": normalize({"1": guard_prob, "2": minor_prob, "3": major_prob}),
                "block_prob": block_map,
                "mitigate_map": MITIGATE_MAP,
                "counter_window_prob": counter_window_prob,
                "stamina_cost": r3(self_cost),
            }
        )

    return out


def compute_score(block_p: float, counter_p: float, cost: float, defender_state: str):
    alpha, beta, gamma = 0.55, 0.35, 0.25
    state_factor = {
        "0": 1.00,
        "1": 1.05,
        "2": 0.86,
        "3": 0.72,
        "4": 0.35,
    }[defender_state]
    mitigate_effect = block_p * state_factor
    return r3(alpha * mitigate_effect + beta * counter_p - gamma * cost)


def build_defense_matching_table(attacks, defenses):
    rows = []
    for a in attacks:
        aid = a["id"]
        for ds in ["0", "1", "2", "3", "4"]:
            scored = []
            for d in defenses:
                if int(ds) not in d["legal_from"]:
                    continue
                bp = d["block_prob"].get(aid, d["block_prob"].get("default", 0.5))
                cp = d["counter_window_prob"]
                sc = compute_score(bp, cp, d["stamina_cost"], ds)
                scored.append({"defense": d["id"], "score": sc})

            scored.sort(key=lambda x: x["score"], reverse=True)
            top = [
                {"rank": i + 1, "defense": x["defense"], "score": x["score"]}
                for i, x in enumerate(scored[:3])
            ]
            rows.append({"attack": aid, "defender_state": ds, "top_defenses": top})

    return rows


def main():
    attacks_src = load_json(TABLE_DIR / "attacks.json")
    defenses_src = load_json(TABLE_DIR / "defenses.json")
    effects_src = load_json(TABLE_DIR / "defense_effects.json")
    profile_src = load_json(TABLE_DIR / "opponent_profile.json")

    attacks_old = attacks_src["attacks"]
    defenses_old = defenses_src["defenses"]
    effects_old = effects_src["effects"]

    attacks = build_attack_entries(attacks_old)
    defenses = build_defense_entries(defenses_old, effects_old, [a["id"] for a in attacks_old])
    defense_matches = build_defense_matching_table(attacks, defenses)

    attacks_new = {
        "seed": attacks_src.get("seed", 20260420),
        "states": STATES,
        "attacks": attacks,
    }

    defenses_new = {
        "seed": defenses_src.get("seed", 20260420),
        "states": STATES,
        "mitigate_map": MITIGATE_MAP,
        "defenses": defenses,
    }

    defense_effects_new = {
        "seed": effects_src.get("seed", 20260420),
        "description": "Defense matching table grouped by (attack, defender_state) in five-state model.",
        "score_formula": "score = 0.55*mitigate_effect + 0.35*counter_window_prob - 0.25*stamina_cost",
        "defense_matches": defense_matches,
    }

    opponent_profile_new = {
        "seed": profile_src.get("seed", 20260420),
        "states": STATES,
        "profile": profile_src.get("profile", "random_counter"),
        "counter_rate": profile_src.get("counter_rate", 0.37),
        "mistake_rate": profile_src.get("mistake_rate", 0.22),
        "recovery_if_defended": profile_src.get("recovery_if_defended", 0.41),
        "action_preference": profile_src.get("action_preference", {}),
    }

    action_library = {
        "seed": attacks_src.get("seed", 20260420),
        "states": STATES,
        "attack_types": {
            "stable_attack": "Directly chainable",
            "unstable_attack": "Requires reposition",
        },
        "actions": attacks + defenses,
    }

    recoil_table = {
        "description": "Recoil table extracted from attack self_transition fields.",
        "recoil": {a["id"]: a["self_transition"] for a in attacks},
    }

    defense_matching_table = {
        "defense_matches": defense_matches,
    }

    save_json(TABLE_DIR / "attacks.json", attacks_new)
    save_json(TABLE_DIR / "defenses.json", defenses_new)
    save_json(TABLE_DIR / "defense_effects.json", defense_effects_new)
    save_json(TABLE_DIR / "opponent_profile.json", opponent_profile_new)
    save_json(TABLE_DIR / "action_library.json", action_library)
    save_json(TABLE_DIR / "recoil_table.json", recoil_table)
    save_json(TABLE_DIR / "defense_matching_table.json", defense_matching_table)

    print("[OK] Upgraded random_tables to five-state schema.")


if __name__ == "__main__":
    main()
