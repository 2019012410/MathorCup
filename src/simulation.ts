import { ACTIONS } from './actions';
import {
  ActionKey,
  BattleEvent,
  BattleSummary,
  BattleStrategy,
  CircleZone,
  DefenseCircle,
  DefenseCoverage,
  FighterRuntime,
  HitWindow,
  HudData,
  ImpactFlash,
  RobotState,
  ScriptEvent,
  TacticalCondition,
  TacticalRule,
  TargetZone,
} from './types';
import { createFighterPoseData, PoseCollisionData } from './kinematics';
import { createBattleScripts } from './scripts';

const BATTLE_DURATION = 60;
const ARENA_MIN_X = 140;
const ARENA_MAX_X = 1140;
const MIN_DISTANCE = 108;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;

const distanceSq = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const lineCircleHit = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  circle: { center: { x: number; y: number }; radius: number },
  radius: number,
) => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const denom = abx * abx + aby * aby || 1;
  const t = clamp(((circle.center.x - a.x) * abx + (circle.center.y - a.y) * aby) / denom, 0, 1);
  const closest = { x: a.x + abx * t, y: a.y + aby * t };
  return distanceSq(closest, circle.center) <= Math.pow(circle.radius + radius, 2);
};

const createFighter = (id: string, name: string, side: 'left' | 'right', x: number): FighterRuntime => ({
  id,
  name,
  side,
  health: 100,
  stamina: 100,
  balance: 100,
  knockdowns: 0,
  landedHits: 0,
  blockedHits: 0,
  parries: 0,
  evades: 0,
  score: 0,
  state: RobotState.Idle,
  currentAction: null,
  actionTime: 0,
  previousRootX: 0,
  queuedAction: null,
  queuedAt: 0,
  recoveryLeft: 0,
  standProtectionLeft: 0,
  guardLeft: 0,
  stunnedLeft: 0,
  downLeft: 0,
  flashLeft: 0,
  scriptIndex: 0,
  x,
  velocityX: 0,
  resolvedHits: [],
});

type StrategyPair = {
  left: BattleStrategy;
  right: BattleStrategy;
};

export class BattleSimulation {
  readonly left = createFighter('left', 'Atlas', 'left', 390);
  readonly right = createFighter('right', 'Helios', 'right', 890);

  private strategies: StrategyPair;
  private readonly events: BattleEvent[] = [];
  private readonly flashes: ImpactFlash[] = [];
  private readonly tacticalCooldowns = new Map<string, number>();
  private elapsed = 0;
  private finished = false;
  private summary: BattleSummary | null = null;

  constructor(strategies: StrategyPair = createBattleScripts()) {
    this.strategies = {
      left: strategies.left,
      right: strategies.right,
    };
    this.pushEvent(0, `脚本对打已开始，本局战术池：${this.strategies.left.name} vs ${this.strategies.right.name}。`);
  }

  getHudData(): HudData {
    return {
      elapsed: this.elapsed,
      duration: BATTLE_DURATION,
      left: { ...this.left },
      right: { ...this.right },
      events: [...this.events],
      summary: this.summary,
      flashes: this.flashes.map((flash) => ({ ...flash })),
    };
  }

  reset() {
    Object.assign(this.left, createFighter('left', 'Atlas', 'left', 390));
    Object.assign(this.right, createFighter('right', 'Helios', 'right', 890));
    this.strategies = createBattleScripts();
    this.events.length = 0;
    this.flashes.length = 0;
    this.tacticalCooldowns.clear();
    this.elapsed = 0;
    this.finished = false;
    this.summary = null;
    this.pushEvent(0, `仿真已重置，新战术池：${this.strategies.left.name} vs ${this.strategies.right.name}。`);
  }

  update(dt: number) {
    const step = Math.min(dt, 1 / 60);
    if (!this.finished) {
      this.elapsed += step;
      this.tickFighter(this.left, this.right, this.strategies.left, step);
      this.tickFighter(this.right, this.left, this.strategies.right, step);

      this.integrateMovement(this.left, this.right, step);
      this.integrateMovement(this.right, this.left, step);
      this.enforceSpacing();

      const leftPose = createFighterPoseData(this.left, this.elapsed);
      const rightPose = createFighterPoseData(this.right, this.elapsed);

      this.resolveActionEffects(this.left, leftPose, this.right, rightPose, step);
      this.resolveActionEffects(this.right, rightPose, this.left, leftPose, step);

      this.finishActionIfNeeded(this.left);
      this.finishActionIfNeeded(this.right);
      this.updateState(this.left);
      this.updateState(this.right);

      if (this.left.health <= 0 || this.right.health <= 0 || this.elapsed >= BATTLE_DURATION) {
        this.finishBattle();
      }
    }

    this.fadeEffects(step);
  }

