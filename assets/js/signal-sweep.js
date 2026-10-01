(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const frame = document.getElementById('canvasFrame');
  const overlay = document.getElementById('gameOverlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayCopy = document.getElementById('overlayCopy');
  const startButton = document.getElementById('startButton');
  const pauseButton = document.getElementById('pauseButton');
  const restartButton = document.getElementById('restartButton');
  const statusText = document.getElementById('statusText');
  const scoreValue = document.getElementById('scoreValue');
  const integrityValue = document.getElementById('integrityValue');
  const timeValue = document.getElementById('timeValue');
  const levelValue = document.getElementById('levelValue');
  const bestValue = document.getElementById('bestValue');
  const controls = document.querySelectorAll('[data-control]');

  const W = canvas.width;
  const H = canvas.height;
  const keys = new Set();
  const packets = [];
  const threats = [];
  const particles = [];
  const touchMap = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const colors = { bg: '#061321', grid: 'rgba(120,169,255,.085)', accent: '#6ee7d8', blue: '#78a9ff', danger: '#ff6577', text: '#eef5ff' };

  let state = 'ready';
  let score = 0;
  let integrity = 100;
  let timeLeft = 60;
  let level = 1;
  let lastTime = 0;
  let elapsed = 0;
  let invulnerable = 0;
  let best = Number(localStorage.getItem('signalSweepBest') || 0);

  const player = { x: W * .5, y: H * .55, radius: 13, speed: 270, angle: 0 };

  function random(min, max) { return Math.random() * (max - min) + min; }
  function distanceSq(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return dx * dx + dy * dy; }
  function pad(value) { return String(Math.max(0, Math.floor(value))).padStart(3, '0'); }

  function makePacket() {
    return { x: random(40, W - 40), y: random(40, H - 40), radius: 8, phase: random(0, Math.PI * 2), vx: random(-12, 12), vy: random(-12, 12) };
  }

  function makeThreat() {
    const speed = random(75, 115) + level * 12;
    const angle = random(0, Math.PI * 2);
    return { x: random(50, W - 50), y: random(50, H - 50), radius: 13, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, rotation: random(0, Math.PI) };
  }

  function resetGame() {
    score = 0; integrity = 100; timeLeft = 60; level = 1; elapsed = 0; invulnerable = 0;
    player.x = W * .5; player.y = H * .55; player.angle = 0;
    packets.length = 0; threats.length = 0; particles.length = 0;
    for (let i = 0; i < 6; i += 1) packets.push(makePacket());
    for (let i = 0; i < 3; i += 1) threats.push(makeThreat());
    updateHud();
  }

  function startGame() {
    resetGame();
    state = 'running';
    overlay.classList.add('hidden');
    pauseButton.textContent = 'Pause';
    statusText.textContent = 'Network active. Route clean packets.';
    lastTime = performance.now();
  }

  function togglePause() {
    if (state === 'ready' || state === 'over' || state === 'complete') { startGame(); return; }
    if (state === 'running') {
      state = 'paused';
      overlayTitle.textContent = 'System paused.';
      overlayCopy.textContent = 'Your run is preserved. Resume when you are ready.';
      startButton.textContent = 'Resume run';
      overlay.classList.remove('hidden');
      pauseButton.textContent = 'Resume';
      statusText.textContent = 'Simulation paused.';
    } else {
      state = 'running';
      overlay.classList.add('hidden');
      pauseButton.textContent = 'Pause';
      statusText.textContent = 'Network active.';
      lastTime = performance.now();
    }
  }

  function finish(won) {
    state = won ? 'complete' : 'over';
    if (score > best) { best = score; localStorage.setItem('signalSweepBest', String(best)); }
    updateHud();
    overlayTitle.textContent = won ? 'Network stabilized.' : 'Integrity lost.';
    overlayCopy.textContent = won ? `You completed the sweep with ${score} points and ${integrity}% integrity.` : `The network collapsed at ${score} points. Reinitialize and try a cleaner route.`;
    startButton.textContent = 'Run again';
    overlay.classList.remove('hidden');
    statusText.textContent = won ? 'Challenge complete.' : 'Run ended.';
  }

  function burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i += 1) {
      const angle = random(0, Math.PI * 2);
      const speed = random(40, 145);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: random(.35, .8), maxLife: .8, color, radius: random(1.5, 3.5) });
    }
  }

  function updatePlayer(dt) {
    let dx = 0; let dy = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;
    if (dx || dy) {
      const length = Math.hypot(dx, dy);
      dx /= length; dy /= length;
      player.x += dx * player.speed * dt;
      player.y += dy * player.speed * dt;
      player.angle = Math.atan2(dy, dx);
    }
    player.x = Math.max(player.radius + 8, Math.min(W - player.radius - 8, player.x));
    player.y = Math.max(player.radius + 8, Math.min(H - player.radius - 8, player.y));
  }

  function updateEntities(dt) {
    packets.forEach(packet => {
      packet.x += packet.vx * dt; packet.y += packet.vy * dt; packet.phase += dt * 3;
      if (packet.x < 25 || packet.x > W - 25) packet.vx *= -1;
      if (packet.y < 25 || packet.y > H - 25) packet.vy *= -1;
    });
    threats.forEach(threat => {
      threat.x += threat.vx * dt; threat.y += threat.vy * dt; threat.rotation += dt * 1.8;
      if (threat.x < 20 || threat.x > W - 20) threat.vx *= -1;
      if (threat.y < 20 || threat.y > H - 20) threat.vy *= -1;
    });
    particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy *= .985; p.life -= dt; });
    for (let i = particles.length - 1; i >= 0; i -= 1) if (particles[i].life <= 0) particles.splice(i, 1);
  }

  function checkCollisions() {
    packets.forEach((packet, index) => {
      const range = player.radius + packet.radius;
      if (distanceSq(player, packet) < range * range) {
        score += 10 + level * 2;
        burst(packet.x, packet.y, colors.accent, 14);
        packets[index] = makePacket();
        const newLevel = 1 + Math.floor(score / 100);
        if (newLevel > level) {
          level = newLevel;
          threats.push(makeThreat());
          statusText.textContent = `Level ${level}: threat velocity increased.`;
        } else statusText.textContent = 'Clean packet routed.';
      }
    });
    if (invulnerable > 0) return;
    threats.forEach(threat => {
      const range = player.radius + threat.radius;
      if (distanceSq(player, threat) < range * range && invulnerable <= 0) {
        integrity -= 25;
        invulnerable = 1.35;
        burst(player.x, player.y, colors.danger, 20);
        frame.classList.remove('hit'); void frame.offsetWidth; frame.classList.add('hit');
        threat.x = random(40, W - 40); threat.y = random(40, H - 40);
        statusText.textContent = `Corruption detected. Integrity ${integrity}%.`;
        if (integrity <= 0) finish(false);
      }
    });
  }

  function update(dt) {
    elapsed += dt;
    timeLeft = Math.max(0, timeLeft - dt);
    invulnerable = Math.max(0, invulnerable - dt);
    updatePlayer(dt); updateEntities(dt); checkCollisions(); updateHud();
    if (timeLeft <= 0 && state === 'running') finish(true);
  }

  function updateHud() {
    scoreValue.textContent = pad(score);
    integrityValue.textContent = `${integrity}%`;
    integrityValue.style.color = integrity <= 50 ? colors.danger : colors.text;
    timeValue.textContent = timeLeft.toFixed(1);
    levelValue.textContent = String(level).padStart(2, '0');
    bestValue.textContent = pad(best);
  }

  function drawBackground() {
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
    const offset = (elapsed * 14) % 40;
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = -40 + offset; x < W + 40; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -40 + offset; y < H + 40; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(110,231,216,.11)';
    packets.forEach((a, i) => packets.slice(i + 1).forEach(b => {
      const d = Math.sqrt(distanceSq(a, b));
      if (d < 245) { ctx.globalAlpha = 1 - d / 245; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }));
    ctx.globalAlpha = 1;
  }

  function drawPackets() {
    packets.forEach(packet => {
      const pulse = 3 + Math.sin(packet.phase) * 2;
      ctx.strokeStyle = 'rgba(110,231,216,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(packet.x, packet.y, packet.radius + 7 + pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = colors.accent; ctx.shadowColor = colors.accent; ctx.shadowBlur = 15; ctx.beginPath(); ctx.arc(packet.x, packet.y, packet.radius, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = colors.bg; ctx.beginPath(); ctx.arc(packet.x, packet.y, 2.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawThreats() {
    threats.forEach(threat => {
      ctx.save(); ctx.translate(threat.x, threat.y); ctx.rotate(threat.rotation); ctx.shadowColor = colors.danger; ctx.shadowBlur = 18; ctx.fillStyle = colors.danger; ctx.fillRect(-threat.radius * .72, -threat.radius * .72, threat.radius * 1.44, threat.radius * 1.44); ctx.shadowBlur = 0; ctx.strokeStyle = colors.bg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.stroke(); ctx.restore();
    });
  }

  function drawPlayer() {
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.angle);
    ctx.globalAlpha = invulnerable > 0 && Math.floor(invulnerable * 10) % 2 ? .35 : 1;
    ctx.shadowColor = colors.accent; ctx.shadowBlur = 18; ctx.fillStyle = colors.accent; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-11, -11); ctx.lineTo(-6, 0); ctx.lineTo(-11, 11); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = colors.bg; ctx.beginPath(); ctx.arc(1, 0, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (invulnerable > 0) { ctx.strokeStyle = 'rgba(120,169,255,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(player.x, player.y, 23 + Math.sin(elapsed * 12) * 3, 0, Math.PI * 2); ctx.stroke(); }
  }

  function drawParticles() {
    particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1;
  }

  function draw() { drawBackground(); drawPackets(); drawThreats(); drawParticles(); drawPlayer(); }

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000 || 0, .033);
    lastTime = now;
    if (state === 'running') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('keydown', event => {
    const movement = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
    if (movement.includes(event.code)) { event.preventDefault(); keys.add(event.code); }
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); togglePause(); }
    if (event.code === 'KeyR' && !event.repeat) startGame();
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'running') togglePause(); });

  controls.forEach(button => {
    const code = touchMap[button.dataset.control];
    const press = event => { event.preventDefault(); keys.add(code); button.classList.add('active'); };
    const release = event => { event.preventDefault(); keys.delete(code); button.classList.remove('active'); };
    button.addEventListener('pointerdown', press); button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('pointerleave', release);
  });

  startButton.addEventListener('click', () => state === 'paused' ? togglePause() : startGame());
  pauseButton.addEventListener('click', togglePause);
  restartButton.addEventListener('click', startGame);
  bestValue.textContent = pad(best);
  resetGame();
  requestAnimationFrame(loop);
})();
