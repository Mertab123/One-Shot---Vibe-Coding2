"use strict";

const WORLD = { w: 1500, h: 980, left: 42, right: 1458, top: 42, bottom: 938 };
const SAVE_KEY = "blackoutHeistSaveV1";
const DIFFICULTIES = ["STORY", "STANDARD", "HARDLINE"];
const $ = id => document.getElementById(id);
const UPGRADES = [
  { id: "speed", name: "RUNNER'S EDGE", detail: "Move 12% faster.", base: 120, max: 3 },
  { id: "emp", name: "CAPACITOR BANK", detail: "EMP lasts 3 seconds longer.", base: 160, max: 3 },
  { id: "dash", name: "SLIPSTREAM", detail: "Dash cooldown 20% shorter.", base: 140, max: 3 },
  { id: "health", name: "TRAUMA PATCH", detail: "+1 max health each run.", base: 260, max: 2 }
];

let gameState = "menu";
let player;
let guards = [];
let cameras = [];
let lasers = [];
let terminals = [];
let loot = [];
let walls = [];
let cover = [];
let particles = [];
let decals = [];
let noisePings = [];
let worldOffset = { x: 0, y: 0 };
let run = {};
let save = { best: 0, credits: 0, upgrades: { speed: 0, emp: 0, dash: 0, health: 0 }, difficulty: 1, sound: true };
let lastTime = 0;
let alertStage = -1;
let activeToast = "";
let toastUntil = 0;
let audioContext = null;
let gameCanvas;

function setup() {
  gameCanvas = createCanvas(windowWidth, windowHeight);
  gameCanvas.parent("canvas-host");
  pixelDensity(1);
  frameRate(60);
  loadSave();
  buildFacility();
  buildInterface();
  refreshMenu();
  lastTime = millis();
}

function draw() {
  const current = millis();
  const dt = Math.min((current - lastTime) / 1000, 0.04);
  lastTime = current;
  drawBackground();
  if (["playing", "paused", "victory", "failure"].includes(gameState)) {
    updateCamera();
    push();
    if (run.shake > 0 && gameState === "playing") {
      translate(random(-run.shake, run.shake), random(-run.shake, run.shake));
      run.shake = Math.max(0, run.shake - 22 * dt);
    }
    translate(-worldOffset.x, -worldOffset.y);
    drawFacility();
    for (const item of loot) item.draw();
    for (const terminal of terminals) terminal.draw();
    for (const laser of lasers) laser.draw();
    for (const camera of cameras) camera.draw();
    for (const guard of guards) guard.draw();
    drawNoisePings();
    for (const particle of particles) particle.draw();
    for (const decal of decals) decal.draw();
    if (player) player.draw();
    drawInteractionMarker();
    pop();
    drawScreenVignette();
  }
  if (gameState === "playing") updateGame(dt);
  updateHud();
}

function loadSave() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
    save = {
      best: Number(parsed.best) || 0,
      credits: Number(parsed.credits) || 0,
      upgrades: { speed: 0, emp: 0, dash: 0, health: 0, ...(parsed.upgrades || {}) },
      difficulty: Number.isInteger(parsed.difficulty) ? constrain(parsed.difficulty, 0, 2) : 1,
      sound: parsed.sound !== false
    };
  } catch (error) {
    console.warn("Could not load saved heist data.", error);
  }
}

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("Could not save heist progress.", error);
  }
}

function buildInterface() {
  $("start-button").addEventListener("click", startRun);
  $("pause-button").addEventListener("click", pauseRun);
  $("resume-button").addEventListener("click", resumeRun);
  $("abandon-button").addEventListener("click", () => showMenu());
  $("retry-button").addEventListener("click", startRun);
  $("menu-button").addEventListener("click", () => showMenu());
  $("pause-button").setAttribute("aria-label", "Pause");
  $("sound-button").addEventListener("click", toggleSound);
  $("sound-menu").addEventListener("click", toggleSound);
  $("difficulty-left").addEventListener("click", () => cycleDifficulty(-1));
  $("difficulty-right").addEventListener("click", () => cycleDifficulty(1));
  $("decoy-button").addEventListener("click", () => { run.selected = "decoy"; toast("DECOY SELECTED · CLICK TO DEPLOY"); });
  $("emp-button").addEventListener("click", () => { run.selected = "emp"; toast("EMP SELECTED · CLICK TO DEPLOY"); });
  document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => showScreen(button.dataset.open)));
  document.querySelectorAll("[data-back]").forEach(button => button.addEventListener("click", () => showMenu()));
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && gameState === "playing") pauseRun();
  });
  refreshShop();
}

function buildFacility() {
  walls = [
    { x: 340, y: 42, w: 18, h: 355 }, { x: 340, y: 535, w: 18, h: 403 },
    { x: 700, y: 42, w: 18, h: 355 }, { x: 700, y: 535, w: 18, h: 403 },
    { x: 1040, y: 42, w: 18, h: 355 }, { x: 1040, y: 535, w: 18, h: 403 },
    { x: 42, y: 42, w: 1416, h: 18 }, { x: 42, y: 920, w: 1416, h: 18 },
    { x: 42, y: 42, w: 18, h: 896 }, { x: 1440, y: 42, w: 18, h: 896 }
  ];
  cover = [
    { x: 115, y: 178, w: 92, h: 34 }, { x: 242, y: 748, w: 64, h: 45 },
    { x: 395, y: 128, w: 76, h: 42 }, { x: 467, y: 724, w: 104, h: 35 },
    { x: 618, y: 189, w: 58, h: 86 }, { x: 749, y: 730, w: 84, h: 40 },
    { x: 801, y: 165, w: 92, h: 34 }, { x: 1114, y: 180, w: 58, h: 74 },
    { x: 1093, y: 722, w: 102, h: 38 }, { x: 1288, y: 735, w: 76, h: 50 },
    { x: 1293, y: 154, w: 88, h: 38 }
  ];
}

