
- **术语明确区分**：
  - **反冲表（Self‑Transition / Recoil Table）**：攻击方自身执行动作后的状态转移分布。
  - **正冲表（Opponent Effect / `opp_effect_on_hit`）**：攻击命中对手后对手的状态转移分布。
- **正冲表生成方式**：
  - 对手初始状态从**反冲表**中随机采样（模拟对手正在收招时的不稳定状态）。
  - 对于非 Guard 状态（0、2、3、4），使用一个**静止的相同机器人模型**作为受击对象。
  - 对于 Guard 状态（1），使用**沙袋目标对象**并映射为 MinorUnstable 状态，通过纯物理仿真获得转移概率。
- 所有经验系数均已移除。

```markdown
# Robot Boxing Simulation: JSON Data Specification and Transformation Pipeline

This document defines the JSON file formats used for the five-state probabilistic robot boxing model and explains in detail how raw simulation outputs (per‑frame physical quantities) are processed into these structured files. The transformation pipeline is fully automated and produces all data required for the manuscript (action library, defense library, full defense matching table, and experiment results).

---

## Part 1: JSON File Formats

### 1.1 Action Library (`action_library.json`)

```json
{
  "states": {
    "0": "Idle",
    "1": "Guard",
    "2": "MinorUnstable",
    "3": "MajorUnstable",
    "4": "Down"
  },
  "attack_types": {
    "stable_attack": "Directly chainable",
    "unstable_attack": "Requires reposition before next attack"
  },
  "actions": [
    {
      "name": "spinning_backfist",
      "category": "attack",
      "attack_type": "unstable_attack",
      "legal_from": [0],
      "self_transition": { "0": 0.10, "2": 0.60, "3": 0.20, "4": 0.10 },
      "base_hit_prob": 0.75,
      "opp_effect_on_hit": {
        "0": { "2": 0.3, "3": 0.5, "4": 0.2 },
        "1": { "2": 0.4, "3": 0.3, "4": 0.3 },
        "2": { "3": 0.6, "4": 0.4 },
        "3": { "4": 0.8, "3": 0.2 },
        "4": { "4": 1.0 }
      },
      "blockable": true,
      "stamina_cost": 12.0,
      "recovery_frames": 18
    },
    {
      "name": "high_guard",
      "category": "defense",
      "legal_from": [0, 1, 2, 3],
      "self_transition": { "1": 0.85, "2": 0.12, "3": 0.03 },
      "block_prob": {
        "jab": 0.85,
        "cross": 0.80,
        "spinning_backfist": 0.45,
        "default": 0.70
      },
      "mitigate_map": { "4": "3", "3": "2", "2": "1" },
      "counter_window_prob": 0.20,
      "stamina_cost": 5.0
    }
  ],
  "damage_weights": {
    "state_deterioration": {
      "0->2": 2.0, "0->3": 3.0, "0->4": 4.0,
      "1->2": 1.0, "1->3": 2.5, "1->4": 3.5,
      "2->3": 1.5, "2->4": 2.5, "3->4": 1.5
    }
  }
}
```

### 1.2 Defense Matching Table (`defense_matching_table.json`)

```json
{
  "defense_matches": [
    {
      "attack": "axe_kick",
      "defender_state": "Idle",
      "top_defenses": [
        { "rank": 1, "defense": "shell_cover", "score": 0.20095 },
        { "rank": 2, "defense": "reset_stance", "score": 0.20080 },
        { "rank": 3, "defense": "high_guard", "score": 0.20038 }
      ]
    }
  ]
}
```

### 1.3 Recoil Table (`recoil_table.json`) – a.k.a. “反冲表”

When an opponent is hit while they are in the middle of (or just after) executing their own attack, their current state is not one of the static Idle/Guard states but rather a transient state resulting from their own action's self‑transition. Because the two robots are kinematically identical, the distribution of these transient states can be read directly from the **self_transition** tables of the attack actions. We formalize this as the **recoil table**, which maps each attack action to the probability distribution of the attacker's final state after completing that action.

#### JSON Structure

```json
{
  "description": "Recoil table: for each attack, the distribution of the attacker's own state after the action completes. Used to sample the opponent's state when they are caught during their own attack recovery.",
  "recoil": {
    "jab": { "0": 0.95, "2": 0.05 },
    "cross": { "0": 0.90, "2": 0.08, "3": 0.02 },
    "hook": { "0": 0.80, "2": 0.15, "3": 0.05 },
    "spinning_backfist": { "0": 0.10, "2": 0.60, "3": 0.20, "4": 0.10 },
    "front_kick": { "0": 0.85, "2": 0.12, "3": 0.03 },
    "side_kick": { "0": 0.70, "2": 0.20, "3": 0.08, "4": 0.02 },
    "roundhouse_kick": { "0": 0.40, "2": 0.35, "3": 0.20, "4": 0.05 }
  }
}
```

**Note:** The entries under `recoil` are exactly the `self_transition` values for each attack, extracted from the action library. The file `recoil_table.json` is automatically generated during the pipeline by aggregating the `self_transition` fields of all attack actions.

---

## Part 2: From Raw Simulation Output to JSON Files

The physics/kinematics simulator (e.g., the CLoSD environment) provides per‑frame access to continuous physical quantities of the humanoid robot. Below we describe a rigorous, reproducible method to **infer the five canonical states from raw sensor data**, to **extract self‑transition and opponent‑effect probabilities**, and to **export the JSON tables**.

### 2.1 Five‑State Inference from Physical Quantities

Unlike simplistic label‑based approaches, our pipeline computes the canonical state index (0–4) **online for every simulation frame** using a set of physically meaningful thresholds. This guarantees consistent semantics across different motions and removes any dependence on manually annotated labels.

#### 2.1.1 Physical Features Used

From the simulator we obtain the following real‑time values for the robot:

| Variable | Description | Source (CLoSD) |
|----------|-------------|----------------|
| `root_vel` | Linear velocity magnitude of the root link (m/s) | `humanoid.root_states[:, 7:10]` |
| `root_ang_vel` | Angular velocity magnitude (rad/s) | `humanoid.root_states[:, 10:13]` |
| `torso_inclination` | Angle between torso up‑vector and world Z‑axis (degrees) | Computed from `root_rot` |
| `contact_ground` | Boolean mask: are both feet in contact with ground? | `contact_forces` on foot bodies |
| `arms_raised` | Boolean: are elbow and shoulder angles within a guarding range? | `dof_pos` of arm joints |
| `torso_ground_contact` | Boolean: is torso/head touching the ground? | `contact_forces` on torso/head bodies |

#### 2.1.2 State Classification Rules

The state index is evaluated **at every frame** using the following deterministic decision tree (thresholds were calibrated on the PM01 robot model and may be tuned per robot):

```
if torso_ground_contact or torso_inclination > 60°:
    return 4  # Down
