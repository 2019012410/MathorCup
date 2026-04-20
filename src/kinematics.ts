import { ACTIONS } from './actions';
import {
  ActionDefinition,
  AttackLimb,
  CircleZone,
  DefenseCircle,
  FighterRuntime,
  PoseTargets,
  RobotState,
  Vec2,
} from './types';

export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;
export const ARENA_GROUND_Y = 548;

export interface RobotPose {
  facing: number;
  hip: Vec2;
  chest: Vec2;
  head: Vec2;
  headRadius: number;
  leadShoulder: Vec2;
  rearShoulder: Vec2;
  leadElbow: Vec2;
  rearElbow: Vec2;
  leadHand: Vec2;
  rearHand: Vec2;
  leadHip: Vec2;
  rearHip: Vec2;
  leadKnee: Vec2;
  rearKnee: Vec2;
  leadFoot: Vec2;
  rearFoot: Vec2;
  torsoFrontShoulder: Vec2;
  torsoRearShoulder: Vec2;
  torsoFrontHip: Vec2;
  torsoRearHip: Vec2;
  hurtCircles: CircleZone[];
  guardCircles: DefenseCircle[];
  strikePoint: Vec2 | null;
  strikeRadius: number;
}

export interface StrikePath {
  previous: Vec2;
  current: Vec2;
  radius: number;
}