function startRun() {
  ensureAudio();
  const healthBonus = save.upgrades.health;
  run = {
    time: 0, alert: 0, loot: 0, data: false, score: 0, damageCooldown: 0,
    lockdown: false, droneSpawned: false, lockdownDroneSpawned: false, selected: "emp", decoys: 2, emps: 2,
    noise: [], shake: 0, alertStage: 0, lootProgress: 0, objectiveComplete: false,
    cameraOffsetX: 0, cameraOffsetY: 0, hacked: [false, false], finished: false
  };
  player = new Player(112, 465, 4 + healthBonus);
  guards = [
    new Guard(436, 465, "guard", [[425, 465], [467, 465], [466, 360], [400, 360]]),
    new Guard(790, 465, "guard", [[765, 465], [850, 465], [840, 352], [755, 352]]),
    new Guard(1132, 465, "guard", [[1100, 465], [1264, 465], [1270, 356], [1090, 356]]),
    new Guard(245, 210, "guard", [[120, 280], [275, 280], [275, 105], [120, 105]]),
    new Guard(850, 760, "guard", [[770, 790], [920, 790], [920, 625], [770, 625]])
  ];
  cameras = [
    new SecurityCamera(230, 425, 0, 0.62, 335),
    new SecurityCamera(485, 405, 0.3, 0.56, 290),
    new SecurityCamera(750, 405, Math.PI, 0.56, 290),
    new SecurityCamera(1115, 405, 2.8, 0.62, 335),
    new SecurityCamera(1275, 580, -1.2, 0.58, 310)
  ];
  lasers = [new LaserGate(580, 410, 120, 0), new LaserGate(930, 410, 120, 1)];
  terminals = [new Terminal(454, 465, 0), new Terminal(815, 465, 1)];
  loot = [
    new Loot(160, 270, 280), new Loot(272, 812, 420), new Loot(451, 148, 350),
    new Loot(501, 770, 550), new Loot(645, 310, 480), new Loot(782, 840, 620),
    new Loot(866, 153, 440), new Loot(1118, 780, 620), new Loot(1173, 246, 520),
    new Loot(1330, 757, 760), new Loot(1340, 200, 700)
  ];
  particles = [];
  decals = [];
  noisePings = [];
  alertStage = 0;
  gameState = "playing";
  showOnlyGame();
  toast("IN. QUIETLY. FIND THE VAULT.");
  lastTime = millis();
}

class Player {
  constructor(x, y, health) {
    this.x = x; this.y = y; this.radius = 12; this.health = health; this.maxHealth = health;
    this.speed = 185 * (1 + save.upgrades.speed * .12);
    this.angle = 0; this.invulnerable = 0; this.dashCooldown = Math.max(0, 1.65 * Math.pow(.8, save.upgrades.dash));
    this.dashLeft = 0; this.dashReady = 0; this.dashDir = { x: 0, y: 0 }; this.moving = false;
  }
  update(dt) {
    const aim = screenToWorld(mouseX, mouseY);
    this.angle = Math.atan2(aim.y - this.y, aim.x - this.x);
    let dx = (keyIsDown(65) || keyIsDown(LEFT_ARROW) ? -1 : 0) + (keyIsDown(68) || keyIsDown(RIGHT_ARROW) ? 1 : 0);
    let dy = (keyIsDown(87) || keyIsDown(UP_ARROW) ? -1 : 0) + (keyIsDown(83) || keyIsDown(DOWN_ARROW) ? 1 : 0);
    const mag = Math.hypot(dx, dy);
    if (mag > 0) { dx /= mag; dy /= mag; this.moving = true; }
    else this.moving = false;
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      movePlayer(this.dashDir.x * 570 * dt, this.dashDir.y * 570 * dt);
      this.invulnerable = Math.max(this.invulnerable, .06);
      if (frameCount % 3 === 0) spawnParticles(this.x, this.y, "#50dcff", 2);
    } else movePlayer(dx * this.speed * dt, dy * this.speed * dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dashReady = Math.max(0, this.dashReady - dt);
  }
  dash() {
    if (this.dashReady > 0) return;
    let dx = (keyIsDown(65) || keyIsDown(LEFT_ARROW) ? -1 : 0) + (keyIsDown(68) || keyIsDown(RIGHT_ARROW) ? 1 : 0);
    let dy = (keyIsDown(87) || keyIsDown(UP_ARROW) ? -1 : 0) + (keyIsDown(83) || keyIsDown(DOWN_ARROW) ? 1 : 0);
    if (dx === 0 && dy === 0) { dx = Math.cos(this.angle); dy = Math.sin(this.angle); }
    const length = Math.hypot(dx, dy);
    this.dashDir = { x: dx / length, y: dy / length };
    this.dashLeft = .19;
    this.dashReady = this.dashCooldown;
    this.invulnerable = .22;
    run.shake = Math.max(run.shake, 2);
    tone(390, .075, "sawtooth");
  }
  draw() {
    push(); translate(this.x, this.y);
    if (this.invulnerable > 0 && frameCount % 6 < 3) drawingContext.globalAlpha = .48;
    if (this.invulnerable > 0) { noFill(); stroke(74, 225, 255, 130); strokeWeight(2); circle(0, 0, 35); }
    drawingContext.shadowBlur = 17; drawingContext.shadowColor = "#47dfff";
    rotate(this.angle);
    noStroke(); fill(10, 24, 37);
    beginShape(); vertex(15, 0); vertex(-9, -10); vertex(-5, 0); vertex(-9, 10); endShape(CLOSE);
    fill(58, 213, 247); beginShape(); vertex(11, 0); vertex(-7, -6); vertex(-3, 0); vertex(-7, 6); endShape(CLOSE);
    fill(211, 252, 255); ellipse(1, 0, 5, 3);
    drawingContext.shadowBlur = 0; drawingContext.globalAlpha = 1; pop();
  }
}

function movePlayer(dx, dy) {
  const radius = player.radius;
  const nextX = constrain(player.x + dx, WORLD.left + radius, WORLD.right - radius);
  if (!blockedAt(nextX, player.y, radius)) player.x = nextX;
  const nextY = constrain(player.y + dy, WORLD.top + radius, WORLD.bottom - radius);
  if (!blockedAt(player.x, nextY, radius)) player.y = nextY;
}

function blockedAt(x, y, radius) {
  for (const wall of walls) if (circleRect(x, y, radius, wall)) return true;
  for (const obstacle of cover) if (circleRect(x, y, radius, obstacle)) return true;
  for (const laser of lasers) if (laser.active() && circleRect(x, y, radius, laser.bounds())) return true;
  if (run.lockdown && run.data && circleRect(x, y, radius, { x: 230, y: 410, w: 12, h: 120 })) return true;
  return false;
}

function circleRect(x, y, radius, rect) {
  const nearestX = constrain(x, rect.x, rect.x + rect.w);
  const nearestY = constrain(y, rect.y, rect.y + rect.h);
  return dist(x, y, nearestX, nearestY) < radius;
}

