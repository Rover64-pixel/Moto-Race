const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const statusMessage = document.getElementById('status-message');
const currentTimeEl = document.getElementById('current-time');
const bestTimeEl = document.getElementById('best-time');
const attemptsEl = document.getElementById('attempts');

const keys = {
  ArrowLeft: false,
  ArrowRight: false,
  KeyA: false,
  KeyD: false,
  KeyW: false,
  KeyR: false,
};

let currentTrack = null;
let bike = null;
let elapsedTime = 0;
let bestTime = null;
let attempts = 0;
let attemptStartTime = 0;
let timerActive = false;
let lastFrameTime = 0;
let crashFlash = 0;
let explosion = null;
let completionOverlay = null;
let messageTimer = 0;
let messageText = '';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(seconds) {
  return seconds === null ? '--' : `${seconds.toFixed(2)}s`;
}

function setMessage(text) {
  statusMessage.textContent = text;
  messageText = text;
  messageTimer = 2.2;
}

function resetAttempt(startNewTrack = true) {
  if (startNewTrack) {
    currentTrack = generateTrack();
    attempts += 1;
    attemptsEl.textContent = attempts;
    attemptStartTime = performance.now();
    timerActive = true;
    elapsedTime = 0;
    currentTimeEl.textContent = formatTime(0);
  } else if (!timerActive) {
    attemptStartTime = performance.now();
    timerActive = true;
  }

  bike = {
    progress: 0,
    offset: 0,
    speed: 0,
    steer: 0,
    turnAngle: 0,
    x: canvas.width * 0.5,
    y: canvas.height * 0.5,
    angle: 0,
    roll: 0,
  };
  crashFlash = 0;
  explosion = null;
  completionOverlay = null;
}

function generateTrack() {
  const points = [];
  const width = canvas.width;
  const height = canvas.height;
  const roadWidth = 78;
  const segmentCount = 12;
  const targetLength = 3000;

  let x = width * 0.5;
  let y = height * 0.5;
  let angle = -Math.PI / 4 + Math.random() * Math.PI / 2;

  points.push({ x, y });

  for (let i = 0; i < segmentCount; i += 1) {
    const baseLength = targetLength / segmentCount;
    const length = clamp(baseLength + (Math.random() - 0.5) * 90, 140, 220);
    const turn = (Math.random() - 0.5) * 0.95;
    angle += turn;
    x += Math.cos(angle) * length;
    y += Math.sin(angle) * length;
    points.push({ x, y });
  }

  const bounds = points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );

  const offsetX = (width * 0.5) - ((bounds.minX + bounds.maxX) / 2);
  const offsetY = (height * 0.5) - ((bounds.minY + bounds.maxY) / 2);

  const worldPoints = points.map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY,
  }));

  const segments = [];
  let length = 0;
  for (let i = 0; i < worldPoints.length - 1; i += 1) {
    const start = worldPoints[i];
    const end = worldPoints[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segLength = Math.hypot(dx, dy);
    segments.push({ start, end, length, segLength, dx, dy });
    length += segLength;
  }

  const hazards = [];
  for (let i = 0; i < 4; i += 1) {
    const progress = (0.16 + i * 0.18 + Math.random() * 0.08) * length;
    const side = Math.random() < 0.5 ? -1 : 1;
    const type = Math.random() < 0.5 ? 'spike' : 'drop';
    hazards.push({ progress, side, type });
  }

  hazards.sort((a, b) => a.progress - b.progress);

  const features = [
    { progress: length * 0.28, length: 260, type: 'ramp', height: 76 },
    { progress: length * 0.58, length: 420, type: 'loop', radius: 104 },
    { progress: length * 0.82, length: 240, type: 'ramp', height: 60 },
  ];

  return { points: worldPoints, segments, length, roadWidth, hazards, features };
}