  private tickFighter(fighter: FighterRuntime, opponent: FighterRuntime, strategy: BattleStrategy, dt: number) {
    fighter.recoveryLeft = Math.max(0, fighter.recoveryLeft - dt);
    fighter.standProtectionLeft = Math.max(0, fighter.standProtectionLeft - dt);
    fighter.guardLeft = Math.max(0, fighter.guardLeft - dt);
    fighter.stunnedLeft = Math.max(0, fighter.stunnedLeft - dt);
    fighter.downLeft = Math.max(0, fighter.downLeft - dt);
    fighter.flashLeft = Math.max(0, fighter.flashLeft - dt);
    fighter.stamina = clamp(fighter.stamina + dt * 9, 0, 100);
    fighter.balance = clamp(
      fighter.balance + dt * (
        fighter.currentAction === 'resetStance'
          ? 27
          : fighter.state === RobotState.Recovering || fighter.recoveryLeft > 0.24 || fighter.standProtectionLeft > 0
            ? fighter.standProtectionLeft > 0
              ? 19.5
              : 14.4
            : fighter.state === RobotState.Staggered
              ? 2.2
              : 4.2
      ),
      0,
      100,
    );

    const grounded = fighter.downLeft > 0;
    const pursuingDownedOpponent = opponent.downLeft > 0 && !grounded;
    const distanceToOpponent = Math.abs(opponent.x - fighter.x);

    if (pursuingDownedOpponent) {
      fighter.queuedAction = null;
      if (fighter.currentAction && fighter.currentAction !== 'groundStomp') {
        const currentAction = ACTIONS[fighter.currentAction];
        const progress = currentAction.duration > 0 ? fighter.actionTime / currentAction.duration : 1;
        const shouldAbortForStomp =
          currentAction.group !== 'attack' ||
          progress < 0.82;

        if (shouldAbortForStomp) {
          fighter.currentAction = null;
          fighter.actionTime = 0;
          fighter.guardLeft = 0;
          fighter.recoveryLeft = Math.min(fighter.recoveryLeft, 0.06);
          fighter.resolvedHits = [];
        }
      }
    }

    if (fighter.currentAction) {
      fighter.actionTime += dt;
      this.tryQueueFollowUp(fighter, strategy.timeline);
      return;
    }

    if (
      pursuingDownedOpponent &&
      distanceToOpponent < 170 &&
      fighter.recoveryLeft <= 0 &&
      fighter.stunnedLeft <= 0 &&
      fighter.stamina >= ACTIONS.groundStomp.staminaCost
    ) {
      if (this.startAction(fighter, 'groundStomp')) {
        return;
      }
    }

    if (pursuingDownedOpponent) {
      return;
    }

    const tacticalAction = this.chooseTacticalAction(fighter, opponent, strategy.tacticalRules);
    if (tacticalAction && fighter.recoveryLeft <= 0 && fighter.stunnedLeft <= 0) {
      if (this.startAction(fighter, tacticalAction)) {
        return;
      }
    }

    if (grounded) {
      const nextEvent = strategy.timeline[fighter.scriptIndex];
      if (nextEvent && this.elapsed >= nextEvent.at && ACTIONS[nextEvent.action].downUsable) {
        if (this.startAction(fighter, nextEvent.action)) {
          fighter.scriptIndex += 1;
          return;
        }
      }

      const autoRecovery = this.chooseGroundRecovery(fighter, opponent);
      if (autoRecovery && fighter.recoveryLeft <= 0 && fighter.stunnedLeft <= 0) {
        this.startAction(fighter, autoRecovery);
      }
      return;
    }

    const nextEvent = strategy.timeline[fighter.scriptIndex];
    if (
      nextEvent &&
      this.elapsed >= nextEvent.at &&
      fighter.recoveryLeft <= 0 &&
      fighter.stunnedLeft <= 0 &&
      !pursuingDownedOpponent
    ) {
      if (this.startAction(fighter, nextEvent.action)) {
        fighter.scriptIndex += 1;
      }
      return;
    }

    if (fighter.queuedAction && fighter.recoveryLeft <= 0 && fighter.stunnedLeft <= 0) {
      const queued = fighter.queuedAction;
      fighter.queuedAction = null;
      this.startAction(fighter, queued);
    }
  }