function lineBlocked(x1, y1, x2, y2) {
  const steps = Math.ceil(dist(x1, y1, x2, y2) / 9);
  for (let i = 1; i < steps; i++) {
    const x = lerp(x1, x2, i / steps), y = lerp(y1, y2, i / steps);
    if (walls.some(w => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h)) return true;
    if (cover.some(w => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h)) return true;
  }
  return false;
}

class Guard {
  constructor(x, y, type, patrol) {
    this.x = x; this.y = y; this.startX = x; this.startY = y; this.type = type;
    this.patrol = patrol; this.waypoint = 0; this.state = "patrol"; this.target = null;
    this.speed = type === "drone" ? 93 : 64; this.radius = type === "drone" ? 13 : 12;
    this.facing = 0; this.attackWait = random(.2, .9); this.stun = 0; this.suspicion = 0;
    this.phase = random(TWO_PI); this.lastKnown = null;
  }
  update(dt) {
    this.phase += dt * 2;
    this.attackWait = Math.max(0, this.attackWait - dt);
    this.stun = Math.max(0, this.stun - dt);
    if (this.stun > 0) return;
    const seen = visibleToGuard(this);
    if (seen || run.alert >= 75) {
      this.state = "chase";
      this.lastKnown = { x: player.x, y: player.y };
      this.suspicion = Math.min(1, this.suspicion + dt * (seen ? 1.5 : .45));
      if (seen) raiseAlert((this.type === "drone" ? 8 : 5) * dt, true);
    } else if (this.state === "chase") {
      this.suspicion -= dt * .15;
      if (this.suspicion <= 0) this.state = run.alert >= 35 ? "investigate" : "patrol";
    }
    if (this.state !== "chase") {
      const ping = noisePings.find(item => item.life > 0 && dist(this.x, this.y, item.x, item.y) < item.radius);
      if (ping) { this.state = "investigate"; this.target = { x: ping.x, y: ping.y }; }
      if (run.alert >= 25 && !this.target && random() < dt * .05) this.target = { x: player.x + random(-130, 130), y: player.y + random(-130, 130) };
    }
    let target;
    if (this.state === "chase") target = { x: player.x, y: player.y };
    else if (this.state === "investigate" && this.target) {
      target = this.target;
      if (dist(this.x, this.y, target.x, target.y) < 18) { this.target = null; this.state = run.alert >= 25 ? "investigate" : "patrol"; }
    } else {
      target = this.patrol[this.waypoint];
      if (dist(this.x, this.y, target[0], target[1]) < 18) this.waypoint = (this.waypoint + 1) % this.patrol.length;
      target = { x: this.patrol[this.waypoint][0], y: this.patrol[this.waypoint][1] };
    }
    if (target) {
      const dx = target.x - this.x, dy = target.y - this.y, d = Math.hypot(dx, dy);
      if (d > 2) {
        this.facing = Math.atan2(dy, dx);
        let speed = this.speed * (this.state === "chase" ? 1.55 + run.alert / 160 : this.state === "investigate" ? 1.18 : 1);
        if (this.type === "drone") speed *= 1.08;
        const nx = this.x + dx / d * speed * dt, ny = this.y + dy / d * speed * dt;
        if (!blockedAt(nx, this.y, this.radius)) this.x = nx;
        if (!blockedAt(this.x, ny, this.radius)) this.y = ny;
      }
    }
    if (dist(this.x, this.y, player.x, player.y) < this.radius + player.radius + 2 && this.attackWait <= 0) {
      this.attackWait = 1.05;
      damagePlayer(1);
      if (this.type !== "drone") {
        this.x -= Math.cos(this.facing) * 13;
        this.y -= Math.sin(this.facing) * 13;
      }
    }
  }
  draw() {
    push(); translate(this.x, this.y);
    const drone = this.type === "drone";
    drawingContext.shadowBlur = this.state === "chase" ? 17 : 9;
    drawingContext.shadowColor = this.state === "chase" ? "#ff435c" : "#ef536c";
    if (drone) {
      rotate(this.facing); noStroke(); fill(42, 22, 32); ellipse(0, 0, 30, 19);
      fill(255, 69, 92); ellipse(3, 0, 12, 5);
      fill(255, 152, 160, 170); circle(0, 0, 3);
    } else {
      rotate(this.facing); noStroke(); fill(29, 26, 35);
      beginShape(); vertex(10, 0); vertex(-7, -8); vertex(-5, 0); vertex(-7, 8); endShape(CLOSE);
      fill(this.state === "chase" ? "#ff435c" : "#e75a73"); beginShape();
      vertex(7, 0); vertex(-5, -4); vertex(-2, 0); vertex(-5, 4); endShape(CLOSE);
      fill(255, 212, 217); circle(0, 0, 3);
    }
    drawingContext.shadowBlur = 0;
    if (this.state === "chase") {
      noFill(); stroke(255, 55, 75, 130); strokeWeight(1); circle(0, 0, 31 + sin(frameCount * .15 + this.phase) * 3);
    }
    if (this.stun > 0) { noFill(); stroke(95, 235, 255, 190); circle(0, 0, 36); }
    pop();
  }
}

class SecurityCamera {
  constructor(x, y, angle, spread, range) {
    this.x = x; this.y = y; this.angle = angle; this.base = angle; this.spread = spread;
    this.range = range; this.disabled = 0; this.phase = random(TWO_PI);
  }
  update(dt) {
    this.phase += dt * (run.alert >= 50 ? 1.7 : .85);
    this.disabled = Math.max(0, this.disabled - dt);
    this.angle = this.base + Math.sin(this.phase) * (run.alert >= 50 ? .82 : .58);
    const dx = player.x - this.x, dy = player.y - this.y;
    const d = Math.hypot(dx, dy);
    if (this.disabled <= 0 && d < this.range && Math.abs(angleDifference(Math.atan2(dy, dx), this.angle)) < this.spread && !lineBlocked(this.x, this.y, player.x, player.y)) {
      raiseAlert(8.8 * dt, true);
      if (run.alert >= 18 && run.time % 1.8 < dt) toast("CAMERA HAS A VISUAL · BREAK LINE OF SIGHT");
    }
  }
  draw() {
    push();
    if (this.disabled <= 0) {
      noStroke(); fill(255, 57, 81, 19); arc(this.x, this.y, this.range * 2, this.range * 2, this.angle - this.spread, this.angle + this.spread, PIE);
      stroke(255, 68, 91, 68); strokeWeight(1);
      line(this.x, this.y, this.x + Math.cos(this.angle - this.spread) * this.range, this.y + Math.sin(this.angle - this.spread) * this.range);
      line(this.x, this.y, this.x + Math.cos(this.angle + this.spread) * this.range, this.y + Math.sin(this.angle + this.spread) * this.range);
    }
    drawingContext.shadowBlur = 9; drawingContext.shadowColor = this.disabled > 0 ? "#48dfff" : "#ff405c";
    noStroke(); fill(22, 29, 39); rectMode(CENTER); rect(this.x, this.y, 24, 18, 4);
    fill(this.disabled > 0 ? "#44dfff" : "#ff4d66"); circle(this.x + Math.cos(this.angle) * 7, this.y + Math.sin(this.angle) * 5, 5);
    drawingContext.shadowBlur = 0; pop();
  }
}