function getBaseTrackPoint(progress, offset, track) {
  let remaining = progress;
  for (const segment of track.segments) {
    if (remaining <= segment.segLength) {
      const t = remaining / segment.segLength;
      const x = segment.start.x + segment.dx * t;
      const y = segment.start.y + segment.dy * t;
      const nx = -segment.dy / segment.segLength;
      const ny = segment.dx / segment.segLength;
      return {
        x: x + nx * offset,
        y: y + ny * offset,
        tangentX: segment.dx / segment.segLength,
        tangentY: segment.dy / segment.segLength,
      };
    }
    remaining -= segment.segLength;
  }
  return getBaseTrackPoint(track.length - 1, offset, track);
}

function getTrackPoint(progress, offset, track) {
  const base = getBaseTrackPoint(progress, offset, track);
  const feature = track.features.find((entry) => progress >= entry.progress && progress <= entry.progress + entry.length);

  if (!feature) {
    return base;
  }

  const t = clamp((progress - feature.progress) / feature.length, 0, 1);

  if (feature.type === 'ramp') {
    const lift = Math.sin(t * Math.PI) * feature.height;
    const tilt = Math.sin(t * Math.PI) * 0.18;
    const liftX = -base.tangentY * lift * 0.18;
    const liftY = base.tangentX * lift * 0.18;
    return {
      ...base,
      x: base.x + liftX,
      y: base.y + liftY,
      roll: tilt,
    };
  }

  if (feature.type === 'loop') {
    const loopAngle = t * Math.PI * 2;
    const orbitX = Math.cos(loopAngle) * 26;
    const orbitY = Math.sin(loopAngle) * 18;
    const tangentAngle = loopAngle + Math.PI / 2;
    return {
      x: base.x + orbitX,
      y: base.y - orbitY,
      tangentX: Math.cos(tangentAngle),
      tangentY: Math.sin(tangentAngle),
      roll: Math.sin(loopAngle) * 0.18,
    };
  }

  return base;
}

function checkHazards(track, progress, offset) {
  for (const hazard of track.hazards) {
    if (Math.abs(progress - hazard.progress) < 28) {
      const safeOffset = hazard.type === 'spike' ? track.roadWidth * 0.2 : track.roadWidth * 0.14;
      if (hazard.side < 0 && offset < -safeOffset) {
        return hazard;
      }
      if (hazard.side > 0 && offset > safeOffset) {
        return hazard;
      }
    }
  }
  return null;
}

function crash() {
  if (explosion) {
    return;
  }

  explosion = {
    x: bike.x,
    y: bike.y,
    timer: 0.55,
    particles: Array.from({ length: 16 }, () => ({
      x: 0,
      y: 0,
      vx: (Math.random() - 0.5) * 180,
      vy: (Math.random() - 0.5) * 180,
      life: 0.7 + Math.random() * 0.4,
    })),
  };
  crashFlash = 0.8;
  setMessage('Explosion! The bike resets to the start and the clock keeps going.');
}

function resetAfterExplosion() {
  currentTrack = generateTrack();
  attempts += 1;
  attemptsEl.textContent = attempts;
  bike.progress = 0;
  bike.offset = 0;
  bike.speed = 0;
  bike.steer = 0;
  bike.x = canvas.width * 0.5;
  bike.y = canvas.height * 0.5;
  bike.angle = 0;
  bike.roll = 0;
  explosion = null;
}

function finishRun() {
  const roundTime = elapsedTime;
  let isNewRecord = false;

  if (bestTime === null || roundTime < bestTime) {
    bestTime = roundTime;
    bestTimeEl.textContent = formatTime(bestTime);
    isNewRecord = true;
  }

  completionOverlay = {
    timeLeft: 2.4,
    roundTime,
    bestTime,
    isNewRecord,
  };
  timerActive = false;
  currentTimeEl.textContent = formatTime(roundTime);
  setMessage(isNewRecord ? `NEW RECORD! ${formatTime(roundTime)}.` : 'You finished!');
}

