import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(() => {
  'use strict';

  const canvas = document.getElementById('observatoryCanvas');
  const viewport = document.getElementById('observatoryViewport');
  if (!canvas || !viewport) return;

  const DATA = window.COSMOS_REAL_DATA;
  const AU_KM = 149597870.7;
  const DAY_MS = 86400000;
  const GAUSSIAN_G2 = 0.0002959122082855911; // AU^3 / (solar mass * day^2)
  const TAU = Math.PI * 2;
  const DPR_CAP = 2;
  const MAX_TRAIL_POINTS = 420;
  const SPEEDS = [0.25, 1, 4, 16, 64];
  const els = {};
  [
    'obsStatus', 'obsDate', 'obsEpoch', 'obsFrame', 'obsScaleMode', 'obsFps',
    'obsSystemSelect', 'obsDateSlider', 'obsOrbitsToggle', 'obsLabelsToggle',
    'obsVectorsToggle', 'obsTrailsToggle', 'obsFabricToggle', 'obsCompareToggle',
    'obsScaleToggle', 'obsBodyList', 'obsSelectedName', 'obsSelectedType',
    'obsSelectedDistance', 'obsSelectedVelocity', 'obsSelectedResidual',
    'obsSelectedSource', 'obsLegend', 'obsFallback', 'obsTour', 'obsTourKicker', 'obsTourTitle',
    'obsTourCopy', 'timelineDate', 'obsDomSummary'
  ].forEach(id => { els[id] = document.getElementById(id); });

  function fail(title, detail) {
    const panel = document.createElement('div');
    panel.className = 'observatory-failure';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:absolute;inset:0;display:grid;place-content:center;gap:.65rem;padding:2rem;text-align:center;background:#050914;color:#eef5ff;z-index:20';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const copy = document.createElement('span');
    copy.textContent = detail;
    panel.append(heading, copy);
    viewport.append(panel);
    if (els.obsStatus) els.obsStatus.textContent = 'UNAVAILABLE';
  }

  if (!DATA || !DATA.systems) {
    fail('The observatory data did not load.', 'The interactive view needs its local astronomy dataset. Reload the page or use the technical notes below.');
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    fail('WebGL is unavailable.', 'This device cannot start the 3D renderer. The surrounding case study remains available.');
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040b);
  scene.fog = new THREE.FogExp2(0x02040b, 0.0007);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.005, 16000);
  camera.position.set(24, 17, 34);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 0.12;
  controls.maxDistance = 1200;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);
  canvas.style.touchAction = 'none';

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene.add(new THREE.HemisphereLight(0x7397c8, 0x080a13, 0.24));
  const keyLight = new THREE.PointLight(0xfff1cf, 4, 0, 0.7);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const clock = new THREE.Clock();
  const root = new THREE.Group();
  root.name = 'active-system';
  scene.add(root);

  const state = {
    systemKey: '',
    system: null,
    bodies: [],
    bodyViews: new Map(),
    selectedId: null,
    currentMs: 0,
    minMs: 0,
    maxMs: 0,
    playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    direction: 1,
    speedIndex: 2,
    offscreen: false,
    hidden: document.hidden,
    scaleMode: 'exploration',
    positionScale: 1,
    sourceMaxDistance: 1,
    actualFrame: new Map(),
    modelFrame: new Map(),
    modelSeries: new Map(),
    trails: new Map(),
    trailTimer: 0,
    focus: null,
    tourIndex: -1,
    audio: null,
    audioEnabled: false,
    fps: 60,
    fpsSamples: [],
    lowFpsSeconds: 0,
    dprLimit: DPR_CAP,
    lastTelemetry: 0,
    lastFabricUpdate: 0,
    tourReturnFocus: null
  };

  const toggles = {
    orbits: readToggle(els.obsOrbitsToggle, true),
    labels: readToggle(els.obsLabelsToggle, true),
    vectors: readToggle(els.obsVectorsToggle, false),
    trails: readToggle(els.obsTrailsToggle, false),
    fabric: readToggle(els.obsFabricToggle, false),
    compare: readToggle(els.obsCompareToggle, false)
  };

  const labelLayer = document.createElement('div');
  labelLayer.className = 'observatory-label-layer';
  labelLayer.setAttribute('aria-hidden', 'true');
  labelLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:4';
  viewport.append(labelLayer);

  const orbitGroup = new THREE.Group();
  const trailGroup = new THREE.Group();
  const vectorGroup = new THREE.Group();
  const ghostGroup = new THREE.Group();
  root.add(orbitGroup, trailGroup, vectorGroup, ghostGroup);

  const fabric = createFabric();
  root.add(fabric);
  fabric.visible = toggles.fabric;
  const stars = createStarfield(7000);
  scene.add(stars);

  function readToggle(element, fallback) {
    return element ? Boolean(element.checked) : fallback;
  }

  function setStatus(text) {
    if (els.obsStatus && els.obsStatus.textContent !== text) els.obsStatus.textContent = text;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function parseDatasetDate(value) {
    if (typeof value !== 'string') return NaN;
    // Horizons calendar strings intentionally omit a timezone because their
    // time scale is TDB. A UTC suffix keeps the displayed calendar day stable
    // across visitor timezones without claiming the value itself is UTC.
    const normalized = /(?:Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value}Z`;
    return Date.parse(normalized);
  }

  function seeded(index, salt = 0) {
    let x = Math.imul((index + 1) ^ (salt + 101), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  function colorOf(body, index = 0) {
    if (body && body.color) {
      try { return new THREE.Color(body.color); } catch (_) { /* use palette */ }
    }
    const palette = [0x77aaff, 0xf3b879, 0x76dac9, 0xc6a3ff, 0xe58c77, 0xa8c47a, 0xb8c8e6];
    return new THREE.Color(palette[index % palette.length]);
  }

  function vectorFrom(value) {
    if (Array.isArray(value)) return [finite(value[0]), finite(value[1]), finite(value[2])];
    if (value && typeof value === 'object') return [finite(value.x), finite(value.y), finite(value.z)];
    return [0, 0, 0];
  }

  function toScenePosition(p) {
    return new THREE.Vector3(p[0] * state.positionScale, p[2] * state.positionScale, p[1] * state.positionScale);
  }

  function sourcePosition(v) {
    return [v.x / state.positionScale, v.z / state.positionScale, v.y / state.positionScale];
  }

  function systemsEntries() {
    return Object.entries(DATA.systems || {}).filter(([, system]) => system && (system.bodies || system.star));
  }

  function normalizeSystem(key, input) {
    const solar = input.type === 'ephemeris' || Array.isArray(input.dates);
    const center = input.center || (input.star && input.star.id) || (input.bodies && input.bodies[0] && input.bodies[0].id) || '';
    let bodies = Array.isArray(input.bodies) ? input.bodies.map(body => ({ ...body })) : [];
    if (input.star && !bodies.some(body => body.id === input.star.id)) bodies.unshift({ ...input.star, type: input.star.type || 'star' });
    bodies = bodies.map((body, index) => ({
      ...body,
      id: String(body.id || body.name || `body-${index}`).toLowerCase().replace(/\s+/g, '-'),
      name: body.name || body.id || `Body ${index + 1}`,
      type: body.type || (index === 0 ? 'star' : 'planet'),
      frames: Array.isArray(body.frames) ? body.frames : []
    }));
    const dates = solar && Array.isArray(input.dates) ? input.dates.map(parseDatasetDate).filter(Number.isFinite) : [];
    const epochSource = typeof input.epoch === 'string'
      ? input.epoch
      : input.epoch?.start || (input.dates && input.dates[0]) || DATA.meta?.generatedAt || new Date().toISOString();
    const epoch = parseDatasetDate(epochSource);
    return {
      ...input,
      key,
      id: input.id || key,
      name: input.name || key,
      kind: solar ? 'ephemeris' : 'catalog-keplerian',
      center: String(center).toLowerCase().replace(/\s+/g, '-'),
      bodies,
      dates,
      epochMs: Number.isFinite(epoch) ? epoch : Date.now()
    };
  }

  function systemMaxDistance(system) {
    let max = 0;
    if (system.kind === 'ephemeris') {
      system.bodies.forEach(body => body.frames.forEach(frame => {
        const p = vectorFrom(frame.p || frame.position);
        max = Math.max(max, Math.hypot(...p));
      }));
    } else {
      system.bodies.forEach(body => { max = Math.max(max, finite(body.semimajorAxisAU)); });
    }
    return max || 1;
  }

  function disposeObject(rootObject) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    rootObject.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = object.material
        ? (Array.isArray(object.material) ? object.material : [object.material])
        : [];
      objectMaterials.forEach(material => {
        materials.add(material);
        if (material.map) textures.add(material.map);
      });
    });
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
  }

  function clearGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  function clearSystem() {
    [...state.bodyViews.values()].forEach(view => {
      view.group.removeFromParent();
      disposeObject(view.group);
      view.label.remove();
    });
    state.bodyViews.clear();
    state.trails.clear();
    state.actualFrame.clear();
    state.modelFrame.clear();
    state.modelSeries.clear();
    clearGroup(orbitGroup);
    clearGroup(trailGroup);
    clearGroup(vectorGroup);
    clearGroup(ghostGroup);
    state.focus = null;
  }

  function makeTexture(body, index) {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 256;
    textureCanvas.height = 128;
    const context = textureCanvas.getContext('2d');
    const base = colorOf(body, index);
    context.fillStyle = `#${base.getHexString()}`;
    context.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 128; y += 3) {
      const wave = Math.sin(y * 0.17 + seeded(index, y) * TAU);
      const light = Math.round((wave * 0.5 + seeded(y, index) - 0.5) * 22);
      context.fillStyle = `rgba(${light > 0 ? 255 : 0},${light > 0 ? 255 : 0},${light > 0 ? 255 : 0},${Math.abs(light) / 90})`;
      context.fillRect(0, y, 256, 3);
    }
    for (let i = 0; i < 35; i += 1) {
      const x = seeded(i, index * 7) * 256;
      const y = seeded(i, index * 11 + 3) * 128;
      const r = 1 + seeded(i, 31 + index) * 9;
      context.fillStyle = `rgba(255,255,255,${0.015 + seeded(i, 71) * 0.05})`;
      context.beginPath();
      context.ellipse(x, y, r * 1.8, r, 0, 0, TAU);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function makeGlowTexture() {
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const context = glowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,247,210,1)');
    gradient.addColorStop(0.16, 'rgba(255,197,93,.8)');
    gradient.addColorStop(0.48, 'rgba(255,122,48,.18)');
    gradient.addColorStop(1, 'rgba(255,90,20,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(glowCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function physicalRadiusKm(body) {
    if (finite(body.radiusKm) > 0) return finite(body.radiusKm);
    if (finite(body.radiusEarth) > 0) return finite(body.radiusEarth) * 6371;
    if (finite(body.radiusSolar) > 0) return finite(body.radiusSolar) * 695700;
    return 0;
  }

  function explorationRadius(body, index) {
    const isStar = body.type === 'star' || body.id === state.system.center;
    const compactSystem = state.sourceMaxDistance < 1;
    if (isStar) return compactSystem ? 0.46 : 0.16;
    const km = Math.max(1, physicalRadiusKm(body));
    const sizeRatio = clamp((Math.log10(km) - 3.45) / 1.55, 0, 1);
    const minRadius = compactSystem ? 0.12 : 0.055;
    const maxRadius = compactSystem ? 0.24 : 0.14;
    return THREE.MathUtils.lerp(minRadius, maxRadius, sizeRatio) * (0.96 + seeded(index, 4) * 0.08);
  }

  function trueRadius(body) {
    const km = physicalRadiusKm(body);
    return Math.max(0.012, (km / AU_KM) * state.positionScale);
  }

  function createBodyView(body, index) {
    const group = new THREE.Group();
    group.userData.bodyId = body.id;
    const isStar = body.type === 'star' || body.id === state.system.center;
    const geometry = new THREE.SphereGeometry(1, isStar ? 48 : 36, isStar ? 32 : 24);
    const color = colorOf(body, index);
    const material = isStar
      ? new THREE.MeshBasicMaterial({ color, map: makeTexture(body, index) })
      : new THREE.MeshStandardMaterial({ color, map: makeTexture(body, index), roughness: 0.78, metalness: 0.02 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.bodyId = body.id;
    group.add(mesh);

    if (isStar) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(7.5);
      glow.userData.bodyId = body.id;
      group.add(glow);
    }
    if (body.atmosphere) {
      const atmosphere = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
        color: color.clone().lerp(new THREE.Color(0x9adfff), 0.6), transparent: true, opacity: 0.12,
        roughness: 0.4, transmission: 0.08, side: THREE.BackSide, depthWrite: false
      }));
      atmosphere.scale.setScalar(1.09);
      group.add(atmosphere);
    }
    if (body.rings) {
      const ringData = typeof body.rings === 'object' ? body.rings : {};
      const inner = finite(ringData.innerRatio, 1.45);
      const outer = finite(ringData.outerRatio, 2.4);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 96),
        new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xd8c7a4), 0.65), transparent: true, opacity: 0.56, roughness: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2.35;
      ring.userData.bodyId = body.id;
      group.add(ring);
    }
    const label = document.createElement('span');
    label.className = 'observatory-body-label';
    label.textContent = body.name;
    label.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-150%);font:500 10px/1.2 monospace;letter-spacing:.08em;color:#dceaff;text-shadow:0 1px 5px #000;white-space:nowrap';
    labelLayer.append(label);
    root.add(group);
    return { body, group, mesh, label, baseRadius: explorationRadius(body, index), isStar };
  }

  function createStarfield(count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const radius = 500 + seeded(i, 1) * 6500;
      const z = seeded(i, 2) * 2 - 1;
      const theta = seeded(i, 3) * TAU;
      const radial = Math.sqrt(1 - z * z);
      positions[i * 3] = Math.cos(theta) * radial * radius;
      positions[i * 3 + 1] = z * radius;
      positions[i * 3 + 2] = Math.sin(theta) * radial * radius;
      const warmth = seeded(i, 5);
      colors[i * 3] = 0.68 + warmth * 0.32;
      colors[i * 3 + 1] = 0.72 + (1 - Math.abs(warmth - 0.5) * 2) * 0.25;
      colors[i * 3 + 2] = 0.82 + (1 - warmth) * 0.18;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 1.45, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.name = 'procedural-starfield';
    return points;
  }

  function createFabric() {
    const geometry = new THREE.PlaneGeometry(88, 88, 64, 64);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x327da6, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'interpretive-gravity-fabric';
    mesh.position.y = -2.7;
    mesh.frustumCulled = false;
    return mesh;
  }

  function updateFabric(force = false) {
    if (!fabric.visible) return;
    const now = performance.now();
    if (!force && now - state.lastFabricUpdate < 120) return;
    state.lastFabricUpdate = now;
    const attribute = fabric.geometry.attributes.position;
    for (let i = 0; i < attribute.count; i += 1) {
      const x = attribute.getX(i);
      const z = attribute.getZ(i);
      let depression = 0;
      state.bodies.forEach(body => {
        const view = state.bodyViews.get(body.id);
        if (!view) return;
        const dx = x - view.group.position.x;
        const dz = z - view.group.position.z;
        const weight = view.isStar ? 8 : clamp(finite(body.massSolar, finite(body.massEarth) / 332946) * 12000, 0.08, 1.8);
        depression -= weight / Math.sqrt(dx * dx + dz * dz + 2.5);
      });
      attribute.setY(i, depression);
    }
    attribute.needsUpdate = true;
  }

  function stateAtEphemeris(system, timeMs) {
    const result = new Map();
    const dates = system.dates;
    if (!dates.length) return result;
    let hi = dates.findIndex(date => date >= timeMs);
    if (hi < 0) hi = dates.length - 1;
    const lo = Math.max(0, hi - 1);
    const span = Math.max(1, dates[hi] - dates[lo]);
    const alpha = hi === lo ? 0 : clamp((timeMs - dates[lo]) / span, 0, 1);
    system.bodies.forEach(body => {
      const a = body.frames[Math.min(lo, body.frames.length - 1)] || body.frames[0];
      const b = body.frames[Math.min(hi, body.frames.length - 1)] || a;
      if (!a) return;
      const pa = vectorFrom(a.p || a.position);
      const pb = vectorFrom(b.p || b.position);
      const va = vectorFrom(a.v || a.velocity);
      const vb = vectorFrom(b.v || b.velocity);
      result.set(body.id, {
        p: pa.map((value, index) => THREE.MathUtils.lerp(value, pb[index], alpha)),
        v: va.map((value, index) => THREE.MathUtils.lerp(value, vb[index], alpha)),
        lo, hi, alpha
      });
    });
    return result;
  }

  function solveEccentricAnomaly(mean, eccentricity) {
    let anomaly = mean;
    for (let i = 0; i < 7; i += 1) anomaly -= (anomaly - eccentricity * Math.sin(anomaly) - mean) / Math.max(0.01, 1 - eccentricity * Math.cos(anomaly));
    return anomaly;
  }

  function catalogBodyState(body, timeMs) {
    if (body.type === 'star' || !finite(body.semimajorAxisAU)) return { p: [0, 0, 0], v: [0, 0, 0] };
    const a = Math.max(1e-7, finite(body.semimajorAxisAU));
    const period = Math.max(1e-5, finite(body.periodDays, 1));
    const eccentricity = clamp(finite(body.eccentricity), 0, 0.8);
    // The bundled catalog defines phase in radians and marks it as a curated
    // display value, not an observed orbital phase.
    const phase = finite(body.phase);
    const elapsedDays = (timeMs - state.system.epochMs) / DAY_MS;
    const mean = phase + elapsedDays / period * TAU;
    const eccentricAnomaly = solveEccentricAnomaly(mean, eccentricity);
    const x = a * (Math.cos(eccentricAnomaly) - eccentricity);
    const y = a * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly);
    const dEdt = TAU / period / Math.max(0.01, 1 - eccentricity * Math.cos(eccentricAnomaly));
    const vx = -a * Math.sin(eccentricAnomaly) * dEdt;
    const vy = a * Math.sqrt(1 - eccentricity * eccentricity) * Math.cos(eccentricAnomaly) * dEdt;
    const inclination = finite(body.inclinationDeg) * Math.PI / 180;
    return { p: [x, y * Math.cos(inclination), y * Math.sin(inclination)], v: [vx, vy * Math.cos(inclination), vy * Math.sin(inclination)] };
  }

  function stateAtCatalog(system, timeMs) {
    const result = new Map();
    system.bodies.forEach(body => result.set(body.id, catalogBodyState(body, timeMs)));
    return result;
  }

  function interpolateModel(bodyId, timeMs) {
    const series = state.modelSeries.get(bodyId);
    if (!series || !series.length) return null;
    let hi = series.findIndex(item => item.time >= timeMs);
    if (hi < 0) hi = series.length - 1;
    const lo = Math.max(0, hi - 1);
    const span = Math.max(1, series[hi].time - series[lo].time);
    const alpha = hi === lo ? 0 : clamp((timeMs - series[lo].time) / span, 0, 1);
    return {
      p: series[lo].p.map((value, index) => THREE.MathUtils.lerp(value, series[hi].p[index], alpha)),
      v: series[lo].v.map((value, index) => THREE.MathUtils.lerp(value, series[hi].v[index], alpha))
    };
  }

  function generateTwoBodyModels(system) {
    state.modelSeries.clear();
    if (system.kind !== 'ephemeris' || !system.dates.length) return;
    const centerBody = system.bodies.find(body => body.id === system.center) || system.bodies[0];
    if (!centerBody || !centerBody.frames[0]) return;
    const centerP = vectorFrom(centerBody.frames[0].p);
    const centerV = vectorFrom(centerBody.frames[0].v);
    const centerMass = finite(centerBody.massSolar, 1);
    system.bodies.forEach(body => {
      if (!body.frames[0]) return;
      if (body.id === centerBody.id) {
        // In the deliberately simple two-body comparison, the central body is
        // an inertial anchor. Do not copy its reference frames into the model:
        // that would manufacture a misleading zero residual for the star.
        state.modelSeries.set(body.id, system.dates.map(time => {
          const elapsed = (time - system.dates[0]) / DAY_MS;
          return {
            time,
            p: centerP.map((component, componentIndex) => component + centerV[componentIndex] * elapsed),
            v: [...centerV]
          };
        }));
        return;
      }
      const initialP = vectorFrom(body.frames[0].p);
      const initialV = vectorFrom(body.frames[0].v);
      let r = initialP.map((value, index) => value - centerP[index]);
      let v = initialV.map((value, index) => value - centerV[index]);
      let previousTime = system.dates[0];
      const mu = GAUSSIAN_G2 * (centerMass + finite(body.massSolar));
      const series = [];
      system.dates.forEach(targetTime => {
        let remaining = (targetTime - previousTime) / DAY_MS;
        while (Math.abs(remaining) > 1e-9) {
          const h = Math.sign(remaining) * Math.min(0.5, Math.abs(remaining));
          const rMag = Math.max(1e-8, Math.hypot(...r));
          const a = r.map(component => -mu * component / (rMag ** 3));
          v = v.map((component, index) => component + a[index] * h * 0.5);
          r = r.map((component, index) => component + v[index] * h);
          const nextMag = Math.max(1e-8, Math.hypot(...r));
          const nextA = r.map(component => -mu * component / (nextMag ** 3));
          v = v.map((component, index) => component + nextA[index] * h * 0.5);
          remaining -= h;
        }
        const elapsed = (targetTime - system.dates[0]) / DAY_MS;
        series.push({
          time: targetTime,
          p: r.map((component, index) => component + centerP[index] + centerV[index] * elapsed),
          v: v.map((component, index) => component + centerV[index])
        });
        previousTime = targetTime;
      });
      state.modelSeries.set(body.id, series);
    });
  }

  function rebuildOrbits() {
    clearGroup(orbitGroup);
    const center = state.bodies.find(body => body.id === state.system.center) || state.bodies[0];
    state.bodies.forEach((body, index) => {
      if (body.id === center?.id) return;
      const points = [];
      if (state.system.kind === 'ephemeris' && body.frames.length > 1) {
        body.frames.forEach(frame => points.push(toScenePosition(vectorFrom(frame.p || frame.position))));
      } else if (finite(body.semimajorAxisAU)) {
        for (let i = 0; i <= 180; i += 1) {
          const saved = state.currentMs;
          const sample = state.system.epochMs + finite(body.periodDays, 1) * DAY_MS * i / 180;
          points.push(toScenePosition(catalogBodyState(body, sample).p));
          state.currentMs = saved;
        }
      }
      if (points.length < 2) return;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: colorOf(body, index), transparent: true, opacity: 0.28, depthWrite: false });
      const line = new THREE.Line(points.length > 2 ? geometry : geometry, material);
      line.userData.bodyId = body.id;
      orbitGroup.add(line);
    });
    orbitGroup.visible = toggles.orbits;
  }

  function buildBodyList() {
    if (!els.obsBodyList) return;
    els.obsBodyList.replaceChildren();
    state.bodies.forEach(body => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.bodyId = body.id;
      button.textContent = body.name;
      button.addEventListener('click', () => selectBody(body.id, true));
      item.append(button);
      els.obsBodyList.append(item);
    });
  }

  function applyScaleMode() {
    state.bodyViews.forEach(view => {
      const radius = state.scaleMode === 'relative' ? trueRadius(view.body) : view.baseRadius;
      view.group.scale.setScalar(radius);
    });
    if (els.obsScaleMode) els.obsScaleMode.textContent = state.scaleMode === 'relative' ? 'RELATIVE RADII' : 'EXPLORATION';
    if (els.obsScaleToggle) els.obsScaleToggle.checked = state.scaleMode === 'relative';
  }

  function chooseSystem(key) {
    const entry = systemsEntries().find(([entryKey, system]) => entryKey === key || system.id === key) || systemsEntries()[0];
    if (!entry) {
      fail('No usable systems were found.', 'The local dataset exists, but it contains no body records.');
      return;
    }
    clearSystem();
    state.systemKey = entry[0];
    state.system = normalizeSystem(entry[0], entry[1]);
    state.bodies = state.system.bodies;
    state.sourceMaxDistance = systemMaxDistance(state.system);
    state.positionScale = 34 / state.sourceMaxDistance;
    if (state.system.kind === 'ephemeris' && state.system.dates.length) {
      state.minMs = state.system.dates[0];
      state.maxMs = state.system.dates[state.system.dates.length - 1];
    } else {
      state.minMs = state.system.epochMs;
      state.maxMs = state.system.epochMs + 365 * DAY_MS;
    }
    state.currentMs = state.system.kind === 'ephemeris'
      ? clamp(Date.now(), state.minMs, state.maxMs)
      : state.minMs;
    state.bodies.forEach((body, index) => state.bodyViews.set(body.id, createBodyView(body, index)));
    generateTwoBodyModels(state.system);
    rebuildOrbits();
    buildBodyList();
    applyScaleMode();
    resetTrails();
    updateBodies(true);
    selectBody(state.system.center || state.bodies[0]?.id, false);
    resetCamera();
    if (els.obsSystemSelect) els.obsSystemSelect.value = state.systemKey;
    if (els.obsEpoch) {
      const epochLabel = typeof state.system.epoch === 'string'
        ? state.system.epoch
        : state.system.epoch?.start;
      els.obsEpoch.textContent = epochLabel || (state.system.kind === 'ephemeris'
        ? new Date(state.minMs).toISOString().slice(0, 10)
        : 'DISPLAY PHASE / UNOBSERVED');
    }
    if (els.obsFrame) {
      const frameParts = [state.system.referenceFrame, state.system.referencePlane].filter(Boolean);
      els.obsFrame.textContent = frameParts.length
        ? frameParts.join(' / ')
        : (state.system.kind === 'ephemeris' ? 'ICRF / ECLIPTIC' : 'IDEALIZED ORBITAL PLANE');
    }
    const stageTitle = document.getElementById('observatory-title');
    const stageEyebrow = viewport.querySelector('.stage-title .eyebrow');
    const stageCopy = viewport.querySelector('.stage-title > p');
    const catalogCount = viewport.querySelector('.body-browser .panel-head b');
    if (stageTitle) stageTitle.innerHTML = state.system.kind === 'ephemeris'
      ? 'The solar system,<br><span>held in motion.</span>'
      : 'TRAPPIST-1,<br><span>held in motion.</span>';
    if (stageEyebrow) stageEyebrow.textContent = state.system.kind === 'ephemeris'
      ? 'JPL reference states · Local propagation · 3D WebGL'
      : 'NASA Exoplanet Archive · Idealized catalog motion · 3D WebGL';
    if (stageCopy) stageCopy.textContent = state.system.kind === 'ephemeris'
      ? 'Explore the unknown through a model you can question: move through three dimensions, compare reference and propagated states, and make the structure of an orbit visible.'
      : 'Explore a compact exoplanet system through catalog periods and distances. Its orbital phases are curated for display—not observed ephemeris states.';
    if (catalogCount) catalogCount.textContent = String(state.bodies.length).padStart(2, '0');
    document.querySelectorAll('[data-obs-action="reset-time"]').forEach(button => {
      button.textContent = state.system.kind === 'ephemeris' ? 'Return to today' : 'Return to display origin';
    });
    if (els.timelineDate) {
      els.timelineDate.textContent = state.system.kind === 'ephemeris'
        ? 'JPL states / 10-day samples / linear interpolation'
        : 'Catalog periods / idealized Kepler motion';
    }
    const timelineBounds = viewport.querySelectorAll('.timeline-bounds span');
    if (timelineBounds.length >= 2) {
      timelineBounds[0].textContent = state.system.kind === 'ephemeris'
        ? new Date(state.minMs).toISOString().slice(0, 10)
        : 'DISPLAY DAY 0';
      timelineBounds[timelineBounds.length - 1].textContent = state.system.kind === 'ephemeris'
        ? new Date(state.maxMs).toISOString().slice(0, 10)
        : 'DISPLAY DAY 365';
    }
    populateLegend();
    updateControlAvailability();
    if (els.obsFallback) els.obsFallback.hidden = true;
    updateDomSummary();
    updateReadouts();
  }

  function populateSystemSelect() {
    if (!els.obsSystemSelect) return;
    els.obsSystemSelect.replaceChildren();
    systemsEntries().forEach(([key, value]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = value.name || key;
      els.obsSystemSelect.append(option);
    });
  }

  function populateLegend() {
    if (!els.obsLegend) return;
    els.obsLegend.replaceChildren();
    const entries = state.system.kind === 'ephemeris'
      ? [
          ['reference', 'Reference state'],
          ['propagated', 'Local two-body model'],
          ['residual', 'Residual metric']
        ]
      : [
          ['reference', 'Catalog parameters'],
          ['propagated', 'Idealized Kepler orbit']
        ];
    entries.forEach(([className, label]) => {
      const item = document.createElement('span');
      const marker = document.createElement('i');
      marker.className = className;
      item.append(marker, document.createTextNode(label));
      els.obsLegend.append(item);
    });
  }

  function updateControlAvailability() {
    if (els.obsCompareToggle) {
      const supported = state.system.kind === 'ephemeris' && state.modelSeries.size > 0;
      els.obsCompareToggle.disabled = !supported;
      if (!supported) { els.obsCompareToggle.checked = false; toggles.compare = false; }
    }
  }

  function updateBodies(force = false) {
    state.actualFrame = state.system.kind === 'ephemeris'
      ? stateAtEphemeris(state.system, state.currentMs)
      : stateAtCatalog(state.system, state.currentMs);
    state.modelFrame.clear();
    state.bodies.forEach((body, index) => {
      const value = state.actualFrame.get(body.id);
      const view = state.bodyViews.get(body.id);
      if (!value || !view) return;
      const position = toScenePosition(value.p);
      view.group.position.copy(position);
      view.mesh.rotation.y += force ? 0 : 0.0015 * (1 + index * 0.13);
      if (state.system.kind === 'ephemeris') {
        const model = interpolateModel(body.id, state.currentMs);
        if (model) state.modelFrame.set(body.id, model);
      }
    });
    const centerView = state.bodyViews.get(state.system.center) || state.bodyViews.values().next().value;
    if (centerView) keyLight.position.copy(centerView.group.position);
    updateVectors();
    updateGhosts();
    updateFabric(force);
  }

  function updateVectors() {
    vectorGroup.visible = toggles.vectors;
    if (!toggles.vectors) return;
    state.bodies.forEach((body, index) => {
      const value = state.actualFrame.get(body.id);
      const view = state.bodyViews.get(body.id);
      if (!value || !view) return;
      const sourceVelocity = vectorFrom(value.v);
      const direction = new THREE.Vector3(sourceVelocity[0], sourceVelocity[2], sourceVelocity[1]);
      const magnitude = direction.length();
      let arrow = vectorGroup.getObjectByName(`velocity-${body.id}`);
      if (!magnitude) {
        if (arrow) arrow.visible = false;
        return;
      }
      direction.normalize();
      const length = clamp(magnitude * state.positionScale * 22, 0.7, 7);
      if (!arrow) {
        arrow = new THREE.ArrowHelper(direction, view.group.position, length, colorOf(body, index), 0.28, 0.13);
        arrow.name = `velocity-${body.id}`;
        vectorGroup.add(arrow);
      } else {
        arrow.position.copy(view.group.position);
        arrow.setDirection(direction);
        arrow.setLength(length, 0.28, 0.13);
        arrow.setColor(colorOf(body, index));
        arrow.visible = true;
      }
    });
  }

  function updateGhosts() {
    ghostGroup.visible = toggles.compare && state.system.kind === 'ephemeris';
    if (!ghostGroup.visible) return;
    state.bodies.forEach((body, index) => {
      const model = state.modelFrame.get(body.id);
      if (!model || body.id === state.system.center) return;
      let ghost = ghostGroup.getObjectByName(`ghost-${body.id}`);
      if (!ghost) {
        const geometry = new THREE.SphereGeometry(0.16, 12, 8);
        const material = new THREE.MeshBasicMaterial({ color: colorOf(body, index), wireframe: true, transparent: true, opacity: 0.68 });
        ghost = new THREE.Mesh(geometry, material);
        ghost.name = `ghost-${body.id}`;
        ghost.userData.bodyId = body.id;
        ghostGroup.add(ghost);
      }
      ghost.position.copy(toScenePosition(model.p));
    });
  }

  function resetTrails() {
    clearGroup(trailGroup);
    state.trails.clear();
    state.trailTimer = 0;
    state.bodies.forEach(body => state.trails.set(body.id, []));
  }

  function sampleTrails() {
    if (!toggles.trails) return;
    state.bodies.forEach((body, index) => {
      const view = state.bodyViews.get(body.id);
      if (!view) return;
      const points = state.trails.get(body.id) || [];
      points.push(view.group.position.clone());
      if (points.length > MAX_TRAIL_POINTS) points.splice(0, points.length - MAX_TRAIL_POINTS);
      state.trails.set(body.id, points);
      let line = trailGroup.getObjectByName(`trail-${body.id}`);
      if (!line) {
        const positions = new Float32Array(MAX_TRAIL_POINTS * 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 0);
        line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({ color: colorOf(body, index), transparent: true, opacity: 0.5, depthWrite: false })
        );
        line.name = `trail-${body.id}`;
        trailGroup.add(line);
      }
      const positionAttribute = line.geometry.attributes.position;
      points.forEach((point, pointIndex) => positionAttribute.setXYZ(pointIndex, point.x, point.y, point.z));
      positionAttribute.needsUpdate = true;
      line.geometry.setDrawRange(0, points.length);
    });
  }

  function selectBody(id, focus = true) {
    if (!state.bodyViews.has(id)) return;
    state.selectedId = id;
    state.bodyViews.forEach((view, bodyId) => {
      const selected = bodyId === id;
      view.mesh.material.emissive?.set(selected ? colorOf(view.body) : 0x000000);
      if (view.mesh.material.emissiveIntensity !== undefined) view.mesh.material.emissiveIntensity = selected ? 0.22 : 0;
      view.label.classList.toggle('selected', selected);
    });
    if (els.obsBodyList) els.obsBodyList.querySelectorAll('[data-body-id]').forEach(button => {
      const selected = button.dataset.bodyId === id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateInspector();
    updateDomSummary();
    updateAudio();
    if (focus) focusSelected();
  }

  function focusSelected() {
    const view = state.bodyViews.get(state.selectedId);
    if (!view) return;
    const target = view.group.position.clone();
    const direction = camera.position.clone().sub(controls.target).normalize();
    const visibleRadius = state.scaleMode === 'relative' ? trueRadius(view.body) : view.baseRadius;
    const compactSystem = state.sourceMaxDistance < 1;
    const distance = clamp(visibleRadius * 12, compactSystem ? 1.35 : 0.72, compactSystem ? 5.5 : 2.4);
    state.focus = { target, camera: target.clone().add(direction.multiplyScalar(distance)), progress: 0 };
  }

  function updateFocus(dt) {
    if (!state.focus) return;
    state.focus.progress += dt * 2.6;
    const amount = 1 - Math.exp(-dt * 6);
    controls.target.lerp(state.focus.target, amount);
    camera.position.lerp(state.focus.camera, amount);
    if (state.focus.progress > 2.2 || (controls.target.distanceTo(state.focus.target) < 0.01 && camera.position.distanceTo(state.focus.camera) < 0.02)) state.focus = null;
  }

  function updateInspector() {
    const view = state.bodyViews.get(state.selectedId);
    const selected = state.actualFrame.get(state.selectedId);
    if (!view || !selected) return;
    const centerState = state.actualFrame.get(state.system.center) || { p: [0, 0, 0], v: [0, 0, 0] };
    const distance = Math.hypot(...selected.p.map((value, index) => value - centerState.p[index]));
    const velocity = Math.hypot(...selected.v.map((value, index) => value - centerState.v[index]));
    const model = state.modelFrame.get(state.selectedId);
    const residual = model ? Math.hypot(...selected.p.map((value, index) => value - model.p[index])) : null;
    if (els.obsSelectedName) els.obsSelectedName.textContent = view.body.name;
    if (els.obsSelectedType) els.obsSelectedType.textContent = String(view.body.type || 'body').replace(/-/g, ' ').toUpperCase();
    if (els.obsSelectedDistance) els.obsSelectedDistance.textContent = `${distance.toFixed(distance < 0.1 ? 5 : 3)} AU`;
    if (els.obsSelectedVelocity) {
      const velocityUnit = state.system.kind === 'catalog-keplerian'
        ? 'AU/day (idealized)'
        : (state.system.units?.velocity || 'AU/day');
      els.obsSelectedVelocity.textContent = `${velocity.toFixed(6)} ${velocityUnit}`;
    }
    if (els.obsSelectedResidual) els.obsSelectedResidual.textContent = residual === null ? 'Not available' : `${residual.toExponential(2)} AU`;
    if (els.obsSelectedSource) {
      const source = view.body.source || state.system.source || state.system.provenance?.provider || DATA.meta?.sources?.[0]?.name || 'Local catalog dataset';
      els.obsSelectedSource.textContent = source;
    }
  }

  function updateLabels() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    state.bodyViews.forEach(view => {
      if (!toggles.labels) { view.label.hidden = true; return; }
      const projected = view.group.position.clone().project(camera);
      const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15;
      view.label.hidden = !visible;
      if (visible) {
        view.label.style.transform = `translate(-50%,-150%) translate(${(projected.x * 0.5 + 0.5) * width}px,${(-projected.y * 0.5 + 0.5) * height}px)`;
      }
    });
  }

  function updateReadouts() {
    if (els.obsDate) {
      els.obsDate.textContent = state.system?.kind === 'catalog-keplerian'
        ? `DISPLAY DAY +${((state.currentMs - state.minMs) / DAY_MS).toFixed(1)}`
        : new Date(state.currentMs).toISOString().slice(0, 10);
    }
    if (els.obsDateSlider) {
      const span = Math.max(1, state.maxMs - state.minMs);
      els.obsDateSlider.value = String(Math.round((state.currentMs - state.minMs) / span * 1000));
    }
    if (els.obsFps) els.obsFps.textContent = `${Math.round(state.fps)} FPS`;
    if (els.obsStatus) {
      if (state.hidden || state.offscreen) setStatus('SUSPENDED');
      else if (!state.playing) setStatus('PAUSED');
      else setStatus(state.direction < 0 ? 'REVERSING' : 'PLAYING');
    }
    updateInspector();
  }

  function updateDomSummary() {
    if (!els.obsDomSummary || !state.system) return;
    const selected = state.bodyViews.get(state.selectedId)?.body?.name || 'no body';
    els.obsDomSummary.textContent = state.system.kind === 'ephemeris'
      ? `${state.system.name} observatory. ${selected} selected. Stored JPL reference states are linearly interpolated between 10-day samples; Compare mode uses a deliberately simpler local two-body propagation.`
      : `${state.system.name} catalog visualization. ${selected} selected. Orbits use catalog periods and distances with curated, unobserved display phases; this is not an ephemeris.`;
  }

  function setPlaying(value) {
    state.playing = Boolean(value);
    document.querySelectorAll('[data-obs-action="play"]').forEach(button => {
      button.setAttribute('aria-pressed', String(state.playing));
      const icon = button.querySelector('span[aria-hidden="true"]');
      if (icon) icon.textContent = state.playing ? 'Ⅱ' : '▶';
      const label = button.querySelector('[data-obs-play-label]');
      if (label) label.textContent = state.playing ? 'Pause' : 'Play';
      else {
        const textNode = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.nodeValue = state.playing ? ' Pause' : ' Play';
        else if (!icon) button.textContent = state.playing ? 'Pause' : 'Play';
      }
      button.setAttribute('aria-label', state.playing ? 'Pause time' : 'Play time');
    });
    updateReadouts();
  }

  function alterSpeed(delta) {
    state.speedIndex = clamp(state.speedIndex + delta, 0, SPEEDS.length - 1);
    announceSpeed();
  }

  function announceSpeed() {
    const value = SPEEDS[state.speedIndex];
    document.querySelectorAll('[data-obs-speed]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.obsSpeed) === value)));
    if (els.obsStatus) setStatus(`${state.direction < 0 ? '−' : ''}${value} DAYS/SEC`);
  }

  function stepTime(direction = state.direction) {
    state.currentMs = clamp(state.currentMs + Math.sign(direction) * DAY_MS, state.minMs, state.maxMs);
    updateBodies(true);
    updateReadouts();
  }

  function resetTime() {
    state.currentMs = state.system.kind === 'ephemeris'
      ? clamp(Date.now(), state.minMs, state.maxMs)
      : state.minMs;
    resetTrails();
    updateBodies(true);
    updateReadouts();
  }

  function resetCamera() {
    const distance = state.system?.kind === 'catalog-keplerian' ? 46 : 54;
    camera.position.set(distance * 0.58, distance * 0.42, distance * 0.75);
    controls.target.set(0, 0, 0);
    controls.update();
    state.focus = null;
  }

  function setToggle(name, value) {
    if (name === 'compare' && value && state.system?.kind !== 'ephemeris') {
      value = false;
      setStatus('COMPARE REQUIRES EPHEMERIS');
    }
    toggles[name] = Boolean(value);
    const element = els[`obs${name[0].toUpperCase()}${name.slice(1)}Toggle`];
    if (element) element.checked = toggles[name];
    if (name === 'orbits') orbitGroup.visible = toggles.orbits;
    if (name === 'vectors') updateVectors();
    if (name === 'trails' && !toggles.trails) resetTrails();
    if (name === 'fabric') {
      fabric.visible = toggles.fabric;
      if (fabric.visible) updateFabric(true);
    }
    if (name === 'compare') updateGhosts();
  }

  function toggleAudio() {
    if (state.audioEnabled) {
      state.audioEnabled = false;
      if (state.audio) state.audio.gain.gain.setTargetAtTime(0, state.audio.context.currentTime, 0.06);
    } else {
      if (!state.audio) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) { setStatus('AUDIO UNAVAILABLE'); return; }
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const harmonic = context.createOscillator();
        const gain = context.createGain();
        const harmonicGain = context.createGain();
        oscillator.type = 'sine'; harmonic.type = 'triangle';
        gain.gain.value = 0; harmonicGain.gain.value = 0.035;
        oscillator.connect(gain); harmonic.connect(harmonicGain).connect(gain); gain.connect(context.destination);
        oscillator.start(); harmonic.start();
        state.audio = { context, oscillator, harmonic, gain };
      }
      state.audio.context.resume();
      state.audioEnabled = true;
      state.audio.gain.gain.setTargetAtTime(0.055, state.audio.context.currentTime, 0.1);
      updateAudio();
    }
    document.querySelectorAll('[data-obs-action="audio"]').forEach(button => {
      button.setAttribute('aria-pressed', String(state.audioEnabled));
      button.textContent = state.audioEnabled ? 'Sonification on' : 'Sonification off';
      button.setAttribute('aria-label', state.audioEnabled ? 'Turn artistic sonification off' : 'Turn artistic sonification on');
    });
  }

  function updateAudio() {
    if (!state.audio || !state.audioEnabled) return;
    const selected = state.actualFrame.get(state.selectedId);
    const center = state.actualFrame.get(state.system.center) || { p: [0, 0, 0] };
    if (!selected) return;
    const distance = Math.max(0.001, Math.hypot(...selected.p.map((value, index) => value - center.p[index])));
    const frequency = clamp(110 + 170 / Math.sqrt(distance + 0.05), 110, 880);
    const now = state.audio.context.currentTime;
    state.audio.oscillator.frequency.setTargetAtTime(frequency, now, 0.08);
    state.audio.harmonic.frequency.setTargetAtTime(frequency * 1.501, now, 0.08);
  }

  function tourSteps() {
    const center = state.system.center || state.bodies[0]?.id;
    const firstPlanet = state.bodies.find(body => body.id !== center)?.id;
    return [
      { kicker: 'GUIDED TOUR / 01', title: 'Begin at the system center.', copy: 'The scene uses measured ephemeris samples when available. Body radii are exaggerated in Exploration scale so every object remains selectable.', run: () => { selectBody(center, true); setToggle('labels', true); } },
      { kicker: 'GUIDED TOUR / 02', title: 'Read motion in three dimensions.', copy: 'Orbit paths and velocity arrows expose direction and inclination. They are visual aids, not force or uncertainty envelopes.', run: () => { if (firstPlanet) selectBody(firstPlanet, true); setToggle('orbits', true); setToggle('vectors', true); } },
      { kicker: 'GUIDED TOUR / 03', title: 'Compare a simpler model.', copy: 'For ephemeris data, wireframe ghosts propagate each body from its first state using an isolated two-body approximation. The inspector reports the position residual.', run: () => setToggle('compare', state.system.kind === 'ephemeris') },
      { kicker: 'GUIDED TOUR / 04', title: 'Reveal the interpretive fabric.', copy: 'The grid bends around displayed bodies as an artistic gravity metaphor. It is deliberately not a general-relativity calculation.', run: () => setToggle('fabric', true) },
      { kicker: 'GUIDED TOUR / 05', title: 'Continue exploring.', copy: 'Drag to orbit, scroll or pinch to zoom, select any body, reverse time, and switch systems. The source and model limits remain visible in the inspector.', run: () => { setToggle('vectors', false); setToggle('fabric', false); } }
    ];
  }

  function showTour(index = 0) {
    const steps = tourSteps();
    const opening = Boolean(els.obsTour?.hidden);
    if (opening) state.tourReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.tourIndex = (index + steps.length) % steps.length;
    const step = steps[state.tourIndex];
    if (els.obsTour) {
      els.obsTour.hidden = false;
      els.obsTour.classList.add('active');
      els.obsTour.setAttribute('role', 'dialog');
      els.obsTour.setAttribute('aria-modal', 'true');
      const progress = els.obsTour.querySelector('.tour-progress');
      if (progress) {
        while (progress.children.length < steps.length) progress.append(document.createElement('i'));
        [...progress.children].forEach((marker, markerIndex) => {
          marker.style.background = markerIndex <= state.tourIndex ? 'var(--violet)' : '#27374d';
        });
      }
    }
    if (els.obsTourKicker) els.obsTourKicker.textContent = step.kicker;
    if (els.obsTourTitle) els.obsTourTitle.textContent = step.title;
    if (els.obsTourCopy) els.obsTourCopy.textContent = step.copy;
    step.run();
    if (opening) requestAnimationFrame(() => els.obsTour?.querySelector('button')?.focus());
  }

  function closeTour() {
    state.tourIndex = -1;
    if (els.obsTour) { els.obsTour.hidden = true; els.obsTour.classList.remove('active'); }
    if (state.tourReturnFocus?.isConnected) state.tourReturnFocus.focus();
    state.tourReturnFocus = null;
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await viewport.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { setStatus('FULLSCREEN UNAVAILABLE'); }
  }

  function bindAction(name, handler) {
    document.querySelectorAll(`[data-obs-action="${name}"]`).forEach(button => button.addEventListener('click', event => { event.preventDefault(); handler(event); }));
  }

  bindAction('play', () => setPlaying(!state.playing));
  bindAction('reverse', () => { state.direction *= -1; document.querySelectorAll('[data-obs-action="reverse"]').forEach(button => button.setAttribute('aria-pressed', String(state.direction < 0))); announceSpeed(); });
  bindAction('slower', () => alterSpeed(-1));
  bindAction('faster', () => alterSpeed(1));
  bindAction('step', () => { setPlaying(false); stepTime(1); });
  bindAction('reset-time', resetTime);
  bindAction('reset-camera', resetCamera);
  bindAction('guided-tour', () => showTour(0));
  bindAction('audio', toggleAudio);
  bindAction('fullscreen', toggleFullscreen);
  bindAction('tour-next', () => showTour(state.tourIndex + 1));
  bindAction('tour-previous', () => showTour(state.tourIndex - 1));
  bindAction('tour-close', closeTour);
  document.querySelectorAll('[data-tour-action], [data-obs-tour-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.tourAction || button.dataset.obsTourAction;
    if (action === 'next') showTour(state.tourIndex + 1);
    if (action === 'previous') showTour(state.tourIndex - 1);
    if (action === 'exit' || action === 'close') closeTour();
  }));
  if (els.obsTour) els.obsTour.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeTour(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...els.obsTour.querySelectorAll('button:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hidden && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  document.querySelectorAll('[data-obs-speed]').forEach(button => button.addEventListener('click', () => {
    const requested = Number(button.dataset.obsSpeed);
    let nearest = 0;
    SPEEDS.forEach((speed, index) => { if (Math.abs(speed - requested) < Math.abs(SPEEDS[nearest] - requested)) nearest = index; });
    state.speedIndex = nearest;
    announceSpeed();
  }));

  const toggleMap = {
    obsOrbitsToggle: 'orbits', obsLabelsToggle: 'labels', obsVectorsToggle: 'vectors',
    obsTrailsToggle: 'trails', obsFabricToggle: 'fabric', obsCompareToggle: 'compare'
  };
  Object.entries(toggleMap).forEach(([id, name]) => {
    if (els[id]) els[id].addEventListener('change', () => setToggle(name, els[id].checked));
  });
  if (els.obsScaleToggle) els.obsScaleToggle.addEventListener('change', () => {
    state.scaleMode = els.obsScaleToggle.checked ? 'relative' : 'exploration';
    applyScaleMode();
  });
  if (els.obsSystemSelect) els.obsSystemSelect.addEventListener('change', () => chooseSystem(els.obsSystemSelect.value));
  if (els.obsDateSlider) {
    els.obsDateSlider.min = '0'; els.obsDateSlider.max = '1000'; els.obsDateSlider.step = '1';
    els.obsDateSlider.addEventListener('input', () => {
      const ratio = finite(els.obsDateSlider.value) / 1000;
      state.currentMs = state.minMs + (state.maxMs - state.minMs) * ratio;
      updateBodies(true); updateReadouts();
    });
  }

  let pointerStart = null;
  canvas.addEventListener('pointerdown', event => {
    canvas.focus({ preventScroll: true });
    pointerStart = { x: event.clientX, y: event.clientY };
    state.focus = null;
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) { pointerStart = null; return; }
    const rect = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
    pointer.y = -(event.clientY - rect.top) / rect.height * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...state.bodyViews.values()].map(view => view.group), true);
    const hit = hits.find(item => item.object.userData.bodyId || item.object.parent?.userData.bodyId);
    const id = hit && (hit.object.userData.bodyId || hit.object.parent?.userData.bodyId);
    if (id) selectBody(id, false);
    pointerStart = null;
  });
  canvas.addEventListener('dblclick', () => focusSelected());

  window.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')) return;
    if (document.activeElement !== canvas) return;
    if (event.code === 'Space') { event.preventDefault(); setPlaying(!state.playing); }
    else if (event.code === 'KeyR') resetTime();
    else if (event.code === 'KeyF') focusSelected();
    else if (event.code === 'ArrowRight') { event.preventDefault(); setPlaying(false); stepTime(1); }
    else if (event.code === 'ArrowLeft') { event.preventDefault(); setPlaying(false); stepTime(-1); }
    else if (event.key === '+' || event.key === '=') alterSpeed(1);
    else if (event.key === '-') alterSpeed(-1);
    else if (event.code === 'KeyO') setToggle('orbits', !toggles.orbits);
    else if (event.code === 'KeyL') setToggle('labels', !toggles.labels);
    else if (event.code === 'KeyV') setToggle('vectors', !toggles.vectors);
    else if (event.code === 'KeyT') setToggle('trails', !toggles.trails);
    else if (event.code === 'KeyC') setToggle('compare', !toggles.compare);
    else if (event.code === 'KeyG') setToggle('fabric', !toggles.fabric);
    else if (event.code === 'BracketRight' || event.code === 'BracketLeft') {
      const current = Math.max(0, state.bodies.findIndex(body => body.id === state.selectedId));
      const direction = event.code === 'BracketRight' ? 1 : -1;
      const next = (current + direction + state.bodies.length) % state.bodies.length;
      selectBody(state.bodies[next].id, false);
    }
    else if (event.code === 'Escape') closeTour();
  });

  document.addEventListener('visibilitychange', () => {
    state.hidden = document.hidden;
    if (state.hidden) setStatus('SUSPENDED');
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      state.offscreen = !entries[0]?.isIntersecting;
      if (state.offscreen) setStatus('SUSPENDED');
    }, { threshold: 0.02 }).observe(viewport);
  }

  function resize() {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, state.dprLimit);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(viewport);
  else window.addEventListener('resize', resize);

  function updateFps(dt) {
    if (dt <= 0 || dt > 0.5) return;
    state.fpsSamples.push(1 / dt);
    if (state.fpsSamples.length > 45) state.fpsSamples.shift();
    state.fps = state.fpsSamples.reduce((sum, value) => sum + value, 0) / state.fpsSamples.length;
    if (state.fps < 34) state.lowFpsSeconds += dt;
    else state.lowFpsSeconds = Math.max(0, state.lowFpsSeconds - dt * 0.5);
    if (state.lowFpsSeconds > 3 && state.dprLimit > 1) {
      state.dprLimit = 1;
      stars.geometry.setDrawRange(0, 4000);
      resize();
      state.lowFpsSeconds = 0;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, clock.getDelta());
    updateFps(dt);
    if (!state.hidden && !state.offscreen) {
      if (state.playing) {
        const speed = SPEEDS[state.speedIndex];
        state.currentMs += dt * speed * DAY_MS * state.direction;
        if (state.currentMs > state.maxMs) { state.currentMs = state.minMs; resetTrails(); }
        if (state.currentMs < state.minMs) { state.currentMs = state.maxMs; resetTrails(); }
        updateBodies();
        state.trailTimer += dt;
        if (state.trailTimer >= 0.12) { state.trailTimer = 0; sampleTrails(); }
      }
      updateFocus(dt);
      controls.update();
      updateLabels();
      updateAudio();
      state.lastTelemetry += dt;
      if (state.lastTelemetry > 0.18) { state.lastTelemetry = 0; updateReadouts(); }
      renderer.render(scene, camera);
    }
  }

  populateSystemSelect();
  resize();
  chooseSystem(systemsEntries()[0]?.[0]);
  setPlaying(state.playing);
  announceSpeed();
  updateReadouts();
  animate();

  window.CosmosObservatory = Object.freeze({
    selectBody: id => selectBody(id, true),
    chooseSystem,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    resetTime,
    resetCamera,
    getState: () => ({
      system: state.systemKey,
      date: new Date(state.currentMs).toISOString(),
      selected: state.selectedId,
      playing: state.playing,
      direction: state.direction,
      speedDaysPerSecond: SPEEDS[state.speedIndex],
      scaleMode: state.scaleMode
    })
  });
  window.dispatchEvent(new CustomEvent('cosmosobservatory:ready', { detail: { system: state.systemKey } }));
})();