class LaserGate {
  constructor(x, y, h, id) { this.x = x; this.y = y; this.h = h; this.id = id; this.disabled = 0; }
  active() { return !run.hacked[this.id] && this.disabled <= 0; }
  bounds() { return { x: this.x - 5, y: this.y, w: 10, h: this.h }; }
  update(dt) { if (!run.hacked[this.id]) this.disabled = Math.max(0, this.disabled - dt); }
  draw() {
    const active = this.active();
    push();
    stroke(active ? color(255, 45, 68, 190) : color(61, 207, 234, 100));
    strokeWeight(active ? 3 : 1);
    if (active) drawingContext.shadowBlur = 14, drawingContext.shadowColor = "#ff334f";
    else drawingContext.shadowBlur = 0;
    line(this.x, this.y, this.x, this.y + this.h);
    if (active) {
      noStroke(); fill(255, 45, 68, 34 + 13 * sin(frameCount * .2)); rect(this.x - 5, this.y, 10, this.h);
      fill(255, 91, 108); for (let y = this.y + 10; y < this.y + this.h; y += 18) circle(this.x, y + sin(frameCount * .12 + y) * 4, 3);
    }
    drawingContext.shadowBlur = 0; pop();
  }
}

class Terminal {
  constructor(x, y, id) { this.x = x; this.y = y; this.id = id; this.pulse = random(TWO_PI); }
  update(dt) { this.pulse += dt * 3; }
  draw() {
    push(); translate(this.x, this.y);
    drawingContext.shadowBlur = 12; drawingContext.shadowColor = run.hacked[this.id] ? "#53e5ff" : "#39d7ff";
    noStroke(); fill(14, 31, 43); rectMode(CENTER); rect(0, 0, 23, 30, 3);
    fill(run.hacked[this.id] ? "#64e8ff" : "#25a9d3"); rect(0, -2, 14, 17, 2);
    fill(215, 251, 255, 120 + 100 * sin(this.pulse)); circle(0, -4, 4);
    fill(run.hacked[this.id] ? "#70f1ff" : "#ff6177"); rect(0, 11, 10, 2);
    drawingContext.shadowBlur = 0; pop();
    if (dist(player.x, player.y, this.x, this.y) < 70 && !run.hacked[this.id]) {
      noFill(); stroke(64, 218, 255, 100); strokeWeight(1); circle(this.x, this.y, 39 + 2 * sin(this.pulse));
    }
  }
}

class Loot {
  constructor(x, y, value) { this.x = x; this.y = y; this.value = value; this.taken = false; this.progress = 0; this.phase = random(TWO_PI); }
  update(dt) {
    if (this.taken) return;
    if (dist(player.x, player.y, this.x, this.y) < 38 && keyIsDown(69)) {
      this.progress += dt;
      raiseAlert(.8 * dt, false);
      if (this.progress >= .85) {
        this.taken = true;
        run.loot += this.value;
        run.alert = Math.min(100, run.alert + 6.5);
        run.shake = 3;
        spawnParticles(this.x, this.y, "#ffd477", 15);
        tone(760, .11, "sine");
        toast(`CACHED ${this.value}¢ · EXPOSURE +`);
      }
    } else this.progress = Math.max(0, this.progress - dt * 1.6);
  }
  draw() {
    if (this.taken) return;
    push(); translate(this.x, this.y); this.phase += .04;
    drawingContext.shadowBlur = 12; drawingContext.shadowColor = "#ffc65e";
    noStroke(); fill(51, 40, 23); rectMode(CENTER); rect(0, 0, 22, 20, 3);
    fill(255, 193, 79); rect(0, 0, 13, 12, 2); fill(255, 240, 182); rect(0, -1, 5, 3);
    drawingContext.shadowBlur = 0; pop();
    if (this.progress > 0) {
      noStroke(); fill(8, 13, 20, 220); rect(this.x - 20, this.y - 22, 40, 3);
      fill(255, 198, 94); rect(this.x - 20, this.y - 22, 40 * this.progress / .65, 3);
    }
  }
}

class Particle {
  constructor(x, y, tint) {
    this.x = x; this.y = y; this.tint = tint;
    const a = random(TWO_PI), s = random(25, 160);
    this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
    this.life = random(.25, .75); this.max = this.life; this.r = random(1, 3.3);
  }
  update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; this.vx *= .96; this.vy *= .96; this.life -= dt; }
  draw() { noStroke(); fill(this.tint + hex(Math.floor(255 * this.life / this.max), 2)); circle(this.x, this.y, this.r); }
}

class Decal {
  constructor(x, y) { this.x = x; this.y = y; this.life = 6; this.phase = 0; }
  update(dt) { this.life -= dt; this.phase += dt; }
  draw() {
    if (this.life <= 0) return;
    noFill(); stroke(63, 220, 255, 130 * Math.min(1, this.life)); strokeWeight(1);
    circle(this.x, this.y, 20 + this.phase * 45);
    circle(this.x, this.y, 12 + this.phase * 25);
  }
}

function updateGame(dt) {
  run.time += dt;
  player.update(dt);
  for (const camera of cameras) camera.update(dt);
  for (const laser of lasers) laser.update(dt);
  for (const terminal of terminals) terminal.update(dt);
  for (const guard of guards) guard.update(dt);
  for (const item of loot) item.update(dt);
  for (const particle of particles) particle.update(dt);
  for (const decal of decals) decal.update(dt);
  for (const ping of noisePings) ping.life -= dt;
  noisePings = noisePings.filter(ping => ping.life > 0);
  particles = particles.filter(particle => particle.life > 0);
  decals = decals.filter(decal => decal.life > 0);
  if (run.alert >= 50 && !run.droneSpawned) {
    guards.push(new Guard(1380, 620, "drone", [[1370, 620], [1370, 790], [1240, 790], [1240, 620]]));
    run.droneSpawned = true;
    toast("SECURITY DRONE DEPLOYED");
    tone(180, .3, "sawtooth");
  }
  if (!run.lockdown && run.alert >= 100) beginLockdown();
  if (run.alert < 100) raiseAlert(.24 * (1 + save.difficulty * .25) * dt, false);
  if (player.health <= 0) finishRun(false, "The guards closed in before you could reach extraction.");
}

