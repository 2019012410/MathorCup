import { BattleScenario, BattleStrategy, TacticalRule } from './types';

const rushRules: TacticalRule[] = [
  {
    id: 'rush-stomp',
    label: '倒地踩踏',
    priority: 100,
    cooldown: 1.1,
    actions: ['groundStomp'],
    conditions: [{ kind: 'opponentDown' }, { kind: 'distanceLessThan', value: 176 }],
  },
  {
    id: 'self-rise',
    label: '失衡起身',
    priority: 92,
    cooldown: 2.4,
    actions: ['quickRise', 'braceFall'],
    conditions: [{ kind: 'selfDown' }],
  },
  {
    id: 'self-cover',
    label: '失衡护架',
    priority: 85,
    cooldown: 2.2,
    actions: ['headShell', 'crossBlock', 'sinkGuard'],
    conditions: [{ kind: 'selfStaggered' }],
  },
  {
    id: 'close-pressure',
    label: '近身压迫',
    priority: 76,
    cooldown: 1.6,
    actions: ['bodyHookFlurry', 'elbowSmash', 'kneeStrike', 'ram'],
    conditions: [{ kind: 'distanceLessThan', value: 145 }, { kind: 'opponentGuarding' }],
  },
  {
    id: 'punish-low',
    label: '追打失衡',
    priority: 80,
    cooldown: 1.8,
    actions: ['lowSweep', 'axeKick', 'groundStomp'],
    conditions: [{ kind: 'opponentStaggered' }, { kind: 'distanceLessThan', value: 180 }],
  },
];

const boxerRules: TacticalRule[] = [
  {
    id: 'boxer-rise',
    label: '失衡起身',
    priority: 90,
    cooldown: 2.6,
    actions: ['quickRise', 'resetStance'],
    conditions: [{ kind: 'selfDown' }],
  },
  {
    id: 'boxer-cover',
    label: '护头护中',
    priority: 84,
    cooldown: 2.2,
    actions: ['headShell', 'crossBlock', 'singleParry'],
    conditions: [{ kind: 'selfStaggered' }],
  },
  {
    id: 'boxer-punish',
    label: '中近距离连击',
    priority: 70,
    cooldown: 1.6,
    actions: ['leftStraight', 'rightStraight', 'leftHook', 'rightHook', 'comboPunches', 'overhandSmash'],
    conditions: [{ kind: 'distanceLessThan', value: 170 }],
  },
  {
    id: 'boxer-kick',
    label: '补腿打点',
    priority: 62,
    cooldown: 1.8,
    actions: ['frontKick', 'sideKick', 'punchKickCombo', 'axeKick'],
    conditions: [{ kind: 'opponentBalanceBelow', value: 55 }],
  },
  {
    id: 'boxer-recover',
    label: '拉开重整',
    priority: 55,
    cooldown: 1.4,
    actions: ['backStep', 'shuffleStep', 'duckEvade'],
    conditions: [{ kind: 'selfBalanceBelow', value: 45 }],
  },
];

const counterRules: TacticalRule[] = [
  {
    id: 'counter-down',
    label: '倒地踩踏',
    priority: 100,
    cooldown: 1,
    actions: ['groundStomp'],
    conditions: [{ kind: 'opponentDown' }, { kind: 'distanceLessThan', value: 176 }],
  },
  {
    id: 'counter-rising',
    label: '起身护架',
    priority: 94,
    cooldown: 2.4,
    actions: ['quickRise', 'headShell'],
    conditions: [{ kind: 'selfDown' }, { kind: 'selfStaggered' }],
  },
  {
    id: 'counter-check',
    label: '反击检查',
    priority: 82,
    cooldown: 1.6,
    actions: ['singleParry', 'slipBlockCounter', 'blockCircleCounter'],
    conditions: [{ kind: 'opponentRecovering' }],
  },
  {
    id: 'counter-close',
    label: '贴身反打',
    priority: 72,
    cooldown: 1.6,
    actions: ['bodyHookFlurry', 'elbowSmash', 'kneeStrike'],
    conditions: [{ kind: 'distanceLessThan', value: 150 }],
  },
  {
    id: 'counter-break',
    label: '破坏节奏',
    priority: 64,
    cooldown: 1.8,
    actions: ['lowSweep', 'ram', 'sideKick', 'spinningBackKick'],
    conditions: [{ kind: 'opponentGuarding' }, { kind: 'opponentBalanceBelow', value: 60 }],
  },
];

