import './style.css';
import { ACTIONS } from './actions';
import {
  ARENA_GROUND_Y,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  RobotPose,
  computeRobotPose,
} from './kinematics';
import { BattleSimulation } from './simulation';
import { createBattleScripts } from './scripts';
import { FighterRuntime, HudData, ImpactFlash, RobotState } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container.');
}

const canvas = document.createElement('canvas');
canvas.className = 'fight-canvas';
app.appendChild(canvas);

const overlay = document.createElement('div');
overlay.className = 'overlay-root';
app.appendChild(overlay);

const simulation = new BattleSimulation(createBattleScripts());
const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D context unavailable.');
}

let isRunning = false;
let hasStarted = false;
let lastTime = 0;
let hudAccumulator = 0;

const resizeCanvas = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const stateColor: Record<RobotState, string> = {
  [RobotState.Idle]: '#dbeafe',
  [RobotState.HighGuard]: '#93c5fd',
  [RobotState.Shell]: '#60a5fa',
  [RobotState.SinkGuard]: '#38bdf8',
  [RobotState.SideGuard]: '#7dd3fc',
  [RobotState.Evasive]: '#c4b5fd',
  [RobotState.Staggered]: '#fbbf24',
  [RobotState.Down]: '#f87171',
  [RobotState.Recovering]: '#86efac',
};

const stateLabel: Record<RobotState, string> = {
  [RobotState.Idle]: '站立',
  [RobotState.HighGuard]: '高位防守',
  [RobotState.Shell]: '抱架护头',
  [RobotState.SinkGuard]: '沉身防守',
  [RobotState.SideGuard]: '侧向防守',
  [RobotState.Evasive]: '闪避',
  [RobotState.Staggered]: '失衡',
  [RobotState.Down]: '倒地',
  [RobotState.Recovering]: '恢复',
};

const toRgba = (hex: string, alpha: number) => {
  const raw = hex.replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map((value) => value + value).join('') : raw;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const resetLoopTiming = () => {
  lastTime = 0;
  hudAccumulator = 0;
};

const resetBattle = (autostart: boolean) => {
  simulation.reset();
  hasStarted = autostart;
  isRunning = autostart;
  resetLoopTiming();
  renderHud(simulation.getHudData());
};

const renderHud = (hud: HudData) => {
  const lastEvent = hasStarted
    ? hud.events[0]?.text ?? '战斗进行中。'
    : '等待开始，请点击开始对打。';
  const progress = Math.min(hud.elapsed / hud.duration, 1);
  const centerText = hud.summary
    ? `${hud.summary.winner} 胜出`
    : isRunning
      ? '战斗进行中'
      : hasStarted
        ? '战斗已暂停'
        : '等待开始';
  const startLabel = hud.summary ? '再来一局' : hasStarted ? (isRunning ? '暂停' : '继续') : '开始对打';

  overlay.innerHTML = `
    <div class="status-strip">
      <div class="fighter-strip">
        <div class="fighter-name">Atlas</div>
        <div class="mini-bars">
          <div class="mini-bar hp"><span style="width:${hud.left.health}%"></span></div>
          <div class="mini-bar balance"><span style="width:${hud.left.balance}%"></span></div>
        </div>
        <div class="fighter-meta">${hud.left.currentAction ? ACTIONS[hud.left.currentAction].label : stateLabel[hud.left.state]}</div>
      </div>
      <div class="center-strip">
        <div class="center-time">${hud.elapsed.toFixed(1)}s / ${hud.duration.toFixed(0)}s</div>
        <div class="timeline"><span style="width:${progress * 100}%"></span></div>
        <div class="center-time">${centerText}</div>
      </div>
      <div class="fighter-strip align-right">
        <div class="fighter-name">Helios</div>
        <div class="mini-bars">
          <div class="mini-bar hp"><span style="width:${hud.right.health}%"></span></div>
          <div class="mini-bar balance"><span style="width:${hud.right.balance}%"></span></div>
        </div>
        <div class="fighter-meta">${hud.right.currentAction ? ACTIONS[hud.right.currentAction].label : stateLabel[hud.right.state]}</div>
      </div>
    </div>
    <div class="ticker">${lastEvent}</div>
    ${
      hud.summary
        ? `<div class="result-chip">${hud.summary.winner} 获胜 · ${hud.summary.reason} · ${hud.summary.leftScore} : ${hud.summary.rightScore}</div>`
        : ''
    }
    <div class="control-row">
      <button id="start-btn" class="ghost-button primary-button" type="button">${startLabel}</button>
      <button id="restart-btn" class="ghost-button" type="button">重新开始</button>
    </div>
  `;
};

overlay.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest('button');
  if (!button) {
    return;
  }

  if (button.id === 'start-btn') {
    const hud = simulation.getHudData();
    if (hud.summary) {
      resetBattle(true);
      return;
    }

    hasStarted = true;
    isRunning = !isRunning;
    resetLoopTiming();
    renderHud(simulation.getHudData());
    return;
  }

  if (button.id === 'restart-btn') {
    resetBattle(false);
  }
});