function raiseAlert(amount, immediate) {
  if (gameState !== "playing" || run.alert >= 100) return;
  run.alert = constrain(run.alert + amount, 0, 100);
  const nextStage = run.alert >= 75 ? 3 : run.alert >= 50 ? 2 : run.alert >= 25 ? 1 : 0;
  if (nextStage !== alertStage) {
    alertStage = nextStage;
    run.alertStage = nextStage;
    if (nextStage > 0) {
      tone(240 - nextStage * 25, .19, "sawtooth");
      toast(["", "PATROLS ON EDGE", "SECURITY SEARCHING", "LOCKDOWN IMMINENT"][nextStage]);
    } else tone(480, .08, "sine");
  }
  if (immediate) run.lastDetection = run.time;
}

function beginLockdown() {
  run.lockdown = true;
  tone(110, .5, "sawtooth");
  toast("LOCKDOWN // EXTRACTION GATE SEALED · USE EMP");
  if (!run.lockdownDroneSpawned) {
    guards.push(new Guard(205, 460, "drone", [[190, 460], [300, 460], [300, 550], [190, 550]]));
    run.lockdownDroneSpawned = true;
  }
}

function visibleToGuard(guard) {
  const dx = player.x - guard.x, dy = player.y - guard.y;
  const d = Math.hypot(dx, dy);
  const range = guard.type === "drone" ? 310 : run.alert >= 50 ? 245 : 185;
  const angle = Math.atan2(dy, dx);
  return d < range && Math.abs(angleDifference(angle, guard.facing)) < (guard.state === "chase" ? 1.35 : .85) && !lineBlocked(guard.x, guard.y, player.x, player.y);
}