  private chooseTacticalAction(
    fighter: FighterRuntime,
    opponent: FighterRuntime,
    tacticalRules: TacticalRule[],
  ): ActionKey | null {
    const sorted = [...tacticalRules].sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
      const cooldownKey = `${fighter.id}:${rule.id}`;
      const nextReady = this.tacticalCooldowns.get(cooldownKey) ?? 0;
      if (this.elapsed < nextReady) {
        continue;
      }
      if (!this.matchConditions(rule.conditions, fighter, opponent)) {
        continue;
      }

      const action = this.pickAvailableAction(rule.actions, fighter);
      if (!action) {
        continue;
      }

      this.tacticalCooldowns.set(cooldownKey, this.elapsed + rule.cooldown);
      this.pushEvent(this.elapsed, `${fighter.name} 触发战术：${rule.label}。`);
      return action;
    }
    return null;
  }

  private pickAvailableAction(actions: ActionKey[], fighter: FighterRuntime): ActionKey | null {
    for (const actionKey of actions) {
      const action = ACTIONS[actionKey];
      if (fighter.downLeft > 0 && !action.downUsable) {
        continue;
      }
      if (fighter.stamina < action.staminaCost) {
        continue;
      }
      return actionKey;
    }
    return null;
  }

  private matchConditions(
    conditions: TacticalCondition[],
    fighter: FighterRuntime,
    opponent: FighterRuntime,
  ): boolean {
    const distance = Math.abs(opponent.x - fighter.x);
    return conditions.every((condition) => {
      switch (condition.kind) {
        case 'opponentDown':
          return opponent.downLeft > 0;
        case 'selfDown':
          return fighter.downLeft > 0;
        case 'selfStaggered':
          return fighter.state === RobotState.Staggered || fighter.balance < 42;
        case 'opponentStaggered':
          return opponent.state === RobotState.Staggered || opponent.balance < 42;
        case 'distanceLessThan':
          return distance < (condition.value ?? 0);
        case 'distanceGreaterThan':
          return distance > (condition.value ?? 0);
        case 'selfBalanceBelow':
          return fighter.balance < (condition.value ?? 0);
        case 'opponentBalanceBelow':
          return opponent.balance < (condition.value ?? 0);
        case 'selfStaminaBelow':
          return fighter.stamina < (condition.value ?? 0);
        case 'selfHealthBelow':
          return fighter.health < (condition.value ?? 0);
        case 'opponentGuarding':
          return opponent.guardLeft > 0 || opponent.state === RobotState.HighGuard || opponent.state === RobotState.Shell || opponent.state === RobotState.SinkGuard || opponent.state === RobotState.SideGuard;
        case 'opponentRecovering':
          return opponent.state === RobotState.Recovering || opponent.recoveryLeft > 0.12;
        default:
          return false;
      }
    });
  }

  private chooseGroundRecovery(fighter: FighterRuntime, opponent: FighterRuntime): ActionKey | null {
    if (fighter.currentAction || fighter.downLeft <= 0 || fighter.stamina < 3) {
      return null;
    }

    const distance = Math.abs(opponent.x - fighter.x);
    if (fighter.downLeft > 0.9 && distance < 154 && fighter.stamina >= 5) {
      return 'groundCounter';
    }
    if (fighter.downLeft < 0.46 && fighter.stamina >= 4) {
      return 'quickRise';
    }
    if (fighter.downLeft > 1.15) {
      return 'braceFall';
    }
    return null;
  }

  private startAction(fighter: FighterRuntime, actionKey: ActionKey): boolean {
    const action = ACTIONS[actionKey];
    if (fighter.stamina < action.staminaCost) {
      this.pushEvent(this.elapsed, `${fighter.name} 体力不足，无法发动 ${action.label}。`);
      return false;
    }
    if (fighter.downLeft > 0 && !action.downUsable) {
      return false;
    }

    fighter.stamina = clamp(fighter.stamina - action.staminaCost, 0, 100);
    fighter.currentAction = actionKey;
    fighter.actionTime = 0;
    fighter.previousRootX = 0;
    fighter.resolvedHits = [];
    fighter.queuedAction = null;
    fighter.guardLeft = action.group === 'defense' ? action.duration : fighter.guardLeft;
    this.pushEvent(this.elapsed, `${fighter.name} 发动 ${action.label}。`);
    return true;
  }

  private tryQueueFollowUp(fighter: FighterRuntime, script: ScriptEvent[]) {
    if (!fighter.currentAction) {
      return;
    }
    const action = ACTIONS[fighter.currentAction];
    if (!action.chainWindow) {
      return;
    }
    const progress = fighter.actionTime / action.duration;
    if (progress < action.chainWindow.start || progress > action.chainWindow.end) {
      return;
    }
    const nextEvent = script[fighter.scriptIndex];
    if (!nextEvent || this.elapsed < nextEvent.at) {
      return;
    }
    if (action.chainWindow.followUps.includes(nextEvent.action)) {
      fighter.queuedAction = nextEvent.action;
      fighter.queuedAt = this.elapsed;
      fighter.scriptIndex += 1;
    }
  }

  private integrateMovement(fighter: FighterRuntime, opponent: FighterRuntime, dt: number) {
    const facing = fighter.side === 'left' ? 1 : -1;
    if (fighter.downLeft > 0 && !fighter.currentAction) {
      fighter.velocityX = lerp(fighter.velocityX, 0, dt * 8);
      return;
    }

    let desiredDistance = opponent.downLeft > 0 ? 96 : fighter.side === 'right' ? 146 : 160;
    const currentAction = fighter.currentAction ? ACTIONS[fighter.currentAction] : null;
    if (currentAction) {
      desiredDistance = currentAction.idealDistance;
    } else {
      const nextAction = this.peekNextAction(fighter);
      if (nextAction) {
        desiredDistance = ACTIONS[nextAction].idealDistance;
      }
    }

    const desiredX = opponent.x - facing * desiredDistance;
    let targetSpeed = clamp(
      (desiredX - fighter.x) * (opponent.downLeft > 0 ? 1.65 : fighter.side === 'right' ? 1.1 : 1.0),
      opponent.downLeft > 0 ? -58 : -42,
      opponent.downLeft > 0 ? 58 : 42,
    );

    if (fighter.currentAction) {
      const action = ACTIONS[fighter.currentAction];
      if (action.tags.includes('evade')) {
        targetSpeed *= 1.02;
      }
      if (action.tags.includes('charge')) {
        targetSpeed += facing * (fighter.side === 'right' ? 24 : 18);
      }
      if (action.tags.includes('kick')) {
        targetSpeed += facing * (fighter.side === 'right' ? 5 : 3);
      }
      if (action.tags.includes('close')) {
        targetSpeed += facing * 3;
      }
      if (action.tags.includes('ground')) {
        targetSpeed += facing * 1.5;
      }
    }

    if (fighter.state === RobotState.Staggered) {
      targetSpeed *= 0.34;
    }

    fighter.velocityX = lerp(fighter.velocityX, targetSpeed, dt * (fighter.side === 'right' ? 2.4 : 2.1));
    fighter.x = clamp(fighter.x + fighter.velocityX * dt, ARENA_MIN_X, ARENA_MAX_X);
  }

  private enforceSpacing() {
    const distance = Math.abs(this.right.x - this.left.x);
    if (distance >= MIN_DISTANCE) {
      return;
    }
    const center = (this.left.x + this.right.x) * 0.5;
    this.left.x = center - MIN_DISTANCE * 0.5;
    this.right.x = center + MIN_DISTANCE * 0.5;
    this.left.velocityX *= 0.5;
    this.right.velocityX *= 0.5;
  }

  private resolveActionEffects(
    attacker: FighterRuntime,
    attackerPose: PoseCollisionData,
    defender: FighterRuntime,
    defenderPose: PoseCollisionData,
    dt: number,
  ) {
    if (!attacker.currentAction) {
      return;
    }

    const action = ACTIONS[attacker.currentAction];
    const progress = clamp(attacker.actionTime / action.duration, 0, 1);

    if (attacker.currentAction && action.poseTrack.length > 0) {
      const rootMotion = attackerPose.rootMotionDelta * 0.28 * (attacker.side === 'left' ? 1 : -1);
      attacker.x = clamp(attacker.x + rootMotion, ARENA_MIN_X, ARENA_MAX_X);
    }

    for (let index = 0; index < action.hitWindows.length; index += 1) {
      if (attacker.resolvedHits.includes(index)) {
        continue;
      }
      const window = action.hitWindows[index];
      if (progress < window.start || progress > window.end) {
        continue;
      }
      if (defender.downLeft > 0 && !window.allowGround) {
        attacker.resolvedHits.push(index);
        continue;
      }
      const attackPath = attackerPose.strikes[window.limb];
      if (!attackPath) {
        continue;
      }

      const defense = window.ignoreDefense
        ? null
        : this.findDefenseHit(attackPath.current, attackPath.previous, attackPath.radius, defenderPose.defenseZones, window.targets);
      if (defense) {
        attacker.resolvedHits.push(index);
        this.resolveDefense(attacker, defender, action.label, defense);
        continue;
      }

      const hitZone = this.findTargetHit(attackPath.current, attackPath.previous, attackPath.radius, defenderPose.hurtZones, window.targets);
      if (!hitZone) {
        continue;
      }

      attacker.resolvedHits.push(index);
      this.resolveHit(attacker, defender, action.label, window, hitZone.zone, hitZone.center);
    }

    if (action.group === 'defense') {
      attacker.balance = clamp(attacker.balance + dt * 2.8, 0, 100);
    }
  }

  private resolveDefense(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    label: string,
    defense: DefenseCircle,
  ) {
    defender.blockedHits += 1;
    defender.balance = clamp(defender.balance - 3, 0, 100);
    defender.flashLeft = 0.08;
    this.flashes.push({ x: defense.center.x, y: defense.center.y, life: 0.38, color: '#8ec5ff' });

    if (defense.mode === 'parry') {
      defender.parries += 1;
      attacker.stunnedLeft = Math.max(attacker.stunnedLeft, defense.interrupt);
      attacker.recoveryLeft = Math.max(attacker.recoveryLeft, defense.interrupt * 0.8);
      this.pushEvent(this.elapsed, `${defender.name} 成功招架并化解了 ${attacker.name} 的 ${label}。`);
      return;
    }

    if (defense.mode === 'jam') {
      attacker.stunnedLeft = Math.max(attacker.stunnedLeft, defense.interrupt);
      this.pushEvent(this.elapsed, `${defender.name} 压制了 ${attacker.name} 的 ${label}。`);
      return;
    }

    this.pushEvent(this.elapsed, `${defender.name} 挡下了 ${attacker.name} 的 ${label}。`);
  }

  private resolveHit(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    label: string,
    window: HitWindow,
    zone: TargetZone,
    impactPoint: { x: number; y: number },
  ) {
    attacker.landedHits += 1;
    const zoneBonus = zone === 'head' ? 1.24 : zone === 'low' ? 0.84 : 1;
    const damage = Math.round(window.damage * zoneBonus);
    const balanceDamage = Math.round(window.balance * (zone === 'low' ? 1.45 : zone === 'head' ? 1.24 : 1.06));
    const push = window.push * (attacker.side === 'left' ? 1 : -1);
    const knockdownChance =
      window.knockdown +
      (100 - defender.balance) * 0.0039 +
      (zone === 'head' ? 0.04 : zone === 'low' ? 0.027 : 0.01);
    const protectedRecovery =
      defender.state === RobotState.Recovering || defender.recoveryLeft > 0.52 || defender.standProtectionLeft > 0;
    const recoveringPenalty = defender.standProtectionLeft > 0
      ? 0.22
      : protectedRecovery
        ? 0.15
        : 0;
    const healthyBonus = defender.health >= 35 ? 0.065 : 0;
    const adjustedKnockdownChance = Math.max(0, knockdownChance - recoveringPenalty - healthyBonus);
    const balanceDownThreshold = defender.standProtectionLeft > 0 ? 4 : defender.health >= 35 ? 11 : protectedRecovery ? 8 : 16;
    const primaryKnockdownThreshold = defender.standProtectionLeft > 0 ? 0.42 : defender.health >= 35 ? 0.35 : protectedRecovery ? 0.355 : 0.295;
    const criticalKnockdownThreshold = defender.standProtectionLeft > 0 ? 0.31 : defender.health >= 35 ? 0.225 : protectedRecovery ? 0.255 : 0.18;

    defender.health = clamp(defender.health - damage, 0, 100);
    defender.balance = clamp(defender.balance - balanceDamage, 0, 100);
    defender.stamina = clamp(defender.stamina - (window.staminaDamage ?? 0), 0, 100);
    if (protectedRecovery && defender.downLeft <= 0) {
      defender.balance = Math.max(defender.balance, defender.standProtectionLeft > 0 ? 34 : 26);
    }
    defender.velocityX += push;
    defender.flashLeft = 0.12;
    defender.stunnedLeft = Math.max(defender.stunnedLeft, zone === 'head' ? 0.4 : zone === 'low' ? 0.22 : 0.3);
    attacker.score += damage + balanceDamage * 0.45 + (zone === 'head' ? 6 : zone === 'low' ? 3 : 0);

    this.flashes.push({
      x: impactPoint.x,
      y: impactPoint.y,
      life: 0.52,
      color: zone === 'head' ? '#ffb347' : zone === 'low' ? '#eab308' : '#ff6b6b',
    });
    const zoneLabel = zone === 'head' ? '头部' : zone === 'low' ? '下盘' : '躯干';
    this.pushEvent(this.elapsed, `${attacker.name} 的 ${label} 命中 ${defender.name} 的 ${zoneLabel}。`);

    const shouldDown =
      defender.balance <= balanceDownThreshold ||
      adjustedKnockdownChance >= primaryKnockdownThreshold ||
      (defender.health <= 14 && adjustedKnockdownChance >= criticalKnockdownThreshold);

    if (shouldDown) {
      defender.state = RobotState.Down;
      defender.currentAction = null;
      defender.actionTime = 0;
      defender.queuedAction = null;
      defender.recoveryLeft = 0.1;
      defender.guardLeft = 0;
      defender.resolvedHits = [];
      defender.downLeft = window.allowGround ? 1.02 : window.limb === 'rearFoot' || window.limb === 'torso' ? 2.55 : 1.8;
      defender.knockdowns += 1;
      attacker.score += 28;
      this.pushEvent(this.elapsed, `${defender.name} 被击倒。`);
    }
  }

  private updateState(fighter: FighterRuntime) {
    if (fighter.downLeft > 0) {
      fighter.state = RobotState.Down;
      return;
    }
    if ((fighter.recoveryLeft > 0.24 || fighter.standProtectionLeft > 0) && fighter.balance < 64) {
      fighter.state = RobotState.Recovering;
      return;
    }
    if (fighter.currentAction) {
      const action = ACTIONS[fighter.currentAction];
      if (action.tags.includes('shell')) {
        fighter.state = RobotState.Shell;
        return;
      }
      if (action.tags.includes('sink')) {
        fighter.state = RobotState.SinkGuard;
        return;
      }
      if (action.tags.includes('angle') && action.group === 'defense') {
        fighter.state = RobotState.SideGuard;
        return;
      }
      if (action.tags.includes('evade')) {
        fighter.state = RobotState.Evasive;
        return;
      }
      if (action.group === 'defense') {
        fighter.state = RobotState.HighGuard;
        return;
      }
      if (action.group === 'recovery') {
        fighter.state = RobotState.Recovering;
        return;
      }
    }
    if (fighter.stunnedLeft > 0.18 || fighter.balance < 42) {
      fighter.state = RobotState.Staggered;
      return;
    }
    fighter.state = RobotState.Idle;
  }

  private finishActionIfNeeded(fighter: FighterRuntime) {
    if (!fighter.currentAction) {
      return;
    }
    const action = ACTIONS[fighter.currentAction];
    if (fighter.actionTime < action.duration) {
      return;
    }

    const finishedAction = fighter.currentAction;
    fighter.currentAction = null;
    fighter.actionTime = 0;
    fighter.recoveryLeft = Math.max(fighter.recoveryLeft, action.recovery);
    fighter.guardLeft = 0;
    fighter.resolvedHits = [];

    if (finishedAction === 'quickRise' && fighter.downLeft > 0) {
      fighter.downLeft = 0;
      fighter.balance = clamp(Math.max(fighter.balance, 52) + 32, 0, 100);
      fighter.recoveryLeft = Math.max(fighter.recoveryLeft, 0.9);
      fighter.standProtectionLeft = Math.max(fighter.standProtectionLeft, 1.05);
      fighter.stunnedLeft = Math.min(fighter.stunnedLeft, 0.08);
      fighter.state = RobotState.Recovering;
      this.pushEvent(this.elapsed, `${fighter.name} 快速起身重新站稳。`);
    } else if (finishedAction === 'braceFall' && fighter.downLeft > 0) {
      fighter.balance = clamp(Math.max(fighter.balance, 36) + 18, 0, 100);
      fighter.recoveryLeft = Math.max(fighter.recoveryLeft, 0.56);
      fighter.standProtectionLeft = Math.max(fighter.standProtectionLeft, 0.52);
      fighter.stunnedLeft = Math.min(fighter.stunnedLeft, 0.1);
    } else if (finishedAction === 'groundCounter' && fighter.downLeft > 0) {
      fighter.downLeft = Math.max(0, fighter.downLeft - 0.32);
    }

    if (fighter.downLeft <= 0.02) {
      fighter.downLeft = 0;
    }
  }

  private findTargetHit(
    current: { x: number; y: number },
    previous: { x: number; y: number },
    radius: number,
    circles: CircleZone[],
    targets: TargetZone[],
  ): CircleZone | null {
    for (const circle of circles) {
      if (!targets.includes(circle.zone)) {
        continue;
      }
      if (lineCircleHit(previous, current, circle, radius)) {
        return circle;
      }
    }
    return null;
  }

  private findDefenseHit(
    current: { x: number; y: number },
    previous: { x: number; y: number },
    radius: number,
    circles: DefenseCircle[],
    targets: TargetZone[],
  ): DefenseCircle | null {
    const coverageNeeded: DefenseCoverage[] = [];
    if (targets.includes('head')) {
      coverageNeeded.push('high');
    }
    if (targets.includes('torso')) {
      coverageNeeded.push('mid');
    }
    if (targets.includes('low')) {
      coverageNeeded.push('low');
    }

    for (const circle of circles) {
      if (!coverageNeeded.includes(circle.coverage)) {
        continue;
      }
      if (lineCircleHit(previous, current, circle, radius)) {
        return circle;
      }
    }
    return null;
  }

  private finishBattle() {
    this.finished = true;
    const leftScore = this.computeScore(this.left);
    const rightScore = this.computeScore(this.right);
    let winner = this.left.name;
    let reason = '点数优势';

    if (this.right.health <= 0 && this.left.health > 0) {
      winner = this.left.name;
      reason = '对手生命值归零';
    } else if (this.left.health <= 0 && this.right.health > 0) {
      winner = this.right.name;
      reason = '对手生命值归零';
    } else if (rightScore > leftScore) {
      winner = this.right.name;
    }

    this.summary = {
      winner,
      reason,
      leftScore: Math.round(leftScore),
      rightScore: Math.round(rightScore),
    };
    this.pushEvent(this.elapsed, `仿真结束，${winner} 以 ${reason} 获胜。`);
  }

  private computeScore(fighter: FighterRuntime) {
    return (
      fighter.score +
      fighter.health * 0.9 +
      fighter.balance * 0.5 +
      fighter.landedHits * 6 +
      fighter.blockedHits * 2 +
      fighter.parries * 4 +
      fighter.evades * 3 +
      fighter.knockdowns * 20
    );
  }

  private peekNextAction(fighter: FighterRuntime): ActionKey | null {
    const strategy = fighter.side === 'left' ? this.strategies.left : this.strategies.right;
    return strategy.timeline[fighter.scriptIndex]?.action ?? null;
  }

  private fadeEffects(dt: number) {
    this.left.flashLeft = Math.max(0, this.left.flashLeft - dt);
    this.right.flashLeft = Math.max(0, this.right.flashLeft - dt);
    for (const flash of this.flashes) {
      flash.life = Math.max(0, flash.life - dt * 1.85);
    }
    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      if (this.flashes[index].life <= 0) {
        this.flashes.splice(index, 1);
      }
    }
  }

  private pushEvent(time: number, text: string) {
    this.events.unshift({ time, text });
    if (this.events.length > 8) {
      this.events.length = 8;
    }
  }
}