const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#040916');
  sky.addColorStop(0.48, '#0a1223');
  sky.addColorStop(1, '#04070d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, 0);
  const glow = ctx.createRadialGradient(0, 210, 90, 0, 210, 480);
  glow.addColorStop(0, 'rgba(52, 211, 153, 0.12)');
  glow.addColorStop(0.45, 'rgba(59, 130, 246, 0.08)');
  glow.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-width / 2, 0, width, height);
  ctx.restore();

  const floor = ctx.createLinearGradient(0, ARENA_GROUND_Y - 40, 0, height);
  floor.addColorStop(0, '#111827');
  floor.addColorStop(1, '#020617');
  ctx.fillStyle = floor;
  ctx.fillRect(0, ARENA_GROUND_Y - 22, width, height - ARENA_GROUND_Y + 22);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 40; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, ARENA_GROUND_Y - 4);
    ctx.lineTo(x + 18, height);
    ctx.stroke();
  }
  for (let y = ARENA_GROUND_Y + 8; y < height; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(80, ARENA_GROUND_Y + 4);
  ctx.lineTo(width - 80, ARENA_GROUND_Y + 4);
  ctx.stroke();
};

const drawShadow = (ctx: CanvasRenderingContext2D, pose: RobotPose, alpha: number) => {
  ctx.save();
  ctx.translate(0, 6);
  ctx.beginPath();
  ctx.ellipse(pose.hip.x, ARENA_GROUND_Y + 12, 56, 14, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(2, 6, 23, ${alpha})`;
  ctx.fill();
  ctx.restore();
};

const drawLimb = (
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  color: string,
  width: number,
) => {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
};

const drawJoint = (ctx: CanvasRenderingContext2D, point: { x: number; y: number }, radius: number, color: string) => {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
};

const drawRobot = (
  ctx: CanvasRenderingContext2D,
  fighter: FighterRuntime,
  pose: RobotPose,
  primary: string,
  accent: string,
) => {
  const flashAlpha = fighter.flashLeft > 0 ? Math.min(0.22, fighter.flashLeft * 1.4) : 0;
  const bodyColor = flashAlpha > 0 ? '#fff5f5' : primary;
  const rearColor = flashAlpha > 0 ? '#ffd7d7' : `${primary}bb`;
  const jointColor = '#dbeafe';

  drawShadow(ctx, pose, fighter.state === RobotState.Down ? 0.28 : 0.2);

  drawLimb(ctx, pose.rearHip, pose.rearKnee, pose.rearFoot, rearColor, 14);
  drawLimb(ctx, pose.leadHip, pose.leadKnee, pose.leadFoot, bodyColor, 16);
  drawLimb(ctx, pose.rearShoulder, pose.rearElbow, pose.rearHand, rearColor, 12);

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(pose.torsoRearShoulder.x, pose.torsoRearShoulder.y);
  ctx.lineTo(pose.torsoFrontShoulder.x, pose.torsoFrontShoulder.y);
  ctx.lineTo(pose.torsoFrontHip.x, pose.torsoFrontHip.y);
  ctx.lineTo(pose.torsoRearHip.x, pose.torsoRearHip.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = toRgba('#020617', 0.22);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(pose.chest.x - 17, pose.chest.y - 10, 34, 20, 8);
  ctx.fill();

  drawLimb(ctx, pose.leadShoulder, pose.leadElbow, pose.leadHand, bodyColor, 13);

  ctx.beginPath();
  ctx.arc(pose.head.x, pose.head.y, pose.headRadius, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(pose.head.x + pose.facing * 4, pose.head.y + 1, 10, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  drawJoint(ctx, pose.leadShoulder, 5, jointColor);
  drawJoint(ctx, pose.rearShoulder, 5, jointColor);
  drawJoint(ctx, pose.leadElbow, 4.5, jointColor);
  drawJoint(ctx, pose.rearElbow, 4.5, jointColor);
  drawJoint(ctx, pose.leadHip, 6, jointColor);
  drawJoint(ctx, pose.rearHip, 6, jointColor);
  drawJoint(ctx, pose.leadKnee, 5, jointColor);
  drawJoint(ctx, pose.rearKnee, 5, jointColor);

  if (fighter.guardLeft > 0) {
    ctx.strokeStyle = 'rgba(191, 219, 254, 0.35)';
    ctx.lineWidth = 2;
    for (const circle of pose.guardCircles) {
      ctx.beginPath();
      ctx.arc(circle.center.x, circle.center.y, circle.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.fillStyle = stateColor[fighter.state];
  ctx.font = '600 12px "Segoe UI", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(stateLabel[fighter.state], pose.hip.x, pose.head.y - 34);
};

const drawImpactFlashes = (ctx: CanvasRenderingContext2D, flashes: ImpactFlash[]) => {
  for (const flash of flashes) {
    const alpha = flash.life;
    ctx.save();
    ctx.strokeStyle = toRgba(flash.color, alpha);
    ctx.fillStyle = toRgba(flash.color, alpha * 0.18);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, 18 + (1 - alpha) * 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, 9 + (1 - alpha) * 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

const render = () => {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const hud = simulation.getHudData();
  const leftPose = computeRobotPose(hud.left, hud.elapsed);
  const rightPose = computeRobotPose(hud.right, hud.elapsed);

  context.save();
  const scale = Math.min(window.innerWidth / ARENA_WIDTH, window.innerHeight / ARENA_HEIGHT);
  const xOffset = (window.innerWidth - ARENA_WIDTH * scale) * 0.5;
  const yOffset = (window.innerHeight - ARENA_HEIGHT * scale) * 0.5;
  context.translate(xOffset, yOffset);
  context.scale(scale, scale);

  drawBackground(context, ARENA_WIDTH, ARENA_HEIGHT);
  drawRobot(context, hud.left, leftPose, '#0f766e', '#22d3ee');
  drawRobot(context, hud.right, rightPose, '#9a3412', '#fb923c');

  if (leftPose.strikePoint) {
    context.strokeStyle = toRgba('#22d3ee', 0.15);
    context.lineWidth = 2;
    context.beginPath();
    context.arc(leftPose.strikePoint.x, leftPose.strikePoint.y, leftPose.strikeRadius, 0, Math.PI * 2);
    context.stroke();
  }
  if (rightPose.strikePoint) {
    context.strokeStyle = toRgba('#fb923c', 0.15);
    context.lineWidth = 2;
    context.beginPath();
    context.arc(rightPose.strikePoint.x, rightPose.strikePoint.y, rightPose.strikeRadius, 0, Math.PI * 2);
    context.stroke();
  }

  drawImpactFlashes(context, hud.flashes);
  context.restore();
};

resizeCanvas();
renderHud(simulation.getHudData());
render();

const frame = (time: number) => {
  if (lastTime === 0) {
    lastTime = time;
  }
  const dt = Math.min((time - lastTime) / 1000, 1 / 30);
  lastTime = time;

  let shouldRefreshHud = false;

  if (isRunning) {
    simulation.update(dt);
    hudAccumulator += dt;
    shouldRefreshHud = hudAccumulator >= 0.12;

    if (simulation.getHudData().summary) {
      isRunning = false;
      shouldRefreshHud = true;
    }
  }

  render();

  if (shouldRefreshHud) {
    renderHud(simulation.getHudData());
    hudAccumulator = 0;
  }

  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
window.addEventListener('resize', resizeCanvas);