function angleDifference(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

function interact() {
  if (gameState !== "playing") return;
  let nearest = null, nearestDistance = Infinity;
  const candidates = [...terminals.filter(t => !run.hacked[t.id]).map(t => ({ type: "terminal", item: t }))];
  if (run.data && !run.objectiveComplete) candidates.push({ type: "extract", item: { x: 112, y: 465 } });
  if (!run.data) candidates.push({ type: "vault", item: { x: 1325, y: 465 } });
  for (const candidate of candidates) {
    const d = dist(player.x, player.y, candidate.item.x, candidate.item.y);
    if (d < nearestDistance && d < (candidate.type === "extract" || candidate.type === "vault" ? 53 : 49)) {
      nearest = candidate; nearestDistance = d;
    }
  }
  const nearbyLoot = loot.find(item => !item.taken && dist(player.x, player.y, item.x, item.y) < 40);
  if (nearbyLoot && (!nearest || dist(player.x, player.y, nearbyLoot.x, nearbyLoot.y) < nearestDistance)) {
    toast("HOLD E TO SECURE LOOT · SECURITY WILL NOTICE");
    return;
  }
  if (!nearest) { toast("NOTHING IN REACH"); return; }
  if (nearest.type === "terminal") hackTerminal(nearest.item);
  else if (nearest.type === "loot") {
    if (!nearest.item.taken) {
      nearest.item.taken = true;
      run.loot += nearest.item.value;
      run.alert = Math.min(100, run.alert + 6.5);
      spawnParticles(nearest.item.x, nearest.item.y, "#ffd477", 15);
      tone(760, .11, "sine");
      toast(`CACHED ${nearest.item.value}¢ · EXPOSURE +`);
    }
  } else if (nearest.type === "vault") stealData();
  else if (nearest.type === "extract") finishRun(true);
}

function hackTerminal(terminal) {
  run.hacked[terminal.id] = true;
  lasers[terminal.id].disabled = 9999;
  for (const camera of cameras) {
    if (dist(terminal.x, terminal.y, camera.x, camera.y) < 470) camera.disabled = 14;
  }
  for (const guard of guards) {
    if (dist(terminal.x, terminal.y, guard.x, guard.y) < 145) { guard.stun = 4; guard.state = "investigate"; }
  }
  run.alert = Math.max(0, run.alert - 8);
  run.lootProgress = 0;
  spawnParticles(terminal.x, terminal.y, "#55e5ff", 22);
  tone(620, .19, "triangle");
  toast(`ACCESS GRANTED · GATE ${terminal.id + 1} OPEN · LOCAL SECURITY OFFLINE`);
}

function stealData() {
  run.data = true;
  run.alert = Math.min(100, run.alert + 12);
  run.shake = 7;
  spawnParticles(1325, 465, "#58e8ff", 36);
  tone(280, .35, "sawtooth");
  toast("CORE SECURED · RETURN TO EXTRACTION");
}

function activateEMP() {
  if (run.emps <= 0) { toast("EMP DEPLETED"); return; }
  run.emps--;
  const pos = mouseWorld();
  const targetX = dist(player.x, player.y, pos.x, pos.y) < 250 ? pos.x : player.x;
  const targetY = dist(player.x, player.y, pos.x, pos.y) < 250 ? pos.y : player.y;
  const radius = 205, duration = 7 + save.upgrades.emp * 3;
  let disabled = 0;
  for (const camera of cameras) if (dist(targetX, targetY, camera.x, camera.y) < radius) { camera.disabled = duration; disabled++; }
  for (const laser of lasers) if (dist(targetX, targetY, laser.x, laser.y + laser.h / 2) < radius) { laser.disabled = duration; disabled++; }
  for (const guard of guards) if (dist(targetX, targetY, guard.x, guard.y) < radius) { guard.stun = 2.8; disabled++; }
  spawnParticles(targetX, targetY, "#52e4ff", 38);
  run.shake = 5;
  noisePings.push({ x: targetX, y: targetY, radius: 360, life: 2 });
  tone(155, .34, "sawtooth");
  toast(`EMP PULSE · ${disabled} SYSTEM${disabled === 1 ? "" : "S"} DISABLED`);
}

function deployDecoy() {
  if (run.decoys <= 0) { toast("DECOYS DEPLETED"); return; }
  run.decoys--;
  const pos = mouseWorld();
  const dx = pos.x - player.x, dy = pos.y - player.y, d = Math.hypot(dx, dy);
  const x = d < 30 ? player.x + Math.cos(player.angle) * 145 : pos.x;
  const y = d < 30 ? player.y + Math.sin(player.angle) * 145 : pos.y;
  const decoy = new Decal(constrain(x, WORLD.left + 20, WORLD.right - 20), constrain(y, WORLD.top + 20, WORLD.bottom - 20));
  decals.push(decoy);
  noisePings.push({ x: decoy.x, y: decoy.y, radius: 460, life: 6 });
  for (const guard of guards) {
    if (dist(guard.x, guard.y, decoy.x, decoy.y) < 470) {
      guard.state = "investigate";
      guard.target = { x: decoy.x, y: decoy.y };
    }
  }
  tone(590, .09, "sine");
  toast("DECOY DEPLOYED · GUARDS INVESTIGATING");
}

function damagePlayer(amount) {
  if (player.invulnerable > 0 || gameState !== "playing") return;
  player.health -= amount;
  player.invulnerable = 1.25;
  raiseAlert(8, true);
  run.shake = 9;
  spawnParticles(player.x, player.y, "#ff4968", 20);
  tone(105, .2, "sawtooth");
  toast(`HIT · ${Math.max(0, player.health)} VITALITY`);
}

function finishRun(won, message = "") {
  if (run.finished) return;
  run.finished = true;
  gameState = won ? "victory" : "failure";
  const difficultyMultiplier = [0.8, 1, 1.3][save.difficulty];
  const stealthBonus = Math.max(0, 100 - run.alert) * 12;
  const timeBonus = Math.max(0, 240 - run.time) * 4;
  const score = won ? Math.round((run.loot * 10 + 1400 + player.health * 250 + stealthBonus + timeBonus) * difficultyMultiplier) : Math.round((run.loot * 8 + player.health * 120 + stealthBonus * .45) * difficultyMultiplier);
  const earnings = Math.max(25, Math.floor(score / 95) + Math.floor(run.loot / 300));
  run.score = score;
  save.credits += earnings;
  const record = score > save.best;
  if (record) save.best = score;
  persist();
  hideAllScreens();
  $("hud").classList.add("hidden");
  $("alert-hud").classList.add("hidden");
  $("gadgets").classList.add("hidden");
  $("result-kicker").innerHTML = won ? '<i class="signal-dot"></i> EXTRACTION // CLEAN GETAWAY' : '<span class="danger-dot"></span> SIGNAL LOST // ASSET COMPROMISED';
  $("result-title").innerHTML = won ? "CLEAN <span>GETAWAY.</span>" : "THE <span>HEIST</span> ENDS.";
  $("result-copy").textContent = message || `You made it out with ${run.loot.toLocaleString()}¢ in optional loot.`;
  $("run-score").textContent = score.toLocaleString().padStart(6, "0");
  $("run-loot").textContent = `${run.loot.toLocaleString()}¢`;
  $("run-time").textContent = formatTime(run.time);
  $("run-alert").textContent = alertName(run.alert);
  $("record-result").textContent = record ? "NEW PERSONAL BEST" : `PERSONAL BEST ${save.best.toLocaleString()}`;
  $("credit-result").textContent = `+${earnings} CREDITS`;
  $("result").classList.remove("hidden");
  tone(won ? 660 : 90, won ? .32 : .48, won ? "triangle" : "sawtooth");
}

function pauseRun() {
  if (gameState !== "playing") return;
  gameState = "paused";
  $("pause").classList.remove("hidden");
}

function resumeRun() {
  if (gameState !== "paused") return;
  $("pause").classList.add("hidden");
  gameState = "playing";
  lastTime = millis();
}

function showMenu() {
  gameState = "menu";
  hideAllScreens();
  $("hud").classList.add("hidden");
  $("alert-hud").classList.add("hidden");
  $("gadgets").classList.add("hidden");
  $("menu").classList.remove("hidden");
  refreshMenu();
}

function showScreen(id) {
  hideAllScreens();
  $(id).classList.remove("hidden");
  gameState = id;
}

function showOnlyGame() {
  hideAllScreens();
  $("hud").classList.remove("hidden");
  $("alert-hud").classList.remove("hidden");
  $("gadgets").classList.remove("hidden");
}

function hideAllScreens() { document.querySelectorAll(".screen").forEach(screen => screen.classList.add("hidden")); }

function onKeyDown(event) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
  if (gameState === "playing") {
    if (event.key.toLowerCase() === "e" && !event.repeat) interact();
    if (event.key.toLowerCase() === "q" && !event.repeat) deployDecoy();
    if (event.key.toLowerCase() === "f" && !event.repeat) activateEMP();
    if (event.key === "Shift" && !event.repeat) player.dash();
    if (event.key === "Escape" && !event.repeat) pauseRun();
  } else if (gameState === "paused" && (event.key === "Escape" || event.key.toLowerCase() === "p")) resumeRun();
  if (event.key.toLowerCase() === "m") toggleSound();
  if (event.key === "Enter" && gameState === "menu") startRun();
}

function onKeyUp() {}

function mousePressed() {
  if (gameState !== "playing" || mouseButton !== LEFT) return;
  ensureAudio();
  if (run.selected === "emp") activateEMP();
  else deployDecoy();
  return false;
}

function updateCamera() {
  const maxX = Math.max(0, WORLD.w - width), maxY = Math.max(0, WORLD.h - height);
  worldOffset.x = width > WORLD.w ? (WORLD.w - width) / 2 : constrain(player ? player.x - width / 2 : 0, 0, maxX);
  worldOffset.y = height > WORLD.h ? (WORLD.h - height) / 2 : constrain(player ? player.y - height / 2 : 0, 0, maxY);
}

function screenToWorld(x, y) { return { x: x + worldOffset.x, y: y + worldOffset.y }; }
function mouseWorld() { return screenToWorld(mouseX, mouseY); }