const technicalRules: TacticalRule[] = [
  {
    id: 'tech-reset',
    label: '重整站姿',
    priority: 88,
    cooldown: 2.2,
    actions: ['resetStance', 'crossBlock'],
    conditions: [{ kind: 'selfBalanceBelow', value: 42 }],
  },
  {
    id: 'tech-slip',
    label: '闪避转进',
    priority: 78,
    cooldown: 1.8,
    actions: ['slipLeft', 'slipRight', 'duckEvade', 'shuffleStep'],
    conditions: [{ kind: 'distanceGreaterThan', value: 168 }],
  },
  {
    id: 'tech-press',
    label: '推进连段',
    priority: 74,
    cooldown: 1.5,
    actions: ['leftStraight', 'rightStraight', 'leftHook', 'frontKick', 'comboPunches'],
    conditions: [{ kind: 'opponentGuarding' }, { kind: 'opponentBalanceBelow', value: 65 }],
  },
  {
    id: 'tech-ground',
    label: '地面追击',
    priority: 96,
    cooldown: 1.1,
    actions: ['groundStomp'],
    conditions: [{ kind: 'opponentDown' }, { kind: 'distanceLessThan', value: 176 }],
  },
];

const makeTimeline = (actions: Array<[number, string]>): BattleStrategy['timeline'] =>
  actions.map(([at, action]) => ({ at, action: action as BattleStrategy['timeline'][number]['action'] }));

const makeStrategy = (name: string, timeline: BattleStrategy['timeline'], tacticalRules: TacticalRule[]): BattleStrategy => ({
  name,
  timeline,
  tacticalRules,
});

const rushStrategy = makeStrategy(
  'rush',
  makeTimeline([
    [0.24, 'shuffleStep'],
    [0.66, 'leftStraight'],
    [1.02, 'rightStraight'],
    [1.48, 'comboPunches'],
    [2.34, 'bodyHookFlurry'],
    [3.02, 'frontKick'],
    [3.64, 'ram'],
    [4.22, 'rightHook'],
    [4.9, 'overhandSmash'],
    [5.78, 'groundStomp'],
    [6.56, 'punchKickCombo'],
    [7.38, 'leftHook'],
    [8.08, 'axeKick'],
    [8.92, 'elbowSmash'],
    [9.56, 'fiveKickCombo'],
    [11.24, 'backStep'],
    [11.72, 'crossBlock'],
    [12.18, 'slipBlockCounter'],
    [13.12, 'comboPunches'],
    [14.08, 'groundStomp'],
    [15.02, 'sideKick'],
    [15.72, 'lowSweep'],
    [16.36, 'bodyHookFlurry'],
    [17.12, 'overhandSmash'],
    [18.04, 'spinningBackKick'],
    [19.26, 'resetStance'],
    [20.1, 'rightStraight'],
    [20.62, 'leftStraight'],
    [21.16, 'groundStomp'],
    [22.02, 'frontKick'],
    [22.7, 'ram'],
    [23.28, 'axeKick'],
    [24.14, 'bodyHookFlurry'],
    [25.06, 'punchKickCombo'],
    [26.1, 'sideKick'],
    [27.02, 'groundStomp'],
  ]),
  rushRules,
);

