export enum RobotState {
  Idle = 'Idle',
  HighGuard = 'HighGuard',
  Shell = 'Shell',
  SinkGuard = 'SinkGuard',
  SideGuard = 'SideGuard',
  Evasive = 'Evasive',
  Staggered = 'Staggered',
  Down = 'Down',
  Recovering = 'Recovering',
}

export type ActionGroup =
  | 'attack'
  | 'defense'
  | 'movement'
  | 'recovery'
  | 'combo';

export type AttackLimb =
  | 'leadHand'
  | 'rearHand'
  | 'leadElbow'
  | 'rearElbow'
  | 'leadKnee'
  | 'rearKnee'
  | 'leadFoot'
  | 'rearFoot'
  | 'torso';

export type TargetZone = 'head' | 'torso' | 'low';
export type DefenseCoverage = 'high' | 'mid' | 'low';
export type DefenseMode = 'block' | 'parry' | 'jam' | 'brace';

export type ActionKey =
  | 'leftStraight'
  | 'rightStraight'
  | 'leftHook'
  | 'rightHook'
  | 'swingPunch'
  | 'overhandSmash'
  | 'elbowSmash'
  | 'frontKick'
  | 'sideKick'
  | 'axeKick'
  | 'spinningBackKick'
  | 'lowSweep'
  | 'kneeStrike'
  | 'ram'
  | 'comboPunches'
  | 'bodyHookFlurry'
  | 'punchKickCombo'
  | 'fiveKickCombo'
  | 'groundStomp'
  | 'groundCounter'
  | 'crossBlock'
  | 'singleParry'
  | 'elbowShield'
  | 'downPressBlock'
  | 'headShell'
  | 'sinkGuard'
  | 'sideGuard'
  | 'slipLeft'
  | 'slipRight'
  | 'duckEvade'
  | 'backStep'
  | 'backHop'
  | 'shuffleStep'
  | 'braceFall'
  | 'quickRise'
  | 'resetStance'
  | 'slipBlockCounter'
  | 'duckSlipKick'
  | 'blockCircleCounter';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CircleZone {
  center: Vec2;
  radius: number;
  zone: TargetZone;
}

export interface DefenseCircle {
  center: Vec2;
  radius: number;
  coverage: DefenseCoverage;
  mode: DefenseMode;
  mitigation: number;
  interrupt: number;
}

export interface PoseTargets {
  pelvisY: number;
  torsoLean: number;
  torsoShiftX: number;
  chestLift: number;
  headShiftX: number;
  headLift: number;
  leadHandX: number;
  leadHandY: number;
  rearHandX: number;
  rearHandY: number;
  leadFootX: number;
  leadFootY: number;
  rearFootX: number;
  rearFootY: number;
  leadKneeLift: number;
  rearKneeLift: number;
  leadKneeBias: number;
  rearKneeBias: number;
}

export interface PoseKeyframe {
  t: number;
  rootX?: number;
  pose: Partial<PoseTargets>;
}

export interface HitWindow {
  start: number;
  end: number;
  limb: AttackLimb;
  targets: TargetZone[];
  damage: number;
  balance: number;
  push: number;
  knockdown: number;
  staminaDamage?: number;
  allowGround?: boolean;
  ignoreDefense?: boolean;
}

export interface DefenseWindow {
  start: number;
  end: number;
  coverage: DefenseCoverage[];
  mode: DefenseMode;
  mitigation: number;
  interrupt: number;
}

export interface ChainWindow {
  start: number;
  end: number;
  followUps: ActionKey[];
}

export interface ActionDefinition {
  key: ActionKey;
  label: string;
  group: ActionGroup;
  duration: number;
  recovery: number;
  staminaCost: number;
  idealDistance: number;
  tags: string[];
  poseTrack: PoseKeyframe[];
  hitWindows: HitWindow[];
  defenseWindows: DefenseWindow[];
  chainWindow?: ChainWindow;
  downUsable?: boolean;
}

export interface ScriptEvent {
  at: number;
  action: ActionKey;
}

export type TacticalConditionKind =
  | 'opponentDown'
  | 'selfDown'
  | 'selfStaggered'
  | 'opponentStaggered'
  | 'distanceLessThan'
  | 'distanceGreaterThan'
  | 'selfBalanceBelow'
  | 'opponentBalanceBelow'
  | 'selfStaminaBelow'
  | 'selfHealthBelow'
  | 'opponentGuarding'
  | 'opponentRecovering';

export interface TacticalCondition {
  kind: TacticalConditionKind;
  value?: number;
}

export interface TacticalRule {
  id: string;
  label: string;
  priority: number;
  cooldown: number;
  actions: ActionKey[];
  conditions: TacticalCondition[];
}

export interface BattleStrategy {
  name: string;
  timeline: ScriptEvent[];
  tacticalRules: TacticalRule[];
}

export interface BattleScenario {
  label: string;
  left: BattleStrategy;
  right: BattleStrategy;
}

export interface BattleScripts {
  left: ScriptEvent[];
  right: ScriptEvent[];
}

export interface FighterRuntime {
  id: string;
  name: string;
  side: 'left' | 'right';
  health: number;
  stamina: number;
  balance: number;
  knockdowns: number;
  landedHits: number;
  blockedHits: number;
  parries: number;
  evades: number;
  score: number;
  state: RobotState;
  currentAction: ActionKey | null;
  actionTime: number;
  previousRootX: number;
  queuedAction: ActionKey | null;
  queuedAt: number;
  recoveryLeft: number;
  standProtectionLeft: number;
  guardLeft: number;
  stunnedLeft: number;
  downLeft: number;
  flashLeft: number;
  scriptIndex: number;
  x: number;
  velocityX: number;
  resolvedHits: number[];
}

export interface BattleEvent {
  time: number;
  text: string;
}

export interface BattleSummary {
  winner: string;
  reason: string;
  leftScore: number;
  rightScore: number;
}

export interface ImpactFlash {
  x: number;
  y: number;
  life: number;
  color: string;
}

export interface HudData {
  elapsed: number;
  duration: number;
  left: FighterRuntime;
  right: FighterRuntime;
  events: BattleEvent[];
  summary: BattleSummary | null;
  flashes: ImpactFlash[];
}