function updateHud() {
  if (!player || !run || !run.hacked) return;
  $("objective").textContent = run.data ? "RETURN TO EXTRACTION" : "REACH THE VAULT";
  $("loot-value").textContent = `LOOT ${run.loot.toLocaleString()}¢`;
  const health = $("health");
  health.className = "hearts";
  health.replaceChildren(...Array.from({ length: player.maxHealth }, (_, i) => {
    const heart = document.createElement("i");
    heart.className = `heart${i >= player.health ? " empty" : ""}`;
    return heart;
  }));
  $("alert-fill").style.width = `${run.alert}%`;
  const stage = run.alert >= 100 ? 4 : run.alert >= 75 ? 3 : run.alert >= 50 ? 2 : run.alert >= 25 ? 1 : 0;
  $("alert-label").textContent = ["QUIET", "SUSPICIOUS", "SEARCHING", "CRITICAL", "LOCKDOWN"][stage];
  $("alert-stage").textContent = `STAGE ${stage} / 4`;
  const colors = ["#53e5ff", "#ffd15e", "#ff9b45", "#ff546d", "#ff3158"];
  $("alert-fill").style.background = colors[stage];
  $("alert-fill").style.color = colors[stage];
  $("decoy-count").textContent = run.decoys;
  $("emp-count").textContent = run.emps;
  $("decoy-button").classList.toggle("active", run.selected === "decoy");
  $("emp-button").classList.toggle("active", run.selected === "emp");
  $("dash-indicator").classList.toggle("ready", player.dashReady <= 0);
  $("dash-indicator").innerHTML = `<kbd>SHIFT</kbd> ${player.dashReady <= 0 ? "DASH READY" : `DASH ${player.dashReady.toFixed(1)}s`}`;
  const hint = currentInteractionHint();
  $("interact-hint").textContent = hint;
  if (gameState === "playing" && activeToast && millis() < toastUntil) {
    $("toast").textContent = activeToast;
    $("toast").classList.remove("hidden");
  } else $("toast").classList.add("hidden");
}

function currentInteractionHint() {
  if (!player || gameState !== "playing") return "";
  if (run.data && dist(player.x, player.y, 112, 465) < 58) return "E · EXTRACT";
  if (!run.data && dist(player.x, player.y, 1325, 465) < 60) return "E · STEAL CORE";
  for (const terminal of terminals) if (!run.hacked[terminal.id] && dist(player.x, player.y, terminal.x, terminal.y) < 56) return "E · HACK";
  for (const item of loot) if (!item.taken && dist(player.x, player.y, item.x, item.y) < 42) return "HOLD E · LOOT";
  return "";
}

function drawBackground() {
  background(6, 10, 17);
  noStroke();
  for (let i = 0; i < 50; i++) {
    const x = (i * 137 + 47) % width, y = (i * 271 + 13) % height;
    fill(109, 143, 171, 22 + 18 * sin(frameCount * .02 + i));
    circle(x, y, i % 3 === 0 ? 2 : 1);
  }
}

function drawFacility() {
  push();
  noStroke(); fill(8, 14, 23); rect(0, 0, WORLD.w, WORLD.h);
  for (let x = 58; x < WORLD.w - 50; x += 48) {
    for (let y = 60; y < WORLD.h - 40; y += 48) {
      fill(((x + y) / 48) % 2 === 0 ? color(11, 19, 29) : color(10, 17, 27));
      rect(x, y, 48, 48);
      stroke(41, 66, 85, 22); strokeWeight(1); noFill(); rect(x + 5, y + 5, 38, 38);
      noStroke();
    }
  }
  drawRoomAccents();
  for (const block of cover) drawCover(block);
  for (const wall of walls) drawWall(wall);
  drawVault();
  drawExtraction();
  drawWorldLabels();
  pop();
}

function drawRoomAccents() {
  const rooms = [
    [70, 72, 248, 306, "SECURITY ARCHIVE"], [365, 72, 305, 306, "RELAY ROOM"],
    [727, 72, 290, 306, "CONTROL"], [1070, 72, 355, 306, "THE VAULT"],
    [70, 555, 248, 344, "MAINTENANCE"], [365, 555, 305, 344, "STORAGE"],
    [727, 555, 290, 344, "SERVER BAY"], [1070, 555, 355, 344, "COLD STORAGE"]
  ];
  noFill(); stroke(57, 124, 154, 43); strokeWeight(1);
  for (const [x, y, w, h, label] of rooms) {
    rect(x, y, w, h);
    noStroke(); fill(107, 143, 165, 75); textFont("DM Mono"); textSize(8); textAlign(LEFT, TOP); text(label, x + 14, y + 13);
    stroke(57, 124, 154, 43);
  }
  noStroke();
  for (const x of [90, 372, 731, 1073, 1410]) {
    fill(56, 213, 244, 95); rect(x, 412, 22, 3); rect(x, 524, 22, 3);
  }
}

function drawCover(block) {
  push(); drawingContext.shadowBlur = 9; drawingContext.shadowColor = "rgba(37,117,152,.16)";
  noStroke(); fill(19, 31, 42); rect(block.x, block.y, block.w, block.h, 4);
  stroke(54, 96, 120, 100); strokeWeight(1); noFill(); rect(block.x + 3, block.y + 3, block.w - 6, block.h - 6, 3);
  stroke(44, 201, 228, 70); line(block.x + 9, block.y + 7, block.x + Math.min(block.w - 8, 32), block.y + 7);
  drawingContext.shadowBlur = 0; pop();
}

function drawWall(wall) {
  push(); drawingContext.shadowBlur = 10; drawingContext.shadowColor = "rgba(36,168,206,.18)";
  noStroke(); fill(27, 42, 54); rect(wall.x, wall.y, wall.w, wall.h);
  stroke(75, 113, 132, 120); strokeWeight(1); noFill(); rect(wall.x + 2, wall.y + 2, wall.w - 4, wall.h - 4);
  if (wall.w > wall.h) {
    stroke(56, 124, 150, 95);
    for (let x = wall.x + 15; x < wall.x + wall.w; x += 45) line(x, wall.y + 5, x, wall.y + wall.h - 5);
  } else {
    stroke(56, 124, 150, 95);
    for (let y = wall.y + 18; y < wall.y + wall.h; y += 38) line(wall.x + 4, y, wall.x + wall.w - 4, y);
  }
  drawingContext.shadowBlur = 0; pop();
}

function drawVault() {
  push(); translate(1325, 465);
  noFill(); stroke(run.data ? color(73, 230, 255, 120) : color(255, 59, 85, 125)); strokeWeight(2);
  rect(-45, -44, 90, 88, 5); rect(-36, -35, 72, 70, 3);
  drawingContext.shadowBlur = 15; drawingContext.shadowColor = run.data ? "#45ddff" : "#ff405d";
  noStroke(); fill(16, 28, 39); circle(0, 0, 39); fill(run.data ? "#47ddfa" : "#e74d63"); circle(0, 0, 24);
  fill(9, 17, 26); arc(0, 0, 14, 14, -.5, 4.7); circle(0, 1, 5);
  drawingContext.shadowBlur = 0; pop();
}