const boxerStrategy = makeStrategy(
  'boxer',
  makeTimeline([
    [0.22, 'shuffleStep'],
    [0.58, 'leftStraight'],
    [0.92, 'rightStraight'],
    [1.28, 'leftHook'],
    [1.72, 'rightHook'],
    [2.18, 'comboPunches'],
    [3.02, 'crossBlock'],
    [3.46, 'slipBlockCounter'],
    [4.08, 'frontKick'],
    [4.82, 'bodyHookFlurry'],
    [5.58, 'overhandSmash'],
    [6.32, 'backStep'],
    [6.84, 'singleParry'],
    [7.22, 'rightStraight'],
    [7.66, 'leftHook'],
    [8.18, 'kneeStrike'],
    [8.86, 'punchKickCombo'],
    [9.84, 'downPressBlock'],
    [10.36, 'lowSweep'],
    [11.02, 'elbowSmash'],
    [11.7, 'resetStance'],
    [12.42, 'rightStraight'],
    [12.84, 'leftStraight'],
    [13.28, 'comboPunches'],
    [14.08, 'sideKick'],
    [14.86, 'crossBlock'],
    [15.28, 'slipRight'],
    [15.68, 'bodyHookFlurry'],
    [16.42, 'overhandSmash'],
    [17.36, 'groundStomp'],
    [18.18, 'frontKick'],
    [18.86, 'leftHook'],
    [19.48, 'rightHook'],
    [20.08, 'axeKick'],
    [20.92, 'shuffleStep'],
    [21.34, 'singleParry'],
    [21.76, 'spinningBackKick'],
    [22.82, 'punchKickCombo'],
    [23.78, 'backStep'],
    [24.28, 'crossBlock'],
    [24.72, 'groundStomp'],
    [25.56, 'bodyHookFlurry'],
    [26.44, 'fiveKickCombo'],
    [27.34, 'resetStance'],
  ]),
  boxerRules,
);

const counterStrategy = makeStrategy(
  'counter',
  makeTimeline([
    [0.26, 'headShell'],
    [0.64, 'singleParry'],
    [1.02, 'rightStraight'],
    [1.38, 'leftHook'],
    [1.88, 'backStep'],
    [2.24, 'duckEvade'],
    [2.66, 'duckSlipKick'],
    [3.34, 'groundStomp'],
    [4.02, 'crossBlock'],
    [4.46, 'slipBlockCounter'],
    [5.12, 'rightHook'],
    [5.76, 'elbowSmash'],
    [6.42, 'ram'],
    [7.08, 'sideGuard'],
    [7.64, 'spinningBackKick'],
    [8.58, 'headShell'],
    [9.02, 'frontKick'],
    [9.72, 'overhandSmash'],
    [10.6, 'lowSweep'],
    [11.18, 'singleParry'],
    [11.54, 'bodyHookFlurry'],
    [12.32, 'punchKickCombo'],
    [13.24, 'backHop'],
    [13.92, 'crossBlock'],
    [14.36, 'slipRight'],
    [14.72, 'rightStraight'],
    [15.16, 'leftHook'],
    [15.74, 'groundStomp'],
    [16.58, 'resetStance'],
    [17.24, 'elbowSmash'],
    [17.84, 'rightHook'],
    [18.42, 'frontKick'],
    [19.12, 'sideKick'],
    [19.94, 'singleParry'],
    [20.28, 'bodyHookFlurry'],
    [21.06, 'overhandSmash'],
    [21.92, 'crossBlock'],
    [22.42, 'groundStomp'],
    [23.16, 'duckEvade'],
    [23.62, 'kneeStrike'],
    [24.18, 'axeKick'],
    [25.02, 'shuffleStep'],
    [25.44, 'slipBlockCounter'],
    [26.18, 'fiveKickCombo'],
    [27.08, 'resetStance'],
  ]),
  counterRules,
);

const tacticalScenarioPool: BattleScenario[] = [
  { label: '激进压制', left: rushStrategy, right: boxerStrategy },
  { label: '技术对攻', left: boxerStrategy, right: counterStrategy },
  { label: '反击拉扯', left: counterStrategy, right: rushStrategy },
  { label: '鏖战逼抢', left: rushStrategy, right: counterStrategy },
  { label: '双技术流', left: boxerStrategy, right: boxerStrategy },
];

const cloneStrategy = (strategy: BattleStrategy): BattleStrategy => ({
  name: strategy.name,
  timeline: strategy.timeline.map((item) => ({ ...item })),
  tacticalRules: strategy.tacticalRules.map((rule) => ({
    ...rule,
    actions: [...rule.actions],
    conditions: rule.conditions.map((condition) => ({ ...condition })),
  })),
});

const randomIndex = (length: number) => Math.floor(Math.random() * length);

export const createBattleScenario = (): BattleScenario => {
  const template = tacticalScenarioPool[randomIndex(tacticalScenarioPool.length)];
  return {
    label: template.label,
    left: cloneStrategy(template.left),
    right: cloneStrategy(template.right),
  };
};

export const createBattleScripts = (): { left: BattleStrategy; right: BattleStrategy } => {
  const scenario = createBattleScenario();
  return {
    left: scenario.left,
    right: scenario.right,
  };
};