function update(deltaTime) {
  if (!currentTrack || !bike) {
    return;
  }

  const throttle = keys.KeyW ? 1 : 0;
  const steerInput = (keys.ArrowLeft || keys.KeyA ? -1 : 0) + (keys.ArrowRight || keys.KeyD ? 1 : 0);

  if (throttle > 0) {
    bike.speed += 180 * deltaTime;
  } else {
    bike.speed -= 65 * deltaTime;
  }

  bike.speed = clamp(bike.speed, 0, 280);

  const turnStrength = 0.0042;
  bike.turnAngle = clamp(bike.turnAngle + steerInput * turnStrength * deltaTime * 100, -0.9, 0.9);

  if (steerInput === 0) {
    bike.steer = 0;
  } else {
    bike.steer = clamp(bike.steer + steerInput * 0.0032 * deltaTime * 100, -0.95, 0.95);
  }

  bike.offset += bike.steer * Math.max(90, bike.speed * 0.75) * deltaTime;
  bike.offset = clamp(bike.offset, -currentTrack.roadWidth * 0.44, currentTrack.roadWidth * 0.44);
  bike.progress += bike.speed * deltaTime;

  if (completionOverlay) {
    completionOverlay.timeLeft -= deltaTime;
    if (completionOverlay.timeLeft <= 0) {
      resetAttempt(true);
    }
    return;
  }

  if (bike.progress >= currentTrack.length) {
    finishRun();
    return;
  }

  if (Math.abs(bike.offset) > currentTrack.roadWidth * 0.44) {
    crash();
    return;
  }

  const hazard = checkHazards(currentTrack, bike.progress, bike.offset);
  if (hazard) {
    crash();
    return;
  }

  if (explosion) {
    explosion.timer -= deltaTime;
    explosion.particles.forEach((particle) => {
      particle.life -= deltaTime;
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vy += 70 * deltaTime;
    });

    if (explosion.timer <= 0 || explosion.particles.every((particle) => particle.life <= 0)) {
      resetAfterExplosion();
    }
  }

  if (timerActive) {
    elapsedTime = (performance.now() - attemptStartTime) / 1000;
    currentTimeEl.textContent = formatTime(elapsedTime);
  }
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#020617');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 18; i += 1) {
    const x = 30 + (i * 48);
    const y = 40 + ((i % 3) * 70);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, canvas.height * 0.72, canvas.width, canvas.height * 0.28);
}

function syncBikePosition() {
  const bikePos = getTrackPoint(bike.progress, bike.offset, currentTrack);
  bike.x = bikePos.x;
  bike.y = bikePos.y;
  bike.angle = Math.atan2(bikePos.tangentY, bikePos.tangentX);
  bike.roll = bikePos.roll || 0;
}