function drawExtraction() {
  push(); translate(112, 465);
  const active = run.data;
  noFill(); stroke(active ? color(67, 228, 255, 190) : color(63, 191, 216, 80)); strokeWeight(2);
  circle(0, 0, 66 + 3 * sin(frameCount * .08)); circle(0, 0, 44);
  drawingContext.shadowBlur = active ? 18 : 6; drawingContext.shadowColor = "#43dfff";
  noStroke(); fill(active ? color(53, 218, 246, 105) : color(52, 126, 143, 65)); circle(0, 0, 30);
  fill(active ? "#8ff5ff" : "#548c9b"); triangle(-10, 3, 10, 3, 0, -10);
  drawingContext.shadowBlur = 0; pop();
}

function drawWorldLabels() {
  push(); noStroke(); fill(107, 157, 180, 145); textFont("DM Mono"); textSize(8); textAlign(CENTER);
  text("ENTRY / EXIT", 112, 514); text("DATA CORE", 1325, 523);
  fill(58, 180, 202, 120); text("NORTH CORRIDOR", 750, 396); text("SOUTH CORRIDOR", 750, 552);
  pop();
}

function drawInteractionMarker() {
  if (!player) return;
  const hint = currentInteractionHint();
  if (!hint) return;
  push(); translate(player.x, player.y - 28);
  noStroke(); fill(6, 12, 19, 215); rectMode(CENTER); rect(0, 0, 98, 20, 3);
  fill(137, 238, 255); textFont("DM Mono"); textSize(8); textAlign(CENTER, CENTER);
  const shortText = hint.replace("E · ", "");
  text(`E  ${shortText}`, 0, 1); pop();
}

function drawNoisePings() {
  for (const ping of noisePings) {
    push();
    noFill();
    stroke(76, 221, 255, 95 * ping.life / 6);
    strokeWeight(1);
    circle(ping.x, ping.y, 22 + (6 - ping.life) * 48);
    pop();
  }
}

function drawScreenVignette() {
  const context = drawingContext;
  const gradient = context.createRadialGradient(width / 2, height / 2, height * .22, width / 2, height / 2, Math.max(width, height) * .72);
  gradient.addColorStop(0, "rgba(0,0,0,0)"); gradient.addColorStop(1, "rgba(0,0,0,.52)");
  context.fillStyle = gradient; rect(0, 0, width, height);
}

function nearestThing() {
  if (!player) return null;
  let choices = [...terminals.filter(t => !run.hacked[t.id]).map(item => ({ item, type: "terminal", range: 56 })), ...loot.filter(item => !item.taken).map(item => ({ item, type: "loot", range: 42 }))];
  if (!run.data) choices.push({ item: { x: 1325, y: 465 }, type: "vault", range: 60 });
  if (run.data) choices.push({ item: { x: 112, y: 465 }, type: "extract", range: 58 });
  choices = choices.map(value => ({ ...value, distance: dist(player.x, player.y, value.item.x, value.item.y) })).filter(value => value.distance < value.range);
  choices.sort((a, b) => a.distance - b.distance);
  return choices[0] || null;
}

function toast(message) {
  activeToast = message;
  toastUntil = millis() + 2200;
}

function refreshMenu() {
  $("best-score").textContent = save.best.toLocaleString().padStart(6, "0");
  $("credits").textContent = `${save.credits.toLocaleString()}¢`;
  $("difficulty-label").textContent = DIFFICULTIES[save.difficulty];
  $("sound-menu").textContent = `SOUND: ${save.sound ? "ON" : "OFF"}`;
  $("sound-button").textContent = save.sound ? "♫" : "×";
  $("shop-count").textContent = save.credits ? `(${save.credits}¢)` : "";
}

function refreshShop() {
  if (!$("shop-items")) return;
  $("difficulty-label").textContent = DIFFICULTIES[save.difficulty];
  const container = $("shop-items");
  container.replaceChildren();
  for (const item of UPGRADES) {
    const level = save.upgrades[item.id] || 0;
    const cost = item.base * (level + 1);
    const row = document.createElement("div");
    row.className = "shop-item";
    const info = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = item.name;
    const detail = document.createElement("p");
    detail.textContent = item.detail;
    const levelText = document.createElement("span");
    levelText.className = "shop-level";
    levelText.textContent = `LEVEL ${level} / ${item.max}`;
    info.append(name, detail, levelText);
    const button = document.createElement("button");
    button.textContent = level >= item.max ? "MAXED" : `BUY · ${cost}¢`;
    button.disabled = level >= item.max || save.credits < cost;
    button.addEventListener("click", () => buyUpgrade(item));
    row.append(info, button);
    container.append(row);
  }
}

function buyUpgrade(item) {
  const level = save.upgrades[item.id] || 0;
  const cost = item.base * (level + 1);
  if (level >= item.max || save.credits < cost) return;
  save.credits -= cost;
  save.upgrades[item.id] = level + 1;
  persist();
  refreshShop();
  refreshMenu();
  tone(670, .1, "triangle");
}

function cycleDifficulty(direction) {
  save.difficulty = (save.difficulty + direction + DIFFICULTIES.length) % DIFFICULTIES.length;
  persist();
  refreshShop();
  refreshMenu();
}

function toggleSound() {
  save.sound = !save.sound;
  persist();
  refreshMenu();
  if (save.sound) tone(550, .07, "sine");
}

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
function alertName(value) { return value >= 100 ? "LOCKDOWN" : value >= 75 ? "CRITICAL" : value >= 50 ? "SEARCHING" : value >= 25 ? "SUSPICIOUS" : "QUIET"; }

function spawnParticles(x, y, tint, count) {
  const room = Math.max(0, 420 - particles.length);
  for (let i = 0; i < Math.min(count, room); i++) particles.push(new Particle(x, y, tint));
}

function tone(frequency, duration, type) {
  if (!save.sound) return;
  ensureAudio();
  if (!audioContext || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = type || "sine";
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * .45), audioContext.currentTime + duration);
  gain.gain.setValueAtTime(.045, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
  oscillator.connect(gain); gain.connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
}

function ensureAudio() {
  if (!audioContext) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) audioContext = new Audio();
  }
  if (audioContext?.state === "suspended") audioContext.resume();
}

function hex(value, length) { return value.toString(16).padStart(length, "0"); }

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateCamera();
}
