(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const canvas = $('#cosmosCanvas');
  const viewport = $('#cosmosViewport');
  if (!canvas || !viewport) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const ui = {
    status: $('#cosmosStatus'), bodyCount: $('#cosmosBodyCount'), time: $('#cosmosTimeValue'), zoom: $('#cosmosZoomValue'),
    energy: $('#cosmosEnergyDrift'), momentum: $('#cosmosMomentumDrift'), selectedName: $('#cosmosSelectedName'),
    selectedType: $('#cosmosSelectedType'), selectedMass: $('#cosmosSelectedMass'), selectedDistance: $('#cosmosSelectedDistance'),
    selectedVelocity: $('#cosmosSelectedVelocity'), selectedPeriod: $('#cosmosSelectedPeriod'), gravity: $('#cosmosGravityToggle'),
    velocity: $('#cosmosVelocityToggle'), trails: $('#cosmosTrailsToggle'), form: $('#cosmosAddForm'), marker: $('#cosmosObjectMarker')
  };

  const G = 0.0007;
  const SOFTENING = 0.045;
  const FIXED_STEP = 0.003;
  const BASE_RATE = 0.36;
  const MAX_BODIES = 10;
  const SPEEDS = [0.25, 1, 4, 16];
  const palette = ['#6ee7d8', '#78a9ff', '#d49cff', '#f2b66d', '#8be0ff', '#ff91a4', '#9bd589'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 960;
  let height = 540;
  let dpr = 1;
  let bodies = [];
  let selectedId = 0;
  let nextId = 1;
  let paused = reducedMotion;
  let direction = 1;
  let speedIndex = 1;
  let resonance = false;
  let accumulator = 0;
  let lastFrame = performance.now();
  let simulationTime = 0;
  let trailTick = 0;
  let resonanceTrail = [];
  let initialEnergy = 0;
  let initialAngularMomentum = 0;
  let lastTelemetry = 0;
  let needsDraw = true;
  let visible = true;
  let camera = { x: 0, y: 0, zoom: 105 };
  let drag = null;
  const pointers = new Map();
  let pinch = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const magnitude = (x, y) => Math.hypot(x, y);
  const hash = (x, y, seed = 0) => {
    let h = Math.imul(x ^ (seed * 374761393), 668265263) ^ Math.imul(y, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  function announce(message) {
    if (ui.status) ui.status.textContent = message.toUpperCase();
  }

  function makeBody({ name, type = 'PLANET', mass, radius, color, x, y, vx, vy, visualRadius }) {
    return { id: nextId++, name, type, mass, radius, color, x, y, vx, vy, ax: 0, ay: 0, visualRadius, trail: [] };
  }

  function circularBody(name, distance, massEarths, phase, color, ratio = 1) {
    const star = bodies[0];
    const speed = Math.sqrt(G * star.mass / distance) * ratio;
    return makeBody({
      name, mass: massEarths * 0.001, radius: 0.012, visualRadius: clamp(5 + Math.sqrt(massEarths) * 1.3, 6, 12), color,
      x: Math.cos(phase) * distance, y: Math.sin(phase) * distance,
      vx: -Math.sin(phase) * speed, vy: Math.cos(phase) * speed
    });
  }

  function balanceMomentum() {
    const star = bodies[0];
    let px = 0; let py = 0;
    bodies.slice(1).forEach(body => { px += body.mass * body.vx; py += body.mass * body.vy; });
    star.vx = -px / star.mass; star.vy = -py / star.mass;
  }

  function resetSystem(useResonance = resonance) {
    nextId = 0;
    bodies = [makeBody({ name: 'Asterion', type: 'CENTRAL STAR', mass: 1000, radius: 0.055, visualRadius: 17, color: '#f8fbff', x: 0, y: 0, vx: 0, vy: 0 })];
    if (useResonance) {
      const base = 1.15;
      bodies.push(circularBody('Lyra', base, 0.8, 0.15, palette[0]));
      bodies.push(circularBody('Caelum', base * Math.pow(2, 2 / 3), 1.3, 2.25, palette[1]));
      bodies.push(circularBody('Moirai', base * Math.pow(4, 2 / 3), 2.1, 4.2, palette[2]));
    } else {
      bodies.push(circularBody('Iona', 1.05, 0.45, 0.15, palette[0], 1.02));
      bodies.push(circularBody('Neris', 1.72, 1.0, 2.15, palette[1], 0.985));
      bodies.push(circularBody('Vesper', 2.68, 2.5, 4.0, palette[2], 1.015));
      bodies.push(circularBody('Orison', 3.95, 4.2, 5.25, palette[3], 0.995));
    }
    balanceMomentum();
    computeAccelerations();
    selectedId = bodies[0].id;
    simulationTime = 0;
    accumulator = 0;
    resonanceTrail = [];
    bodies.forEach(body => { body.trail = [{ x: body.x, y: body.y }]; });
    setBaselineDiagnostics();
    updateInspector();
    updateTelemetry(true);
    needsDraw = true;
    announce(useResonance ? 'RESONANCE SYSTEM READY' : (paused ? 'PAUSED / READY' : 'SIMULATION ONLINE'));
  }

  function computeAccelerations() {
    bodies.forEach(body => { body.ax = 0; body.ay = 0; });
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i]; const b = bodies[j];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const r2 = dx * dx + dy * dy + SOFTENING * SOFTENING;
        const invR3 = 1 / Math.pow(r2, 1.5);
        a.ax += G * b.mass * dx * invR3; a.ay += G * b.mass * dy * invR3;
        b.ax -= G * a.mass * dx * invR3; b.ay -= G * a.mass * dy * invR3;
      }
    }
  }

  function integrate(dt) {
    const old = bodies.map(body => ({ ax: body.ax, ay: body.ay }));
    bodies.forEach(body => {
      body.x += body.vx * dt + 0.5 * body.ax * dt * dt;
      body.y += body.vy * dt + 0.5 * body.ay * dt * dt;
    });
    computeAccelerations();
    bodies.forEach((body, index) => {
      body.vx += 0.5 * (old[index].ax + body.ax) * dt;
      body.vy += 0.5 * (old[index].ay + body.ay) * dt;
    });
    simulationTime += dt;
    trailTick += 1;
    if (trailTick % (resonance ? 2 : 5) === 0) recordTrails();
  }

  function recordTrails() {
    const limit = resonance ? 1600 : 620;
    bodies.slice(1).forEach(body => {
      body.trail.push({ x: body.x, y: body.y });
      if (body.trail.length > limit) body.trail.splice(0, body.trail.length - limit);
    });
    if (resonance && bodies.length >= 4) {
      resonanceTrail.push(bodies.slice(1, 4).map(body => ({ x: body.x, y: body.y })));
      if (resonanceTrail.length > 780) resonanceTrail.shift();
    }
  }

  function totalEnergy() {
    let energy = bodies.reduce((sum, body) => sum + 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy), 0);
    for (let i = 0; i < bodies.length; i += 1) for (let j = i + 1; j < bodies.length; j += 1) {
      const dx = bodies[j].x - bodies[i].x; const dy = bodies[j].y - bodies[i].y;
      energy -= G * bodies[i].mass * bodies[j].mass / Math.sqrt(dx * dx + dy * dy + SOFTENING * SOFTENING);
    }
    return energy;
  }

  function angularMomentum() {
    return bodies.reduce((sum, body) => sum + body.mass * (body.x * body.vy - body.y * body.vx), 0);
  }

  function setBaselineDiagnostics() {
    initialEnergy = totalEnergy();
    initialAngularMomentum = angularMomentum();
  }

  function drift(current, baseline) {
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || Math.abs(baseline) < 1e-12) return '—';
    const value = Math.abs((current - baseline) / baseline) * 100;
    return `${value < 0.001 ? '<0.001' : value.toFixed(value < 1 ? 3 : 2)}%`;
  }

  function updateTelemetry(force = false) {
    const now = performance.now();
    if (!force && now - lastTelemetry < 220) return;
    lastTelemetry = now;
    if (ui.bodyCount) ui.bodyCount.textContent = String(bodies.length).padStart(2, '0');
    if (ui.time) ui.time.textContent = `${direction < 0 ? '−' : ''}${SPEEDS[speedIndex].toFixed(SPEEDS[speedIndex] < 1 ? 2 : 0)}×`;
    if (ui.zoom) ui.zoom.textContent = `${Math.round(camera.zoom / 1.05)}%`;
    if (ui.energy) ui.energy.textContent = drift(totalEnergy(), initialEnergy);
    if (ui.momentum) ui.momentum.textContent = drift(angularMomentum(), initialAngularMomentum);
  }

  function worldToScreen(x, y) {
    return { x: width / 2 + (x - camera.x) * camera.zoom, y: height / 2 + (y - camera.y) * camera.zoom };
  }

  function screenToWorld(x, y) {
    return { x: camera.x + (x - width / 2) / camera.zoom, y: camera.y + (y - height / 2) / camera.zoom };
  }

  function drawStarfield() {
    ctx.fillStyle = '#040914';
    ctx.fillRect(0, 0, width, height);
    const layers = [
      { cellPixels: 72, parallax: 0.14, alpha: 0.42, size: 0.8, seed: 11 },
      { cellPixels: 112, parallax: 0.3, alpha: 0.62, size: 1.15, seed: 37 },
      { cellPixels: 176, parallax: 0.52, alpha: 0.82, size: 1.6, seed: 79 }
    ];
    layers.forEach(layer => {
      const ox = -camera.x * camera.zoom * layer.parallax;
      const oy = -camera.y * camera.zoom * layer.parallax;
      const startX = Math.floor((-ox) / layer.cellPixels) - 1;
      const endX = Math.ceil((width - ox) / layer.cellPixels) + 1;
      const startY = Math.floor((-oy) / layer.cellPixels) - 1;
      const endY = Math.ceil((height - oy) / layer.cellPixels) + 1;
      for (let gx = startX; gx <= endX; gx += 1) for (let gy = startY; gy <= endY; gy += 1) {
        const chance = hash(gx, gy, layer.seed);
        if (chance < 0.32) continue;
        const x = gx * layer.cellPixels + ox + hash(gx, gy, layer.seed + 3) * layer.cellPixels;
        const y = gy * layer.cellPixels + oy + hash(gx, gy, layer.seed + 7) * layer.cellPixels;
        const twinkle = 0.72 + Math.sin(simulationTime * 0.25 + chance * 18) * 0.18;
        const spectral = hash(gx, gy, layer.seed + 13);
        ctx.fillStyle = spectral > 0.88 ? `rgba(160,190,255,${layer.alpha * twinkle})` : spectral < 0.08 ? `rgba(255,220,170,${layer.alpha * twinkle})` : `rgba(238,245,255,${layer.alpha * twinkle})`;
        ctx.beginPath(); ctx.arc(x, y, layer.size * (0.75 + chance * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    });
    const gradient = ctx.createRadialGradient(width * 0.55, height * 0.45, 0, width * 0.55, height * 0.45, Math.max(width, height) * 0.72);
    gradient.addColorStop(0, 'rgba(62,95,150,.075)'); gradient.addColorStop(1, 'rgba(3,8,18,.5)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  }

  function accelerationAt(x, y) {
    let ax = 0; let ay = 0;
    bodies.forEach(body => {
      const dx = body.x - x; const dy = body.y - y;
      const r2 = dx * dx + dy * dy + SOFTENING * SOFTENING;
      const invR3 = 1 / Math.pow(r2, 1.5);
      ax += G * body.mass * dx * invR3; ay += G * body.mass * dy * invR3;
    });
    return { ax, ay };
  }

  function drawGravityField() {
    if (!ui.gravity?.checked) return;
    ctx.save(); ctx.strokeStyle = 'rgba(110,231,216,.28)'; ctx.fillStyle = 'rgba(110,231,216,.38)'; ctx.lineWidth = 1;
    const spacing = width < 600 ? 92 : 78;
    for (let sx = spacing / 2; sx < width; sx += spacing) for (let sy = spacing / 2; sy < height; sy += spacing) {
      const world = screenToWorld(sx, sy); const a = accelerationAt(world.x, world.y); const m = magnitude(a.ax, a.ay);
      if (!Number.isFinite(m) || m < 1e-8) continue;
      const length = clamp(7 + Math.log10(1 + m * 20000) * 6, 8, 28); const angle = Math.atan2(a.ay, a.ax);
      const ex = sx + Math.cos(angle) * length; const ey = sy + Math.sin(angle) * length;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawTrails() {
    if (!ui.trails?.checked) return;
    bodies.slice(1).forEach(body => {
      if (body.trail.length < 2) return;
      ctx.save(); ctx.strokeStyle = body.color; ctx.lineWidth = resonance ? 1.15 : 1; ctx.globalAlpha = resonance ? 0.38 : 0.3; ctx.beginPath();
      body.trail.forEach((point, index) => { const p = worldToScreen(point.x, point.y); if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke(); ctx.restore();
    });
    if (resonance && resonanceTrail.length > 1) {
      ctx.save(); ctx.lineWidth = 0.75;
      resonanceTrail.forEach((frame, index) => {
        if (index % 3) return;
        ctx.globalAlpha = 0.025 + 0.12 * index / resonanceTrail.length;
        ctx.strokeStyle = index % 9 === 0 ? '#d49cff' : '#6ee7d8'; ctx.beginPath();
        frame.forEach((point, pointIndex) => { const p = worldToScreen(point.x, point.y); if (pointIndex === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath(); ctx.stroke();
      });
      ctx.restore();
    }
  }

  function drawVelocity(body, screen) {
    if (!ui.velocity?.checked || body.type === 'CENTRAL STAR') return;
    const scale = 52 / Math.max(0.35, camera.zoom / 105);
    const ex = screen.x + body.vx * scale; const ey = screen.y + body.vy * scale;
    const angle = Math.atan2(ey - screen.y, ex - screen.x);
    ctx.save(); ctx.strokeStyle = 'rgba(120,169,255,.82)'; ctx.fillStyle = '#78a9ff'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(screen.x, screen.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(angle - .55) * 7, ey - Math.sin(angle - .55) * 7); ctx.lineTo(ex - Math.cos(angle + .55) * 7, ey - Math.sin(angle + .55) * 7); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawBody(body) {
    const p = worldToScreen(body.x, body.y);
    if (p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60) return;
    const radius = body.type === 'CENTRAL STAR' ? body.visualRadius : clamp(body.visualRadius * Math.pow(camera.zoom / 105, 0.13), 5, 15);
    ctx.save();
    if (body.type === 'CENTRAL STAR') {
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 5);
      glow.addColorStop(0, 'rgba(255,255,255,.85)'); glow.addColorStop(.16, 'rgba(120,169,255,.5)'); glow.addColorStop(1, 'rgba(120,169,255,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, radius * 5, 0, Math.PI * 2); ctx.fill();
    } else { ctx.shadowColor = body.color; ctx.shadowBlur = 15; }
    ctx.fillStyle = body.color; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    if (body.id === selectedId) { ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, radius + 9, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = 'rgba(238,245,255,.75)'; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillText(body.name.toUpperCase(), p.x + radius + 11, p.y - radius - 2);
    ctx.restore();
    drawVelocity(body, p);
  }

  function draw() {
    drawStarfield(); drawGravityField(); drawTrails(); bodies.forEach(drawBody);
    if (resonance) {
      ctx.save(); ctx.fillStyle = 'rgba(212,156,255,.72)'; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillText('∞ RESONANCE / PERIOD RATIOS 1:2:4', 20, height - 20); ctx.restore();
    }
    needsDraw = false;
  }

  function updateInspector() {
    const body = bodies.find(item => item.id === selectedId) || bodies[0];
    if (!body) return;
    const star = bodies[0]; const dx = body.x - star.x; const dy = body.y - star.y; const distance = magnitude(dx, dy); const speed = magnitude(body.vx - star.vx, body.vy - star.vy);
    const period = body.type === 'CENTRAL STAR' ? null : 2 * Math.PI * Math.sqrt(Math.pow(distance, 3) / (G * star.mass));
    if (ui.selectedName) ui.selectedName.textContent = body.name;
    if (ui.selectedType) ui.selectedType.textContent = body.type;
    if (ui.selectedMass) ui.selectedMass.textContent = body.type === 'CENTRAL STAR' ? '1.00 stellar unit' : `${(body.mass / 0.001).toFixed(2)} Earth units`;
    if (ui.selectedDistance) ui.selectedDistance.textContent = body.type === 'CENTRAL STAR' ? 'Reference body' : `${distance.toFixed(3)} scaled AU`;
    if (ui.selectedVelocity) ui.selectedVelocity.textContent = `${speed.toFixed(3)} normalized units`;
    if (ui.selectedPeriod) ui.selectedPeriod.textContent = period ? `${period.toFixed(2)} simulation units` : '—';
    if (ui.marker) {
      ui.marker.style.background = body.type === 'CENTRAL STAR'
        ? 'radial-gradient(circle at 35% 30%,#fff7c6 0,#f2c96e 22%,#df7d45 60%,#3e1835 100%)'
        : `radial-gradient(circle at 35% 30%,#ffffff 0,${body.color} 25%,#18263c 100%)`;
      ui.marker.style.boxShadow = `0 0 24px ${body.color}66`;
    }
  }

  function selectRelative(offset) {
    const current = Math.max(0, bodies.findIndex(body => body.id === selectedId));
    const next = (current + offset + bodies.length) % bodies.length;
    selectedId = bodies[next].id;
    updateInspector();
    announce(`${bodies[next].name} SELECTED`);
    needsDraw = true;
  }

  function pickBody(clientX, clientY) {
    const rect = canvas.getBoundingClientRect(); const sx = clientX - rect.left; const sy = clientY - rect.top;
    let winner = null; let bestDistance = 26;
    bodies.forEach(body => { const p = worldToScreen(body.x, body.y); const d = magnitude(p.x - sx, p.y - sy); if (d < bestDistance) { winner = body; bestDistance = d; } });
    if (winner) { selectedId = winner.id; updateInspector(); announce(`${winner.name} SELECTED`); needsDraw = true; }
  }

  function setZoom(nextZoom, anchorX = width / 2, anchorY = height / 2) {
    const before = screenToWorld(anchorX, anchorY);
    camera.zoom = clamp(nextZoom, 18, 420);
    const after = screenToWorld(anchorX, anchorY);
    camera.x += before.x - after.x; camera.y += before.y - after.y;
    updateTelemetry(true); needsDraw = true;
  }

  function togglePause(force) {
    paused = typeof force === 'boolean' ? force : !paused;
    const button = $('[data-cosmos-action="pause"]');
    if (button) { button.textContent = paused ? 'Resume' : 'Pause'; button.setAttribute('aria-pressed', String(paused)); }
    announce(paused ? 'SIMULATION PAUSED' : 'SIMULATION ONLINE');
    needsDraw = true; lastFrame = performance.now();
  }

  function setSpeed(value) {
    const index = SPEEDS.indexOf(Number(value));
    if (index >= 0) speedIndex = index;
    $$('[data-cosmos-speed]').forEach(button => {
      const active = Number(button.dataset.cosmosSpeed) === SPEEDS[speedIndex];
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateTelemetry(true); announce(`TIME SCALE ${direction < 0 ? 'REVERSE ' : ''}${SPEEDS[speedIndex]}X`);
  }

  function toggleResonance() {
    resonance = !resonance;
    const button = $('[data-cosmos-action="resonance"]');
    if (button) { button.classList.toggle('active', resonance); button.setAttribute('aria-pressed', String(resonance)); }
    if (ui.trails) ui.trails.checked = true;
    resetSystem(resonance);
  }

  function addBodyFromForm(event) {
    event?.preventDefault();
    if (bodies.length >= MAX_BODIES) { announce(`BODY LIMIT ${MAX_BODIES} REACHED`); return; }
    const name = ($('#cosmosBodyName')?.value || `Object ${bodies.length}`).trim().slice(0, 18) || `Object ${bodies.length}`;
    const massEarths = clamp(Number($('#cosmosBodyMass')?.value) || 1, 0.1, 50);
    const distance = clamp(Number($('#cosmosBodyDistance')?.value) || 2.8, 0.6, 8);
    const ratio = clamp(Number($('#cosmosBodySpeed')?.value) || 1, 0.3, 1.7);
    const angle = (bodies.length * 2.399963) % (Math.PI * 2);
    const body = circularBody(name, distance, massEarths, angle, palette[(bodies.length - 1) % palette.length], ratio);
    bodies.push(body); balanceMomentum(); computeAccelerations(); setBaselineDiagnostics(); selectedId = body.id; updateInspector(); updateTelemetry(true); announce(`${name} LAUNCHED`); needsDraw = true;
  }

  function handleAction(action) {
    if (action === 'pause') togglePause();
    else if (action === 'reverse') { direction *= -1; $('[data-cosmos-action="reverse"]')?.setAttribute('aria-pressed', String(direction < 0)); updateTelemetry(true); announce(direction < 0 ? 'TIME REVERSED' : 'TIME FORWARD'); }
    else if (action === 'slower') setSpeed(SPEEDS[Math.max(0, speedIndex - 1)]);
    else if (action === 'faster') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, speedIndex + 1)]);
    else if (action === 'step') { togglePause(true); integrate(FIXED_STEP * direction); updateInspector(); updateTelemetry(true); announce('ADVANCED ONE FIXED STEP'); needsDraw = true; }
    else if (action === 'previous-body') selectRelative(-1);
    else if (action === 'next-body') selectRelative(1);
    else if (action === 'resonance') toggleResonance();
    else if (action === 'reset-view') { camera = { x: 0, y: 0, zoom: 105 }; updateTelemetry(true); announce('VIEW CENTERED'); needsDraw = true; }
    else if (action === 'reset-system') resetSystem(resonance);
  }

  function resize() {
    const rect = viewport.getBoundingClientRect();
    width = Math.max(300, rect.width); height = Math.max(320, rect.height);
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); needsDraw = true;
  }

  $$('[data-cosmos-action]').forEach(button => {
    if (button.closest('form') && button.dataset.cosmosAction === 'add-body') return;
    button.addEventListener('click', () => handleAction(button.dataset.cosmosAction));
  });
  $$('[data-cosmos-speed]').forEach(button => button.addEventListener('click', () => setSpeed(button.dataset.cosmosSpeed)));
  [ui.gravity, ui.velocity, ui.trails].forEach(control => control?.addEventListener('change', () => { needsDraw = true; announce(`${control.parentElement?.innerText?.trim() || 'LAYER'} ${control.checked ? 'ON' : 'OFF'}`); }));
  ui.form?.addEventListener('submit', addBodyFromForm);

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    setZoom(camera.zoom * Math.exp(-event.deltaY * 0.0012), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) drag = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false };
    if (pointers.size === 2) { const pts = [...pointers.values()]; pinch = { distance: magnitude(pts[1].x - pts[0].x, pts[1].y - pts[0].y), zoom: camera.zoom }; }
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinch) {
      const pts = [...pointers.values()]; const distance = magnitude(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const rect = canvas.getBoundingClientRect(); const cx = (pts[0].x + pts[1].x) / 2 - rect.left; const cy = (pts[0].y + pts[1].y) / 2 - rect.top;
      setZoom(pinch.zoom * distance / Math.max(1, pinch.distance), cx, cy);
    } else if (drag) {
      const dx = event.clientX - drag.x; const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      camera.x = drag.cameraX - dx / camera.zoom; camera.y = drag.cameraY - dy / camera.zoom; needsDraw = true; updateTelemetry();
    }
  });
  function releasePointer(event) {
    const wasClick = drag && !drag.moved && pointers.size === 1;
    pointers.delete(event.pointerId);
    if (wasClick) pickBody(event.clientX, event.clientY);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
  }
  canvas.addEventListener('pointerup', releasePointer); canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select')) return;
    const key = event.key.toLowerCase();
    if (event.code === 'Space') { event.preventDefault(); togglePause(); }
    else if (key === '+' || key === '=') { event.preventDefault(); setZoom(camera.zoom * 1.18); }
    else if (key === '-') { event.preventDefault(); setZoom(camera.zoom / 1.18); }
    else if (key === 'v' && ui.velocity) { ui.velocity.checked = !ui.velocity.checked; ui.velocity.dispatchEvent(new Event('change')); }
    else if (key === 'g' && ui.gravity) { ui.gravity.checked = !ui.gravity.checked; ui.gravity.dispatchEvent(new Event('change')); }
    else if (key === 't' && ui.trails) { ui.trails.checked = !ui.trails.checked; ui.trails.dispatchEvent(new Event('change')); }
    else if (key === '[') selectRelative(-1);
    else if (key === ']') selectRelative(1);
    else if (key === 'r') handleAction('reset-view');
    else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(key)) {
      event.preventDefault(); const step = 35 / camera.zoom;
      if (key === 'arrowleft' || key === 'a') camera.x -= step;
      if (key === 'arrowright' || key === 'd') camera.x += step;
      if (key === 'arrowup' || key === 'w') camera.y -= step;
      if (key === 'arrowdown' || key === 's') camera.y += step;
      needsDraw = true;
    }
  });

  new ResizeObserver(resize).observe(viewport);
  new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) { lastFrame = performance.now(); needsDraw = true; }
  }, { threshold: 0.02 }).observe(viewport);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !paused) togglePause(true); lastFrame = performance.now(); });

  function frame(now) {
    const realDt = Math.min((now - lastFrame) / 1000, 0.08); lastFrame = now;
    if (!paused && visible) {
      accumulator += realDt * BASE_RATE * SPEEDS[speedIndex];
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 48) { integrate(FIXED_STEP * direction); accumulator -= FIXED_STEP; steps += 1; }
      if (steps === 48) accumulator = 0;
      updateInspector(); updateTelemetry(); needsDraw = true;
    }
    if (visible && needsDraw) draw();
    requestAnimationFrame(frame);
  }

  resize();
  resetSystem(false);
  togglePause(paused);
  requestAnimationFrame(frame);
})();