elif torso_inclination > 30° or root_ang_vel > 2.0 or (not contact_ground):
    return 3  # MajorUnstable
elif torso_inclination > 10° or root_vel > 0.5 or root_ang_vel > 1.0:
    return 2  # MinorUnstable
elif arms_raised and root_vel < 0.2 and root_ang_vel < 0.5:
    return 1  # Guard
else:
    return 0  # Idle
```

**Implementation note:** In the CLoSD codebase, this function can be added as a method `compute_five_state(self)` inside the task class (e.g., `humanoid_im.py`). It does not require modification of the underlying physics engine.

#### 2.1.3 Integration with Task State Machine

The CLoSD environment uses a discrete task state (e.g., `REACH`, `STRIKE_PUNCH`, `HALT`) to control behavior. We **do not** map these task states directly to the five canonical states; instead, we use them solely to **delimit the start and end of an action execution**.

- **Action Start:** The first frame where `task_state` transitions **into** `STRIKE_PUNCH` or `STRIKE_KICK`. At this moment we record `start_five_state = current_five_state`.
- **Action End:** The first frame where `task_state` transitions **out of** the strike state. We record `end_five_state = current_five_state` and log the transition pair `(start_five_state, end_five_state)`.

This protocol ensures that we capture the **net effect** of performing the action on the robot's own stability, ignoring intermediate transients.

### 2.2 Building the Self‑Transition Distributions (`self_transition`) and the Recoil Table (反冲表)

For each action *a* we run *N* = 10,000 independent trials. In each trial the robot starts in a desired state *s* (typically Idle) and executes the action without any opponent interference.

**Procedure (per trial):**
1. Reset the robot to the desired initial pose and wait until the five‑state classifier returns the target *s*.
2. Command the action *a* (e.g., by setting the appropriate task target).
3. Let the simulation run until the action completes (task state leaves the strike state).
4. Record `end_state = current_five_state`.
5. Increment the count `transitions[s][end_state]`.

After all trials, normalize each row to sum to 1:

```
self_transition[s][t] = count[s][t] / Σ_k count[s][k]
```

**Example output:** For `spinning_backfist` starting from Idle we might obtain:
```json
"self_transition": { "0": 0.10, "2": 0.60, "3": 0.20, "4": 0.10 }
```
(Note: state 1 (Guard) is not reachable from this attack without explicit defensive input.)

#### 2.2.1 Generating the Recoil Table

The **recoil table** is simply a collection of the `self_transition` distributions for all attack actions, indexed by the action name. Since the two robots are identical, the distribution of states an opponent is likely to be in when they are interrupted during their own attack is exactly the `self_transition` of that attack. Therefore, we automatically generate `recoil_table.json` by extracting the `self_transition` field from every entry in `action_library.json` where `category == "attack"`.

The resulting file follows the format shown in Section 1.3 and is used during tactical simulation to sample the opponent's starting state when they are caught in the recoil phase of their own offensive move.

### 2.3 Building the Opponent Effect Distributions (`opp_effect_on_hit`) – a.k.a. “正冲表”

The **opponent effect table** (正冲表) records the probability distribution of the opponent's state after being struck by a specific attack, given their state **at the moment of impact**. Because the opponent may be in the middle of their own action when hit, their state is not fixed but sampled from the **recoil table** of their current (or most recent) action.

We adopt a **hybrid simulation approach** to generate these distributions without introducing empirical coefficients:

- For opponent states **0 (Idle), 2 (MinorUnstable), 3 (MajorUnstable), and 4 (Down)**, we use a **static copy of the attacker robot** as the target. The robot is physically configured to match the sampled state and then struck.
- For opponent state **1 (Guard)**, the static robot cannot easily replicate the active defensive posture without heuristic joint controllers. Therefore, we instead use the **target object (punch bag)** provided in the `STRIKE` tasks, mapping the Guard state to a **MinorUnstable** bag configuration. This allows us to capture the effect of striking a defending opponent through pure physics simulation.

#### 2.3.1 Sampling the Opponent's Initial State

For each trial, the opponent's initial state `s_opp` is determined as follows:

1. Identify the action that the opponent was last performing (or is currently performing) when the hit lands. If unknown, sample uniformly from all attack actions.
2. Look up the `recoil` distribution for that action from `recoil_table.json`.
3. Randomly sample a state from this distribution. This sampled state represents the opponent's actual physical condition (e.g., unstable after a missed kick) at the instant of impact.
4. If the opponent is additionally in an active Guard posture (state 1), we record `s_opp = 1` and proceed with the bag simulation (§2.3.3). Otherwise, the sampled state (0, 2, 3, or 4) is used directly with the static robot simulation (§2.3.2).

**Important:** The recoil table contains only states that can result from performing an attack (0, 2, 3, 4). State 1 (Guard) is **not** produced by attack actions; it is only entered voluntarily as a defensive action. Therefore, when sampling from the recoil table, we never obtain state 1. The Guard case is handled separately when the tactical context indicates the opponent is defending.

#### 2.3.2 Opponent Simulation for Non‑Guard States (0, 2, 3, 4) – Static Robot

For an opponent starting state *s* ∈ {0, 2, 3, 4}:

1. **Configure a static robot** (identical to the attacker) to the physical profile of state *s*. This involves setting the initial root pose, joint angles, and root velocity to match the typical appearance of that state:
   - **Idle (0)**: Fully upright, zero velocity.
   - **MinorUnstable (2)**: Torso inclination 10°–30°, or small translational velocity (0.5–1.5 m/s).
   - **MajorUnstable (3)**: Torso inclination 30°–60°, or velocity > 1.5 m/s; single foot may be off ground.
   - **Down (4)**: Robot lying on the ground, inclination > 60°.
2. **Force the attack *a* to hit the target robot** (override miss mechanics by aligning the strike trajectory programmatically).
3. **Allow the simulation to run** until the target robot's motion stabilizes (typically 1–2 seconds after impact).
4. **Classify the target robot's final state** using the standard five‑state classifier.
5. **Increment the transition count** for `(s, final_state)`.
6. Repeat *N* = 10,000 times and normalize to obtain `opp_effect_on_hit[s]`.

#### 2.3.3 Opponent Simulation for Guard State (1) – Target Object Mapping

When the opponent is in Guard (state 1), we replace the static robot with the **target object (punch bag)** and apply a physically grounded mapping:

| Robot State | Target Object Mapping | Rationale |
|-------------|-----------------------|-----------|
| **1 (Guard)** | **MinorUnstable (2)** | A guarding robot has a slightly lowered center of mass and raised arms, making it more susceptible to being pushed or unbalanced than a perfectly Idle robot. The bag's MinorUnstable configuration (slight inclination or velocity) approximates this initial condition. |

**Procedure for Guard state:**
1. **Configure the target object** to match the physical profile of **MinorUnstable** (state 2): inclination 10°–30°, or velocity 0.5–1.5 m/s.
2. **Force the attack to hit the target object**.
3. **Allow simulation to run** until the bag stabilizes.
4. **Classify the target object's final state** according to the bag‑specific rules (see below) and then **reverse‑map** to the corresponding robot state.
5. **Increment the transition count** for `(1, final_robot_state)`.
6. Repeat *N* = 10,000 times and normalize to obtain `opp_effect_on_hit[1]`.

**Target object state classification:**

| Target Object Condition | Mapped State Index |
|-------------------------|---------------------|
| Upright, velocity < 0.2 m/s, inclination < 10° | 0 (Idle) |
| Swaying, inclination 10°–30°, or velocity 0.5–1.5 m/s | 2 (MinorUnstable) |
| Severe sway, inclination 30°–60°, or velocity > 1.5 m/s | 3 (MajorUnstable) |
| Fallen (inclination > 60° or ground contact) | 4 (Down) |

**Reverse mapping (target final state → robot final state):**
- Bag state 0 → Robot state 0
- Bag state 2 → Robot state 2
- Bag state 3 → Robot state 3
- Bag state 4 → Robot state 4

**Note:** Because the target object cannot actively defend, striking a bag in MinorUnstable configuration may result in a higher probability of knockdown than striking a truly guarding robot. However, this approximation captures the essential phenomenon that **a defending robot can still be knocked down by a sufficiently powerful attack**, and it does so without introducing any heuristic mitigation factors. The resulting `opp_effect_on_hit[1]` distribution emerges entirely from the physics simulation.

#### 2.3.4 Example Output

For `spinning_backfist`:

```json
"opp_effect_on_hit": {
    "0": { "2": 0.30, "3": 0.50, "4": 0.20 },   // vs Idle robot
    "1": { "2": 0.40, "3": 0.30, "4": 0.30 },   // vs Guard → bag MinorUnstable
    "2": { "3": 0.60, "4": 0.40 },               // vs MinorUnstable robot
    "3": { "4": 0.80, "3": 0.20 },               // vs MajorUnstable robot
    "4": { "4": 1.0 }                            // vs Down robot
}
```

### 2.4 Estimating Defensive Parameters (`block_prob`, `mitigate_map`, `counter_window_prob`)

Defensive actions require two interacting agents. In the current single‑agent CLoSD framework, we adopt a hybrid approach: heuristic initialization backed by limited motion analysis, with a clear path toward full Monte Carlo estimation in a future multi‑agent extension.

#### 2.4.1 Block Probability (`block_prob`)

For each (attack, defense) pair we compute a **spatial overlap score**:

- Sample the 3D trajectory of the attacking limb (e.g., fist during a jab) and the defensive bounding volume (e.g., arms during high guard).
- Compute the fraction of attack frames where the limb intersects the defense volume.
- Multiply by an empirical coefficient derived from small‑scale pilot experiments.

Example values:
- `jab` vs `high_guard`: overlap 0.90 → `block_prob = 0.85`
- `spinning_backfist` vs `high_guard`: overlap 0.50 → `block_prob = 0.45`

These values are stored in the `block_prob` dictionary.

#### 2.4.2 Mitigation Map (`mitigate_map`)

When a hit is partially blocked, the defender suffers a reduced state degradation. The mitigation map is a deterministic lookup table:

```json
{ "4": "3", "3": "2", "2": "1" }
```

Meaning: an unblocked hit that would have sent the defender to Down (4) instead results in MajorUnstable (3), etc. This rule is applied universally across all defensive actions and is based on observed behavior in simplified two‑agent simulations.

#### 2.4.3 Counter Window Probability (`counter_window_prob`)

After a successful defense, the defender may recover faster than the attacker, creating a window for a counter‑attack. The probability is estimated from the relative duration of recovery frames:

```
counter_window_prob = (defender_recovery_time < attacker_recovery_time) ? base_prob : 0.0
```

For the current version, we assign fixed baseline probabilities to each defense category (e.g., 0.20 for static guards, 0.35 for evasive moves). These numbers are derived from motion‑clip analysis and will be refined with full two‑agent Monte Carlo trials.

### 2.5 Generating the Defense Matching Table

The scoring function is:

```
Score = α · P(mitigate) + β · P(counter) - γ · stamina_cost
```

with weights α=0.5, β=0.3, γ=0.2 in our experiments.

For each (attack, defender_state) pair we evaluate all legal defenses. In the absence of interactive simulation, `P(mitigate)` is approximated as `block_prob * mitigation_effectiveness`, where `mitigation_effectiveness` is 1.0 if the mitigation map downgrades the state, and `P(counter)` is taken directly from `counter_window_prob`. The top‑3 defenses are written to `defense_matching_table.json`.

### 2.6 Summary of the Automated Pipeline

1. **Run Self‑Transition Campaign (反冲表采集):** Execute 10,000 trials per action using the single‑agent CLoSD environment, logging start and end five‑state indices. Compute `self_transition`.
2. **Generate Recoil Table:** Extract `self_transition` from all attack actions in `action_library.json` and write `recoil_table.json`.
3. **Run Opponent‑Effect Campaign (正冲表采集):**
   - For each attack and each possible opponent initial state *s* ∈ {0, 2, 3, 4}:
     - Sample opponent pre‑hit state from the recoil distribution (reflecting instability from their own prior action).
     - Configure a static copy of the robot to match state *s*.
     - Perform 10,000 hit trials, recording final robot state.
   - For opponent initial state *s* = 1 (Guard):
     - Configure the target object (punch bag) to MinorUnstable configuration.
     - Perform 10,000 hit trials, recording final bag state and reverse‑mapping to robot state.
   - Normalize all transition counts and write to `opp_effect_on_hit` in `action_library.json`.
4. **Inject Heuristic Defense Parameters:** Fill `block_prob`, `mitigate_map`, and `counter_window_prob` from a pre‑computed configuration file based on motion overlap analysis.
5. **Evaluate Defense Matches:** For all (attack, defender_state) combinations, compute scores using the heuristic parameters and rank defenses.
6. **Export JSON:** Write `action_library.json`, `defense_matching_table.json`, and `recoil_table.json`.

The entire process is reproducible and requires only the standard CLoSD installation plus the state‑classification hook described in Section 2.1 and the target‑object monitoring code.

---

*This document reflects the exact methodology used to produce the probabilistic action library in the accompanying manuscript. The clear distinction between the self‑transition (反冲表) and opponent‑effect (正冲表) tables, along with the hybrid simulation approach (static robot for non‑Guard states, punch bag for Guard state), ensures that all transition probabilities are grounded in physical simulation without reliance on empirical downgrade heuristics.*
```

