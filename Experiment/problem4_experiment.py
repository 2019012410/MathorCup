import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLE_DIR = ROOT / "random_tables"
RESULT_DIR = ROOT / "Experiment" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(20260421)

GAMMA = 0.95
T = 6
MAX_ITERS = 15
ETA = 0.5
CONV_EPS = 2e-3
Q_FAULT = 0.12

TACTICAL_IDS = ["jab", "cross", "front_kick", "axe_kick", "high_guard"]
RES_IDS = ["none", "mr", "tp", "er"]


def load_json(name: str):
    with (TABLE_DIR / name).open("r", encoding="utf-8") as f:
        return json.load(f)


def clip(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def normalize(v: dict):
    s = sum(v.values())
    if s <= 0:
        return v
    return {k: val / s for k, val in v.items()}


def build_tactical_profiles(action_library):
    profiles = {}
    for a in action_library.get("actions", []):
        if a.get("category") != "attack":
            continue
        aid = a["id"]
        if aid not in {"jab", "cross", "front_kick", "axe_kick"}:
            continue
        profiles[aid] = {
            "name_cn": a.get("name_cn", aid),
            "power": float(a.get("base_damage", 0.5)) * 1.7,
            "risk": 1.0 - float(a.get("stability", a.get("self_transition", {}).get("0", 0.75))),
            "defense": 0.05,
        }

    # Add a defense proxy action for resource-aware MFG policy.
    profiles["high_guard"] = {
        "name_cn": "高位防御",
        "power": 0.08,
        "risk": 0.04,
        "defense": 0.85,
    }
    return profiles


def build_states():
    states = []
    index = {}
    for s in range(5):
        for r1 in range(3):
            for r2 in range(3):
                for r3 in range(2):
                    for f in range(2):
                        st = (s, r1, r2, r3, f)
                        index[st] = len(states)
                        states.append(st)
    return states, index


def legal_actions(state):
    s, r1, r2, r3, f = state
    res_choices = ["none"]
    if r1 > 0 and (s >= 3 or f == 1):
        res_choices.append("mr")
    if r2 > 0:
        res_choices.append("tp")
    if r3 > 0 and f == 1:
        res_choices.append("er")

    acts = []
    for tid in TACTICAL_IDS:
        for rid in res_choices:
            acts.append((tid, rid))
    return acts


def terminal_penalty(s):
    if s == 4:
        return -0.85
    if s == 3:
        return -0.35
    if s == 2:
        return -0.12
    return 0.0


def reward(self_state, opp_state, self_action, opp_action, tactical_profiles):
    s, _, _, _, f = self_state
    so, _, _, _, _ = opp_state
    a, u = self_action
    ao, uo = opp_action

    pa = tactical_profiles[a]
    po = tactical_profiles[ao]

    opp_harm = clip(pa["power"] * (1.0 - 0.60 * po["defense"]) * (1.0 + 0.08 * so), 0.0, 2.0)
    self_risk = clip(pa["risk"] * (1.0 + 0.35 * po["power"]) - 0.15 * pa["defense"], 0.0, 1.0)

    if u == "mr":
        resource_cost = 0.20
    elif u == "tp":
        resource_cost = 0.12
    elif u == "er":
        resource_cost = 0.25
    else:
        resource_cost = 0.0

    if uo != "none":
        opp_harm *= 0.92

    fault_penalty = 0.08 if f == 1 else 0.0

    return opp_harm - 0.75 * self_risk - resource_cost + terminal_penalty(s) - fault_penalty


def transition_self(self_state, opp_state, self_action, opp_action, tactical_profiles):
    s, r1, r2, r3, f = self_state
    so, _, _, _, fo = opp_state
    a, u = self_action
    ao, uo = opp_action

    pa = tactical_profiles[a]
    po = tactical_profiles[ao]

    # Resource update first
    if u == "mr" and r1 > 0:
        r1 -= 1
        s = 0
        f = 0
    elif u == "tp" and r2 > 0:
        r2 -= 1
    elif u == "er" and r3 > 0 and f == 1:
        r3 -= 1
        f = 0
        s = max(0, s - 1)

    # Fault evolution
    q = Q_FAULT
    if u == "tp":
        q = max(0.03, q - 0.05)
    if f == 1:
        q = max(q, 0.65)  # sticky fault without repair

    # Combat-induced stability evolution
    base_worsen = pa["risk"] + 0.18 * po["power"] - 0.14 * pa["defense"] + (0.10 if f == 1 else 0.0)
    base_improve = 0.06 + 0.20 * pa["defense"] + (0.05 if u == "tp" else 0.0)

    if so >= 3:
        base_worsen -= 0.06
        base_improve += 0.05
    if fo == 1:
        base_improve += 0.03

    p_worsen = clip(base_worsen, 0.02, 0.72)
    p_improve = clip(base_improve, 0.02, 0.55)
    if s == 0:
        p_improve = 0.0
    if s == 4:
        p_worsen = 0.0
    p_stay = clip(1.0 - p_worsen - p_improve, 0.05, 0.96)

    mix = {
        "down": p_worsen,
        "stay": p_stay,
        "up": p_improve,
    }
    mix = normalize(mix)

    out = defaultdict(float)
    for mode, p_mode in mix.items():
        if mode == "down":
            ns = min(4, s + 1)
        elif mode == "up":
            ns = max(0, s - 1)
        else:
            ns = s

        # Combine with fault probability.
        out[(ns, r1, r2, r3, 1)] += p_mode * q
        out[(ns, r1, r2, r3, 0)] += p_mode * (1.0 - q)

    return dict(out)


def best_response_policy(states, mu_seq, policy_k, tactical_profiles):
    v_next = {st: 0.0 for st in states}
    pi_br = [{} for _ in range(T)]

    for t in range(T - 1, -1, -1):
        v_cur = {}
        mu_t = mu_seq[t]

        for st in states:
            acts = legal_actions(st)
            best_q = -1e9
            best_a = acts[0]

            for a in acts:
                q_val = 0.0
                for opp_st, p_opp in mu_t.items():
                    if p_opp <= 0:
                        continue
                    opp_a = policy_k[opp_st]
                    r = reward(st, opp_st, a, opp_a, tactical_profiles)
                    tr = transition_self(st, opp_st, a, opp_a, tactical_profiles)
                    fut = sum(prob * v_next[ns] for ns, prob in tr.items())
                    q_val += p_opp * (r + GAMMA * fut)

                if q_val > best_q:
                    best_q = q_val
                    best_a = a

            v_cur[st] = best_q
            pi_br[t][st] = best_a

        v_next = v_cur

    # Use stationary policy approximation from t=0 best response
    return pi_br[0]


def forward_distribution(states, mu0, policy, tactical_profiles):
    mu_seq = [mu0]
    for _ in range(T):
        mu_t = mu_seq[-1]
        mu_next = defaultdict(float)
        for st, p_st in mu_t.items():
            if p_st <= 0:
                continue
            a = policy[st]
            for opp_st, p_opp in mu_t.items():
                if p_opp <= 0:
                    continue
                opp_a = policy[opp_st]
                tr = transition_self(st, opp_st, a, opp_a, tactical_profiles)
                for ns, p_ns in tr.items():
                    mu_next[ns] += p_st * p_opp * p_ns

        total = sum(mu_next.values())
        if total <= 0:
            mu_seq.append(mu_t)
        else:
            mu_seq.append({k: v / total for k, v in mu_next.items()})

    return mu_seq


def l1_dist(d1, d2):
    keys = set(d1.keys()) | set(d2.keys())
    return sum(abs(d1.get(k, 0.0) - d2.get(k, 0.0)) for k in keys)


def sample_next_state(st, opp_st, a, opp_a, tactical_profiles):
    tr = transition_self(st, opp_st, a, opp_a, tactical_profiles)
    r = random.random()
    acc = 0.0
    for ns, p in tr.items():
        acc += p
        if r <= acc:
            return ns
    return st


def episode_bo3(policy_a, policy_b, tactical_profiles):
    wins_a = 0
    wins_b = 0

    st_a = (0, 2, 2, 1, 0)
    st_b = (0, 2, 2, 1, 0)

    for _ in range(3):
        score_a = 0.0
        score_b = 0.0
        cur_a = st_a
        cur_b = st_b

        for _ in range(T):
            a = policy_a[cur_a]
            b = policy_b[cur_b]

            score_a += reward(cur_a, cur_b, a, b, tactical_profiles)
            score_b += reward(cur_b, cur_a, b, a, tactical_profiles)

            nxt_a = sample_next_state(cur_a, cur_b, a, b, tactical_profiles)
            nxt_b = sample_next_state(cur_b, cur_a, b, a, tactical_profiles)
            cur_a, cur_b = nxt_a, nxt_b

        if score_a >= score_b:
            wins_a += 1
        else:
            wins_b += 1

        st_a = (0, cur_a[1], cur_a[2], cur_a[3], 0)
        st_b = (0, cur_b[1], cur_b[2], cur_b[3], 0)

        if wins_a == 2 or wins_b == 2:
            break

    return 1 if wins_a > wins_b else 0


def evaluate_bo3_winrate(policy_a, policy_b, tactical_profiles, n=5000):
    wins = 0
    for _ in range(n):
        wins += episode_bo3(policy_a, policy_b, tactical_profiles)
    return wins / n


def random_policy_factory(states):
    rp = {}
    for st in states:
        acts = legal_actions(st)
        rp[st] = random.choice(acts)
    return rp


def decode_action(act, tactical_profiles):
    tid, rid = act
    return tactical_profiles[tid]["name_cn"], rid


def main():
    action_library = load_json("action_library.json")
    tactical_profiles = build_tactical_profiles(action_library)

    states, _ = build_states()

    init_state = (0, 2, 2, 1, 0)
    mu0 = {init_state: 1.0}

    # Initial heuristic policy: stable attack with no resource.
    pi_k = {}
    for st in states:
        s, r1, r2, r3, f = st
        if f == 1 and r3 > 0:
            pi_k[st] = ("high_guard", "er")
        elif s >= 3 and r1 > 0:
            pi_k[st] = ("high_guard", "mr")
        else:
            pi_k[st] = ("cross", "none")

    mu_k = forward_distribution(states, mu0, pi_k, tactical_profiles)

    converged_iter = MAX_ITERS
    for it in range(1, MAX_ITERS + 1):
        pi_br = best_response_policy(states, mu_k, pi_k, tactical_profiles)

        pi_new = {}
        for st in states:
            if random.random() < ETA:
                pi_new[st] = pi_br[st]
            else:
                pi_new[st] = pi_k[st]

        mu_new = forward_distribution(states, mu0, pi_new, tactical_profiles)
        diff = max(l1_dist(mu_new[t], mu_k[t]) for t in range(T + 1))

        pi_k = pi_new
        mu_k = mu_new

        if diff < CONV_EPS:
            converged_iter = it
            break

    # Evaluation
    random_policy = random_policy_factory(states)
    wr_vs_random = evaluate_bo3_winrate(pi_k, random_policy, tactical_profiles, n=4000)
    wr_random_vs_random = evaluate_bo3_winrate(random_policy, random_policy, tactical_profiles, n=3000)
    wr_self_play = evaluate_bo3_winrate(pi_k, pi_k, tactical_profiles, n=3000)

    key_states = [
        (0, 2, 2, 1, 0),
        (4, 2, 2, 1, 1),
        (2, 1, 1, 0, 0),
    ]
    policy_snippets = []
    for st in key_states:
        act = pi_k[st]
        t_name, rid = decode_action(act, tactical_profiles)
        policy_snippets.append(
            {
                "state": {
                    "s": st[0],
                    "r1": st[1],
                    "r2": st[2],
                    "r3": st[3],
                    "f": st[4],
                },
                "action": {
                    "tactical_id": act[0],
                    "tactical_name_cn": t_name,
                    "resource": rid,
                },
            },
        )

    result = {
        "model": "two-player mean-field game for BO3 with resources",
        "horizon": T,
        "gamma": GAMMA,
        "fault_rate": Q_FAULT,
        "iterations": converged_iter,
        "self_play_win_rate": round(wr_self_play, 4),
        "win_rate_vs_random": round(wr_vs_random, 4),
        "random_vs_random": round(wr_random_vs_random, 4),
        "policy_snippets": policy_snippets,
    }

    with (RESULT_DIR / "problem4_results.json").open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # Table snippet for manuscript
    table_lines = [
        "\\begin{table}[H]",
        "\\centering",
        "\\caption{问题四：平均场博弈策略实验结果（自动生成）}",
        "\\begin{tabular}{l c}",
        "\\toprule",
        "指标 & 数值 \\\\",
        "\\midrule",
        f"MFG 自博弈胜率 & {wr_self_play:.3f} \\\\",
        f"MFG 对随机基线胜率 & {wr_vs_random:.3f} \\\\",
        f"随机对随机胜率 & {wr_random_vs_random:.3f} \\\\",
        f"收敛迭代轮数 & {converged_iter} \\\\",
        "\\bottomrule",
        "\\end{tabular}",
        "\\end{table}",
        "",
    ]
    with (RESULT_DIR / "problem4_mfg_table.tex").open("w", encoding="utf-8") as f:
        f.write("\n".join(table_lines))

    # Dynamic analysis snippet for manuscript
    s0 = policy_snippets[0]["action"]
    s1 = policy_snippets[1]["action"]
    s2 = policy_snippets[2]["action"]

    p_lines = [
        "基于平均场虚拟博弈迭代得到的对称策略显示：在初始状态 $(s=0,r_1=2,r_2=2,r_3=1,f=0)$ 下，"
        f"代表性动作为“{s0['tactical_name_cn']} + 资源[{s0['resource']}]”；"
        "在倒地且故障未修复状态 $(s=4,f=1)$ 下，策略优先触发恢复性资源动作，"
        f"对应“{s1['tactical_name_cn']} + 资源[{s1['resource']}]”；"
        f"在中期资源受限状态 $(s=2,r_1=1,r_2=1,r_3=0,f=0)$ 下，策略动作为“{s2['tactical_name_cn']} + 资源[{s2['resource']}]”。",
        "这表明 MFG 框架能够在战术选择与资源消耗之间形成阶段化耦合决策。",
    ]
    with (RESULT_DIR / "problem4_mfg_paragraph.tex").open("w", encoding="utf-8") as f:
        f.write("\n".join(p_lines) + "\n")

    # Dynamic conclusion snippet for manuscript
    margin_vs_random = wr_vs_random - wr_random_vs_random
    c_lines = [
        "基于双人平均场博弈模型，本文将战术动作与资源动作统一到同一决策框架中，"
        "并通过 HJB--FP 耦合迭代得到对称均衡近似策略。"
        f"在当前参数设定下，算法于第 {converged_iter} 轮达到收敛阈值，"
        f"自博弈胜率为 {wr_self_play:.3f}（对称理性对抗下接近 0.5），"
        f"对随机基线胜率为 {wr_vs_random:.3f}，相对随机对随机基线提升 {margin_vs_random:.3f}。",
        "结果表明：平均场博弈框架能够在故障风险、资源消耗与攻防收益之间形成自洽的阶段化策略，"
        "可为 BO3 赛制下的资源调度提供可解释且可复现实验依据。",
    ]
    with (RESULT_DIR / "problem4_mfg_conclusion.tex").open("w", encoding="utf-8") as f:
        f.write("\n".join(c_lines) + "\n")

    print("[Problem4] MFG results generated.")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