function drawTrack(track) {
  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.7);
  ctx.scale(1, 0.86);
  ctx.translate(-bike.x, -bike.y);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = track.roadWidth + 24;
  ctx.beginPath();
  track.segments.forEach((segment, index) => {
    if (index === 0) {
      ctx.moveTo(segment.start.x, segment.start.y);
    } else {
      ctx.lineTo(segment.end.x, segment.end.y);
    }
  });
  ctx.stroke();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = track.roadWidth + 1;
  ctx.stroke();

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 8;
  ctx.setLineDash([20, 20]);
  ctx.beginPath();
  track.segments.forEach((segment, index) => {
    const point = index === 0 ? segment.start : segment.end;
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(track.points[0].x, track.points[0].y);
  ctx.lineTo(track.points[1].x, track.points[1].y);
  ctx.stroke();

  track.features.forEach((feature) => {
    const startPoint = getTrackPoint(feature.progress, 0, track);
    const endPoint = getTrackPoint(feature.progress + feature.length, 0, track);
    ctx.save();
    if (feature.type === 'ramp') {
      const midPoint = getTrackPoint(feature.progress + feature.length * 0.5, 0, track);
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      ctx.lineTo(midPoint.x, midPoint.y);
      ctx.lineTo(endPoint.x, endPoint.y);
      ctx.stroke();
    } else {
      const center = getTrackPoint(feature.progress + feature.length * 0.5, 0, track);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(center.x, center.y, feature.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  });

  track.hazards.forEach((hazard) => {
    const point = getTrackPoint(hazard.progress, hazard.side * track.roadWidth * 0.26, track);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(Math.atan2(point.tangentY, point.tangentX));
    ctx.fillStyle = hazard.type === 'spike' ? '#ef4444' : '#8b5cf6';
    ctx.beginPath();
    if (hazard.type === 'spike') {
      ctx.moveTo(0, -18);
      ctx.lineTo(12, 18);
      ctx.lineTo(-12, 18);
      ctx.closePath();
    } else {
      ctx.rect(-12, -12, 24, 24);
    }
    ctx.fill();
    ctx.restore();
  });

  const finishPoint = getTrackPoint(track.length - 12, 0, track);
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(finishPoint.x - 34, finishPoint.y - 26);
  ctx.lineTo(finishPoint.x + 34, finishPoint.y + 26);
  ctx.stroke();

  ctx.restore();
}

function drawBike() {
  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.rotate(bike.angle + bike.roll + bike.turnAngle * 0.12);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.fillStyle = '#f59e0b';
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(-24, -10, 48, 20, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-18, -8, 20, 4);
  ctx.fillRect(8, -7, 14, 4);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(-2, -18);
  ctx.moveTo(12, 0);
  ctx.lineTo(24, -14);
  ctx.stroke();

  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-18, 0, 12, 0, Math.PI * 2);
  ctx.arc(18, 0, 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(-18, 0, 6, 0, Math.PI * 2);
  ctx.arc(18, 0, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.fillRect(26, -6, 10, 12);

  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -10);
  ctx.lineTo(0, -22);
  ctx.moveTo(8, -10);
  ctx.lineTo(0, -22);
  ctx.stroke();

  ctx.restore();
}

function drawOverlay() {
  if (crashFlash > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(248, 113, 113, ${crashFlash * 0.4})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    crashFlash -= 0.02;
  }

  if (completionOverlay) {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText('You Finished!', canvas.width / 2, canvas.height / 2 - 70);

    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`Current Round: ${formatTime(completionOverlay.roundTime)}`, canvas.width / 2, canvas.height / 2 - 16);
    ctx.fillText(`High Score: ${formatTime(completionOverlay.bestTime)}`, canvas.width / 2, canvas.height / 2 + 22);

    if (completionOverlay.isNewRecord) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('New Record!', canvas.width / 2, canvas.height / 2 + 70);
    }

    ctx.restore();
  }

  if (explosion) {
    ctx.save();
    ctx.translate(explosion.x, explosion.y);
    explosion.particles.forEach((particle) => {
      if (particle.life > 0) {
        ctx.globalAlpha = clamp(particle.life / 0.7, 0, 1);
        ctx.fillStyle = particle.life > 0.35 ? '#f59e0b' : '#ef4444';
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 3 + Math.random() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }
}

function render() {
  if (!currentTrack) {
    return;
  }

  syncBikePosition();
  drawBackground();
  drawTrack(currentTrack);
  if (!explosion) {
    drawBike();
  }
  drawOverlay();
}

function tick(timestamp) {
  if (!lastFrameTime) {
    lastFrameTime = timestamp;
  }
  const deltaTime = Math.min((timestamp - lastFrameTime) / 1000, 0.032);
  lastFrameTime = timestamp;

  update(deltaTime);
  render();

  if (messageTimer > 0) {
    messageTimer -= deltaTime;
    if (messageTimer <= 0) {
      statusMessage.textContent = 'Lean into the corners and keep the throttle alive.';
    }
  }

  requestAnimationFrame(tick);
}

window.addEventListener('keydown', (event) => {
  if (keys.hasOwnProperty(event.code)) {
    keys[event.code] = true;
    event.preventDefault();
  }
  if (event.code === 'KeyR') {
    resetAttempt(false);
    setMessage('Attempt restarted. The timer keeps going.');
  }
});

window.addEventListener('keyup', (event) => {
  if (keys.hasOwnProperty(event.code)) {
    keys[event.code] = false;
  }
});

bestTimeEl.textContent = formatTime(bestTime);
resetAttempt(true);
setMessage('Fresh course loaded. Hold W and steer around hazards.');
requestAnimationFrame(tick);