export interface PoseCollisionData {
  pose: RobotPose;
  hurtZones: CircleZone[];
  defenseZones: DefenseCircle[];
  strikes: Partial<Record<AttackLimb, StrikePath>>;
  rootMotionDelta: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;

const mixPoint = (a: Vec2, b: Vec2, alpha: number): Vec2 => ({
  x: lerp(a.x, b.x, alpha),
  y: lerp(a.y, b.y, alpha),
});

const localX = (value: number, facing: number) => value * facing;

const defaultPoseTargets = (): PoseTargets => ({
  pelvisY: 0,
  torsoLean: 0,
  torsoShiftX: 0,
  chestLift: 0,
  headShiftX: 0,
  headLift: 0,
  leadHandX: 0,
  leadHandY: 0,
  rearHandX: 0,
  rearHandY: 0,
  leadFootX: 0,
  leadFootY: 0,
  rearFootX: 0,
  rearFootY: 0,
  leadKneeLift: 0,
  rearKneeLift: 0,
  leadKneeBias: 0,
  rearKneeBias: 0,
});

const mergeTargets = (base: PoseTargets, partial: Partial<PoseTargets>): PoseTargets => ({
  ...base,
  ...partial,
});

const samplePoseTargets = (action: ActionDefinition | null, progress: number): { targets: PoseTargets; rootX: number } => {
  if (!action || action.poseTrack.length === 0) {
    return { targets: defaultPoseTargets(), rootX: 0 };
  }

  const frames = action.poseTrack;
  if (progress <= frames[0].t) {
    return {
      targets: mergeTargets(defaultPoseTargets(), frames[0].pose),
      rootX: frames[0].rootX ?? 0,
    };
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (progress >= from.t && progress <= to.t) {
      const local = (progress - from.t) / Math.max(to.t - from.t, 0.0001);
      const fromTargets = mergeTargets(defaultPoseTargets(), from.pose);
      const toTargets = mergeTargets(defaultPoseTargets(), to.pose);
      const interpolated: PoseTargets = {
        pelvisY: lerp(fromTargets.pelvisY, toTargets.pelvisY, local),
        torsoLean: lerp(fromTargets.torsoLean, toTargets.torsoLean, local),
        torsoShiftX: lerp(fromTargets.torsoShiftX, toTargets.torsoShiftX, local),
        chestLift: lerp(fromTargets.chestLift, toTargets.chestLift, local),
        headShiftX: lerp(fromTargets.headShiftX, toTargets.headShiftX, local),
        headLift: lerp(fromTargets.headLift, toTargets.headLift, local),
        leadHandX: lerp(fromTargets.leadHandX, toTargets.leadHandX, local),
        leadHandY: lerp(fromTargets.leadHandY, toTargets.leadHandY, local),
        rearHandX: lerp(fromTargets.rearHandX, toTargets.rearHandX, local),
        rearHandY: lerp(fromTargets.rearHandY, toTargets.rearHandY, local),
        leadFootX: lerp(fromTargets.leadFootX, toTargets.leadFootX, local),
        leadFootY: lerp(fromTargets.leadFootY, toTargets.leadFootY, local),
        rearFootX: lerp(fromTargets.rearFootX, toTargets.rearFootX, local),
        rearFootY: lerp(fromTargets.rearFootY, toTargets.rearFootY, local),
        leadKneeLift: lerp(fromTargets.leadKneeLift, toTargets.leadKneeLift, local),
        rearKneeLift: lerp(fromTargets.rearKneeLift, toTargets.rearKneeLift, local),
        leadKneeBias: lerp(fromTargets.leadKneeBias, toTargets.leadKneeBias, local),
        rearKneeBias: lerp(fromTargets.rearKneeBias, toTargets.rearKneeBias, local),
      };
      return {
        targets: interpolated,
        rootX: lerp(from.rootX ?? 0, to.rootX ?? 0, local),
      };
    }
  }

  const last = frames[frames.length - 1];
  return {
    targets: mergeTargets(defaultPoseTargets(), last.pose),
    rootX: last.rootX ?? 0,
  };
};

const solveKnee = (hip: Vec2, foot: Vec2, lift: number, bias: number): Vec2 => ({
  x: lerp(hip.x, foot.x, 0.5) + bias,
  y: lerp(hip.y, foot.y, 0.54) - lift,
});

const limbPoint = (pose: RobotPose, limb: AttackLimb): Vec2 => {
  switch (limb) {
    case 'leadHand':
      return pose.leadHand;
    case 'rearHand':
      return pose.rearHand;
    case 'leadElbow':
      return pose.leadElbow;
    case 'rearElbow':
      return pose.rearElbow;
    case 'leadKnee':
      return pose.leadKnee;
    case 'rearKnee':
      return pose.rearKnee;
    case 'leadFoot':
      return pose.leadFoot;
    case 'rearFoot':
      return pose.rearFoot;
    case 'torso':
      return pose.chest;
  }
};

const defenseCenterFromCoverage = (pose: RobotPose, coverage: 'high' | 'mid' | 'low'): Vec2 => {
  if (coverage === 'high') {
    return mixPoint(pose.leadHand, pose.rearHand, 0.5);
  }
  if (coverage === 'mid') {
    return mixPoint(pose.chest, pose.hip, 0.35);
  }
  return mixPoint(pose.leadKnee, pose.rearKnee, 0.5);
};

const downPose = (fighter: FighterRuntime): RobotPose => {
  const facing = fighter.side === 'left' ? 1 : -1;
  const hip = { x: fighter.x, y: ARENA_GROUND_Y - 34 };
  const chest = { x: hip.x + facing * 54, y: hip.y - 16 };
  const head = { x: chest.x + facing * 34, y: chest.y - 10 };
  const leadShoulder = { x: chest.x + facing * 10, y: chest.y - 18 };
  const rearShoulder = { x: chest.x - facing * 12, y: chest.y - 6 };
  const leadHand = { x: leadShoulder.x + facing * 24, y: leadShoulder.y + 28 };
  const rearHand = { x: rearShoulder.x - facing * 14, y: rearShoulder.y + 30 };
  const leadElbow = mixPoint(leadShoulder, leadHand, 0.5);
  const rearElbow = mixPoint(rearShoulder, rearHand, 0.5);
  const leadHip = { x: hip.x + facing * 8, y: hip.y + 2 };
  const rearHip = { x: hip.x - facing * 10, y: hip.y - 2 };
  const leadFoot = { x: leadHip.x + facing * 36, y: ARENA_GROUND_Y - 8 };
  const rearFoot = { x: rearHip.x - facing * 18, y: ARENA_GROUND_Y - 12 };
  const leadKnee = mixPoint(leadHip, leadFoot, 0.5);
  const rearKnee = mixPoint(rearHip, rearFoot, 0.5);
  const hurtCircles: CircleZone[] = [
    { center: head, radius: 15, zone: 'head' },
    { center: chest, radius: 28, zone: 'torso' },
    { center: mixPoint(hip, chest, 0.4), radius: 30, zone: 'torso' },
    { center: mixPoint(leadKnee, rearKnee, 0.5), radius: 24, zone: 'low' },
  ];

  return {
    facing,
    hip,
    chest,
    head,
    headRadius: 16,
    leadShoulder,
    rearShoulder,
    leadElbow,
    rearElbow,
    leadHand,
    rearHand,
    leadHip,
    rearHip,
    leadKnee,
    rearKnee,
    leadFoot,
    rearFoot,
    torsoFrontShoulder: { x: chest.x + facing * 18, y: chest.y - 12 },
    torsoRearShoulder: { x: chest.x - facing * 18, y: chest.y - 2 },
    torsoFrontHip: { x: hip.x + facing * 16, y: hip.y - 8 },
    torsoRearHip: { x: hip.x - facing * 14, y: hip.y - 16 },
    hurtCircles,
    guardCircles: [],
    strikePoint: null,
    strikeRadius: 0,
  };
};

export const computeRobotPose = (fighter: FighterRuntime, time: number): RobotPose => {
  if (fighter.state === RobotState.Down) {
    return downPose(fighter);
  }

  const facing = fighter.side === 'left' ? 1 : -1;
  const action = fighter.currentAction ? ACTIONS[fighter.currentAction] : null;
  const progress = action ? clamp(fighter.actionTime / action.duration, 0, 1) : 0;
  const sampled = samplePoseTargets(action, progress);
  const moveSpeed = Math.abs(fighter.velocityX);
  const walkAmount = fighter.currentAction && !action?.tags.includes('movement')
    ? 0
    : clamp((moveSpeed - 18) / 120, 0, 1);
  const walkPhase = time * (4.6 + walkAmount * 3.4) + (fighter.side === 'left' ? 0 : Math.PI);
  const baseLean =
    fighter.state === RobotState.Staggered
      ? Math.sin(time * 11 + (fighter.side === 'left' ? 0 : 1)) * 0.08
      : 0;
  const hip = {
    x: fighter.x + sampled.rootX * facing + Math.sin(walkPhase) * 2.4 * walkAmount,
    y: ARENA_GROUND_Y - 114 + sampled.targets.pelvisY + Math.sin(time * 7 + (fighter.side === 'left' ? 0.2 : 1.1)) * (1.2 + walkAmount),
  };
  const torsoLean = sampled.targets.torsoLean + baseLean;
  const chest = {
    x: hip.x + localX(sampled.targets.torsoShiftX, facing) + facing * torsoLean * 60,
    y: hip.y - 86 - sampled.targets.chestLift,
  };
  const head = {
    x: chest.x + localX(sampled.targets.headShiftX, facing) + facing * 6,
    y: chest.y - 38 - sampled.targets.headLift,
  };

  const staticStance = !action && fighter.state === RobotState.Idle && walkAmount < 0.12;
  const leadFoot = {
    x: staticStance
      ? hip.x + facing * 2
      : hip.x + facing * 20 + localX(sampled.targets.leadFootX, facing) + Math.sin(walkPhase) * 16 * walkAmount,
    y: ARENA_GROUND_Y + sampled.targets.leadFootY - Math.max(0, Math.sin(walkPhase)) * 8 * walkAmount,
  };
  const rearFoot = {
    x: staticStance
      ? hip.x - facing * 2
      : hip.x - facing * 18 + localX(sampled.targets.rearFootX, facing) + Math.sin(walkPhase + Math.PI) * 16 * walkAmount,
    y: ARENA_GROUND_Y + sampled.targets.rearFootY - Math.max(0, Math.sin(walkPhase + Math.PI)) * 8 * walkAmount,
  };

  const leadHip = { x: hip.x + facing * 12, y: hip.y + 4 };
  const rearHip = { x: hip.x - facing * 10, y: hip.y + 2 };
  const leadKnee = staticStance
    ? solveKnee(leadHip, leadFoot, 5, facing * 0.5)
    : solveKnee(
        leadHip,
        leadFoot,
        12 + sampled.targets.leadKneeLift + walkAmount * 14,
        localX(sampled.targets.leadKneeBias, facing) + clamp((leadFoot.x - leadHip.x) * 0.05, -4, 4),
      );
  const rearKnee = staticStance
    ? solveKnee(rearHip, rearFoot, 5, -facing * 0.5)
    : solveKnee(
        rearHip,
        rearFoot,
        12 + sampled.targets.rearKneeLift + walkAmount * 14,
        localX(sampled.targets.rearKneeBias, facing) + clamp((rearFoot.x - rearHip.x) * 0.05, -4, 4),
      );

  const leadShoulder = { x: chest.x + facing * 22, y: chest.y - 8 };
  const rearShoulder = { x: chest.x - facing * 18, y: chest.y - 2 };
  const leadHand = {
    x: chest.x + facing * 28 + localX(sampled.targets.leadHandX, facing),
    y: chest.y + 18 + sampled.targets.leadHandY,
  };
  const rearHand = {
    x: chest.x - facing * 8 + localX(sampled.targets.rearHandX, facing),
    y: chest.y + 22 + sampled.targets.rearHandY,
  };
  const leadElbow = mixPoint(leadShoulder, leadHand, 0.5);
  const rearElbow = mixPoint(rearShoulder, rearHand, 0.5);

  const hurtCircles: CircleZone[] = [
    { center: head, radius: 16, zone: 'head' },
    { center: { x: chest.x, y: chest.y + 10 }, radius: 26, zone: 'torso' },
    { center: mixPoint(hip, chest, 0.42), radius: 28, zone: 'torso' },
    { center: mixPoint(leadKnee, rearKnee, 0.5), radius: 18, zone: 'low' },
  ];

  const defenseZones: DefenseCircle[] = [];
  if (action) {
    const progressNow = progress;
    for (const window of action.defenseWindows) {
      if (progressNow < window.start || progressNow > window.end) {
        continue;
      }
      for (const coverage of window.coverage) {
        defenseZones.push({
          center: defenseCenterFromCoverage({
            facing,
            hip,
            chest,
            head,
            headRadius: 16,
            leadShoulder,
            rearShoulder,
            leadElbow,
            rearElbow,
            leadHand,
            rearHand,
            leadHip,
            rearHip,
            leadKnee,
            rearKnee,
            leadFoot,
            rearFoot,
            torsoFrontShoulder: { x: chest.x + facing * 26, y: chest.y - 18 },
            torsoRearShoulder: { x: chest.x - facing * 26, y: chest.y - 10 },
            torsoFrontHip: { x: hip.x + facing * 22, y: hip.y - 16 },
            torsoRearHip: { x: hip.x - facing * 22, y: hip.y - 10 },
            hurtCircles,
            guardCircles: [],
            strikePoint: null,
            strikeRadius: 0,
          }, coverage),
          radius: coverage === 'high' ? 20 : coverage === 'mid' ? 28 : 22,
          coverage,
          mode: window.mode,
          mitigation: window.mitigation,
          interrupt: window.interrupt,
        });
      }
    }
  }

  const strikePoint = action && action.hitWindows.length > 0
    ? limbPoint(
        {
          facing,
          hip,
          chest,
          head,
          headRadius: 16,
          leadShoulder,
          rearShoulder,
          leadElbow,
          rearElbow,
          leadHand,
          rearHand,
          leadHip,
          rearHip,
          leadKnee,
          rearKnee,
          leadFoot,
          rearFoot,
          torsoFrontShoulder: { x: chest.x + facing * 26, y: chest.y - 18 },
          torsoRearShoulder: { x: chest.x - facing * 26, y: chest.y - 10 },
          torsoFrontHip: { x: hip.x + facing * 22, y: hip.y - 16 },
          torsoRearHip: { x: hip.x - facing * 22, y: hip.y - 10 },
          hurtCircles,
          guardCircles: defenseZones,
          strikePoint: null,
          strikeRadius: 0,
        },
        action.hitWindows[0].limb,
      )
    : null;

  return {
    facing,
    hip,
    chest,
    head,
    headRadius: 16,
    leadShoulder,
    rearShoulder,
    leadElbow,
    rearElbow,
    leadHand,
    rearHand,
    leadHip,
    rearHip,
    leadKnee,
    rearKnee,
    leadFoot,
    rearFoot,
    torsoFrontShoulder: { x: chest.x + facing * 26, y: chest.y - 18 },
    torsoRearShoulder: { x: chest.x - facing * 26, y: chest.y - 10 },
    torsoFrontHip: { x: hip.x + facing * 22, y: hip.y - 16 },
    torsoRearHip: { x: hip.x - facing * 22, y: hip.y - 10 },
    hurtCircles,
    guardCircles: defenseZones,
    strikePoint,
    strikeRadius: action?.hitWindows[0] ? (action.hitWindows[0].limb.includes('Foot') ? 24 : action.hitWindows[0].limb.includes('Knee') ? 20 : action.hitWindows[0].limb === 'torso' ? 20 : 14) : 0,
  };
};

export const createFighterPoseData = (fighter: FighterRuntime, time: number): PoseCollisionData => {
  const pose = computeRobotPose(fighter, time);
  const action = fighter.currentAction ? ACTIONS[fighter.currentAction] : null;
  const currentProgress = action ? clamp(fighter.actionTime / action.duration, 0, 1) : 0;
  const previousProgress = action ? clamp((fighter.actionTime - 1 / 30) / action.duration, 0, 1) : 0;
  const currentSample = samplePoseTargets(action, currentProgress);
  const previousSample = samplePoseTargets(action, previousProgress);
  const previousPose =
    fighter.state === RobotState.Down
      ? downPose(fighter)
      : computeRobotPose({ ...fighter, actionTime: Math.max(0, fighter.actionTime - 1 / 30) }, time - 1 / 30);

  const strikes: Partial<Record<AttackLimb, StrikePath>> = {};
  if (action) {
    for (const window of action.hitWindows) {
      const current = limbPoint(pose, window.limb);
      const previous = limbPoint(previousPose, window.limb);
      const radius =
        window.limb.includes('Foot') ? (action.key === 'groundStomp' ? 32 : 24) :
        window.limb.includes('Knee') ? 20 :
        window.limb.includes('Elbow') ? 14 :
        window.limb === 'torso' ? 20 : 14;
      strikes[window.limb] = { previous, current, radius };
    }
  }

  return {
    pose,
    hurtZones: pose.hurtCircles,
    defenseZones: pose.guardCircles,
    strikes,
    rootMotionDelta: currentSample.rootX - previousSample.rootX,
  };
};
