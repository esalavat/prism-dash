// PRISM DASH — neon low-poly endless runner
// Three.js (vendored locally). No runtime CDN dependency.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ------------------------------------------------------------------ config
const LANES = [-2.4, 0, 2.4];
const SPAWN_Z = -150;        // where new rows appear (well inside the fog)
const DESPAWN_Z = 12;        // behind the camera
const PLAYER_Z = 0;
const TRACK_HALF = 3.8;
const GRAVITY = -55;
const JUMP_V = 15.5;
const BASE_SPEED = 24;
const MAX_SPEED = 62;
const DASH_MULT = 1.7;
const DASH_TIME = 3.2;

const BIOMES = [
  { fog: 0x08081e, floor: 0x14173a, accent: 0xff2ba6, rail: 0x2bd4ff, light: 0x6a3aff },
  { fog: 0x001417, floor: 0x07242a, accent: 0x2bffd4, rail: 0xff2b6a, light: 0x1affc8 },
  { fog: 0x160018, floor: 0x230a2c, accent: 0xb52bff, rail: 0xffcf2b, light: 0xff2bd4 },
  { fog: 0x0a1200, floor: 0x16220a, accent: 0x9dff2b, rail: 0x2bb5ff, light: 0x8bff2b },
];
const BIOME_EVERY = 620; // metres per biome

// ------------------------------------------------------------------ save/state
const SAVE_KEY = 'prismdash.v1';
const save = Object.assign({
  best: 0,
  shards: 0,
  owned: ['quartz', 'fuchsia'],
  skin: 'quartz',
  sound: true,
  removeAds: false,
}, loadSave());

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
  catch (e) { return {}; }
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

// ------------------------------------------------------------------ skins & store
const SKINS = [
  { id: 'quartz',  name: 'Quartz',  color: 0x86f7ff, emissive: 0x25c9ff, price: 0 },
  { id: 'fuchsia', name: 'Fuchsia', color: 0xff8fd8, emissive: 0xff2ba6, price: 0 },
  { id: 'volt',    name: 'Volt',    color: 0xd7ff5a, emissive: 0x9dff2b, price: 0.99 },
  { id: 'ember',   name: 'Ember',   color: 0xffb072, emissive: 0xff5a1f, price: 1.99 },
  { id: 'void',    name: 'Void',    color: 0xc0a0ff, emissive: 0x7b2bff, price: 1.99 },
  { id: 'aurum',   name: 'Aurum',   color: 0xffe6a0, emissive: 0xffb62b, price: 2.99 },
];
const skinById = id => SKINS.find(s => s.id === id) || SKINS[0];

// Purchase layer: uses native IAP when packaged with Capacitor + RevenueCat,
// otherwise falls back to a (clearly labelled) demo unlock on the web.
const Store = {
  native() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); },
  async buy(productId, price) {
    if (this.native() && window.Purchases) {
      // Wire real purchases here (see README): RevenueCat / StoreKit / Play Billing.
      try {
        await window.Purchases.purchaseProduct({ productIdentifier: productId });
        return true;
      } catch (e) { return false; }
    }
    // Web demo: simulate a successful purchase so the flow is testable.
    toast(`Demo unlock · $${price.toFixed(2)} (real IAP in the app)`);
    return true;
  },
};

// ------------------------------------------------------------------ DOM
const $ = sel => document.querySelector(sel);
const dom = {
  hud: $('#hud'), menu: $('#menu'), gameover: $('#gameover'), pause: $('#pause'), shop: $('#shop'),
  score: $('#scoreVal'), shard: $('#shardVal'), boost: $('#boostFill'), boostWrap: $('.hud-boost'),
  menuBest: $('#menuBest'), goScore: $('#goScore'), goBest: $('#goBest'), goShards: $('#goShards'),
  newBest: $('#newBest'), skinGrid: $('#skinGrid'), soundBtn: $('#soundBtn'),
  removeAds: $('#removeAdsBtn'), reviveBtn: $('#reviveBtn'), toast: $('#toast'),
};

let toastTimer;
function toast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.add('hidden'), 1900);
}

// ------------------------------------------------------------------ three setup
const canvas = document.getElementById('game');
const isMobile = matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.6 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const biome = { fog: new THREE.Color(BIOMES[0].fog), floor: new THREE.Color(BIOMES[0].floor),
                accent: new THREE.Color(BIOMES[0].accent), rail: new THREE.Color(BIOMES[0].rail),
                light: new THREE.Color(BIOMES[0].light) };
scene.fog = new THREE.FogExp2(biome.fog.getHex(), 0.003);
scene.background = biome.fog.clone();

const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 400);
camera.position.set(0, 5.4, 9.6);
camera.lookAt(0, 1.3, -10);

// lights
const ambient = new THREE.AmbientLight(0x8090ff, 0.55);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x0a0a20, 0.7);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
keyLight.position.set(6, 12, 6);
scene.add(keyLight);
const playerLight = new THREE.PointLight(biome.light.getHex(), 6, 22, 2);
playerLight.position.set(0, 2.5, 1);
scene.add(playerLight);

// post
let composer = null, bloom = null;
function buildComposer() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), isMobile ? 0.75 : 0.95, 0.55, 0.18);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch (e) {
    console.warn('Bloom disabled:', e);
    composer = null;
  }
}
buildComposer();

// ------------------------------------------------------------------ materials
const floorMat = new THREE.MeshStandardMaterial({ color: biome.floor, roughness: 0.9, metalness: 0.1 });
const railMat = new THREE.MeshStandardMaterial({ color: 0x0a0a20, emissive: biome.rail, emissiveIntensity: 2.2, roughness: 0.4 });
const barrierMat = new THREE.MeshStandardMaterial({ color: 0x111122, emissive: biome.accent, emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.2 });
const hurdleMat = new THREE.MeshStandardMaterial({ color: 0x111122, emissive: biome.rail, emissiveIntensity: 1.6, roughness: 0.5 });
const shardMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffcf2b, emissiveIntensity: 2.2, roughness: 0.3 });
const rungMat = new THREE.MeshStandardMaterial({ color: 0x0a0a20, emissive: biome.rail, emissiveIntensity: 1.3, roughness: 0.5 });
const pylonMat = new THREE.MeshStandardMaterial({ color: 0x0c0c22, emissive: biome.accent, emissiveIntensity: 0.9, roughness: 0.6 });
const playerMat = new THREE.MeshStandardMaterial({ color: 0x86f7ff, emissive: 0x25c9ff, emissiveIntensity: 1.7, roughness: 0.25, metalness: 0.3, flatShading: true });

// ------------------------------------------------------------------ static world
// floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_HALF * 2 + 1.6, 400), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.z = -100;
scene.add(floor);

// side rails (long glowing beams)
const railGeo = new THREE.BoxGeometry(0.18, 0.32, 400);
for (const side of [-1, 1]) {
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.set(side * (TRACK_HALF + 0.1), 0.16, -100);
  scene.add(rail);
}

// scrolling rungs across the track
const rungs = [];
const rungGeo = new THREE.BoxGeometry(TRACK_HALF * 2, 0.06, 0.14);
const RUNG_COUNT = 26, RUNG_GAP = 7, RUNG_SPAN = RUNG_COUNT * RUNG_GAP;
for (let i = 0; i < RUNG_COUNT; i++) {
  const m = new THREE.Mesh(rungGeo, rungMat);
  m.position.set(0, 0.02, DESPAWN_Z - i * RUNG_GAP);
  scene.add(m);
  rungs.push(m);
}

// side pylons (parallax scenery)
const pylons = [];
const pylonGeo = new THREE.ConeGeometry(1.1, 5.5, 5);
const PYLON_COUNT = 18, PYLON_GAP = 18, PYLON_SPAN = PYLON_COUNT / 2 * PYLON_GAP;
for (let i = 0; i < PYLON_COUNT; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const m = new THREE.Mesh(pylonGeo, pylonMat);
  const h = 3 + Math.random() * 5;
  m.scale.y = h / 5.5;
  m.position.set(side * (TRACK_HALF + 3 + Math.random() * 5), h / 2 - 1.4, DESPAWN_Z - (i >> 1) * PYLON_GAP);
  scene.add(m);
  pylons.push(m);
}

// ------------------------------------------------------------------ player
const player = new THREE.Group();
const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), playerMat);
crystal.scale.set(1, 1.35, 1);
player.add(crystal);
const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0),
  new THREE.MeshBasicMaterial({ color: 0x25c9ff, transparent: true, opacity: 0.16 }));
player.add(halo);
player.position.set(0, 0.9, PLAYER_Z);
scene.add(player);

function applySkin(id) {
  const s = skinById(id);
  playerMat.color.setHex(s.color);
  playerMat.emissive.setHex(s.emissive);
  halo.material.color.setHex(s.emissive);
  save.skin = id;
}
applySkin(save.skin);

// ------------------------------------------------------------------ pools
function makePool(create) {
  return { free: [], create, get() { return this.free.pop() || this.create(); }, release(o) { o.mesh.visible = false; this.free.push(o); } };
}
const barrierGeo = new THREE.BoxGeometry(1.9, 2.6, 1.3);
const hurdleGeo = new THREE.BoxGeometry(TRACK_HALF * 2, 0.75, 0.9);
const shardGeo = new THREE.OctahedronGeometry(0.42, 0);

const pools = {
  barrier: makePool(() => ({ type: 'barrier', mesh: mount(new THREE.Mesh(barrierGeo, barrierMat)), depth: 1.3 })),
  hurdle: makePool(() => ({ type: 'hurdle', mesh: mount(new THREE.Mesh(hurdleGeo, hurdleMat)), depth: 0.9 })),
  shard: makePool(() => ({ type: 'shard', mesh: mount(new THREE.Mesh(shardGeo, shardMat)), depth: 0.6 })),
};
function mount(mesh) { mesh.visible = false; scene.add(mesh); return mesh; }

let items = []; // active scrolling obstacles + shards

function spawn(type, lane, y) {
  const o = pools[type].get();
  o.lane = lane;
  o.z = SPAWN_Z;
  o.resolved = false;
  o.active = true;
  const x = lane == null ? 0 : LANES[lane];
  o.y = y != null ? y : (type === 'barrier' ? 1.3 : type === 'hurdle' ? 0.38 : 1.0);
  o.mesh.position.set(x, o.y, SPAWN_Z);
  o.mesh.visible = true;
  o.mesh.rotation.set(0, 0, 0);
  items.push(o);
  return o;
}
function releaseAll() {
  for (const o of items) { o.active = false; pools[o.type].release(o); }
  items = [];
}

// ------------------------------------------------------------------ spawn director
let distSinceRow = 0;

function spawnRow(distance) {
  const diff = Math.min(1, distance / 1400);       // 0..1 difficulty ramp
  const r = Math.random();

  if (r < 0.16) {
    // breather: shard line in a random lane
    const lane = rand3();
    for (let i = 0; i < 3; i++) spawnShard(lane, 1.0, -i * 2.2);
    return;
  }
  if (r < 0.30 + diff * 0.18) {
    // jump hurdle across the whole track (+ shard arc to reward jumping)
    spawn('hurdle', null);
    for (let i = -1; i <= 1; i++) spawnShard(rand3(), 2.1 + Math.abs(i) * -0.2, i * 1.4);
    return;
  }
  if (r < 0.62 + diff * 0.2) {
    // one blocked lane, shard bait in another
    const block = rand3();
    spawn('barrier', block);
    const safe = otherLane(block);
    spawnShard(safe, 1.0, 0);
    return;
  }
  // two blocked lanes (harder) — always leaves one open path
  const open = rand3();
  for (let l = 0; l < 3; l++) if (l !== open) spawn('barrier', l);
  spawnShard(open, 1.0, 0);
}
function spawnShard(lane, y, dz) {
  const o = spawn('shard', lane, y);
  o.z = SPAWN_Z + (dz || 0);
  o.mesh.position.z = o.z;
}
function rand3() { return (Math.random() * 3) | 0; }
function otherLane(l) { const o = [0, 1, 2].filter(x => x !== l); return o[(Math.random() * o.length) | 0]; }

// ------------------------------------------------------------------ game state
const S = { MENU: 0, PLAYING: 1, DEAD: 2, PAUSED: 3 };
let state = S.MENU;

const g = {
  distance: 0, shards: 0, speed: BASE_SPEED,
  lane: 1, targetX: 0,
  y: 0.9, vy: 0, grounded: true,
  boost: 0, dashLeft: 0, invuln: 0,
  usedRevive: false, biomeIdx: 0, ambientScroll: 0,
};
const targetBiome = { fog: new THREE.Color(), floor: new THREE.Color(), accent: new THREE.Color(), rail: new THREE.Color(), light: new THREE.Color() };
setBiomeTarget(0);

function setBiomeTarget(i) {
  const b = BIOMES[i % BIOMES.length];
  targetBiome.fog.setHex(b.fog); targetBiome.floor.setHex(b.floor);
  targetBiome.accent.setHex(b.accent); targetBiome.rail.setHex(b.rail); targetBiome.light.setHex(b.light);
}

function resetRun() {
  releaseAll();
  g.distance = 0; g.shards = 0; g.speed = BASE_SPEED;
  g.lane = 1; g.targetX = LANES[1];
  g.y = 0.9; g.vy = 0; g.grounded = true;
  g.boost = 0; g.dashLeft = 0; g.invuln = 0.6;
  g.usedRevive = false; g.biomeIdx = 0; g.ambientScroll = 0;
  distSinceRow = 0;
  player.position.set(0, 0.9, PLAYER_Z);
  setBiomeTarget(0);
}

function startRun() {
  resetRun();
  hide(dom.menu); hide(dom.gameover); hide(dom.shop); hide(dom.pause);
  show(dom.hud);
  state = S.PLAYING;
  updateHUD();
}

function endRun() {
  state = S.DEAD;
  g.shards = g.shards | 0;
  save.shards += g.shards;
  const finalScore = Math.floor(g.distance);
  const isBest = finalScore > save.best;
  if (isBest) save.best = finalScore;
  persist();
  dom.goScore.textContent = finalScore;
  dom.goBest.textContent = save.best;
  dom.goShards.textContent = g.shards;
  dom.newBest.classList.toggle('hidden', !isBest);
  dom.reviveBtn.classList.toggle('hidden', g.usedRevive);
  hide(dom.hud);
  show(dom.gameover);
}

function revive() {
  // "Watch ad to continue" — clears nearby obstacles and resumes.
  g.usedRevive = true;
  g.invuln = 2.2;
  g.vy = 0; g.y = 0.9; g.grounded = true;
  for (const o of items) { if (o.z > -30 && o.type !== 'shard') { o.resolved = true; o.mesh.visible = false; o.active = false; } }
  items = items.filter(o => o.active || o.type === 'shard');
  hide(dom.gameover); show(dom.hud);
  state = S.PLAYING;
}

// ------------------------------------------------------------------ input
function moveLane(dir) {
  if (state !== S.PLAYING) return;
  g.lane = Math.max(0, Math.min(2, g.lane + dir));
  g.targetX = LANES[g.lane];
}
function jump() {
  if (state !== S.PLAYING) return;
  if (g.grounded) { g.vy = JUMP_V; g.grounded = false; }
}
function tryDash() {
  if (state !== S.PLAYING || g.boost < 1 || g.dashLeft > 0) return;
  g.boost = 0; g.dashLeft = DASH_TIME; g.invuln = Math.max(g.invuln, DASH_TIME);
  dom.boostWrap.classList.remove('ready');
}

addEventListener('keydown', e => {
  if (e.repeat) return;
  switch (e.key) {
    case 'ArrowLeft': case 'a': moveLane(-1); break;
    case 'ArrowRight': case 'd': moveLane(1); break;
    case 'ArrowUp': case 'w': case ' ': jump(); break;
    case 'Shift': tryDash(); break;
    case 'Escape': if (state === S.PLAYING) doPause(); break;
  }
});

// touch / pointer gestures
let ptr = null;
canvas.addEventListener('pointerdown', e => { ptr = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', e => {
  if (!ptr) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, dt = performance.now() - ptr.t;
  ptr = null;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx > 34 && adx > ady) { moveLane(dx > 0 ? 1 : -1); }
  else if (dy < -34 && ady > adx) { jump(); }
  else if (adx < 16 && ady < 16 && dt < 260) {
    // tap: right side taps dash if ready, otherwise jump
    if (g.boost >= 1 && e.clientX > innerWidth * 0.62) tryDash();
    else jump();
  }
});

// ------------------------------------------------------------------ collision @ crossing plane
function resolveCrossing(o) {
  if (o.type === 'shard') {
    if (o.lane == null || Math.abs(player.position.x - LANES[o.lane]) < 1.1) {
      const dy = Math.abs(player.position.y - o.y);
      if (dy < 1.1) {
        g.shards++;
        g.boost = Math.min(1, g.boost + 0.06);
        if (g.boost >= 1) dom.boostWrap.classList.add('ready');
        o.resolved = true; o.mesh.visible = false; o.active = false;
        updateHUD();
        return;
      }
    }
    return; // missed shard, keep it scrolling past
  }
  // obstacles
  if (g.invuln > 0) return;
  if (o.type === 'barrier') {
    if (Math.abs(player.position.x - LANES[o.lane]) < 1.25 && player.position.y < 2.3) hit();
  } else if (o.type === 'hurdle') {
    if (player.position.y < 1.15) hit();
  }
}
function hit() { if (state === S.PLAYING) endRun(); }

// ------------------------------------------------------------------ per-frame update
function update(dt) {
  const playing = state === S.PLAYING;

  // ambient drift on menus / death so the world still moves
  const speed = playing ? g.speed * (g.dashLeft > 0 ? DASH_MULT : 1) : BASE_SPEED * 0.35;

  // scroll static scenery
  for (const m of rungs) { m.position.z += speed * dt; if (m.position.z > DESPAWN_Z) m.position.z -= RUNG_SPAN; }
  for (const m of pylons) { m.position.z += speed * dt; if (m.position.z > DESPAWN_Z) m.position.z -= PYLON_SPAN; }

  if (playing) {
    g.distance += speed * dt;
    g.speed = Math.min(MAX_SPEED, BASE_SPEED + g.distance * 0.02);
    if (g.dashLeft > 0) g.dashLeft = Math.max(0, g.dashLeft - dt);
    if (g.invuln > 0) g.invuln = Math.max(0, g.invuln - dt);

    // biome progression
    const bi = Math.floor(g.distance / BIOME_EVERY);
    if (bi !== g.biomeIdx) { g.biomeIdx = bi; setBiomeTarget(bi); }

    // spawn director keeps constant spacing regardless of speed
    const rowGap = Math.max(5.0, 9 - Math.min(3, g.distance / 900));
    distSinceRow += speed * dt;
    while (distSinceRow >= rowGap) { distSinceRow -= rowGap; spawnRow(g.distance); }

    // player lane lerp + jump physics
    player.position.x += (g.targetX - player.position.x) * Math.min(1, dt * 14);
    if (!g.grounded) {
      g.vy += GRAVITY * dt;
      g.y += g.vy * dt;
      if (g.y <= 0.9) { g.y = 0.9; g.vy = 0; g.grounded = true; }
    }
    player.position.y = g.y;
    // bank into turns + spin
    crystal.rotation.y += dt * 2.2;
    player.rotation.z = (g.targetX - player.position.x) * 0.12;
  }

  // scroll active items, resolve at crossing plane, recycle behind camera
  for (let i = items.length - 1; i >= 0; i--) {
    const o = items[i];
    o.z += speed * dt;
    o.mesh.position.z = o.z;
    if (o.type === 'shard') { o.mesh.rotation.y += dt * 3; o.mesh.rotation.x += dt * 1.3; }
    if (playing && !o.resolved && o.z >= PLAYER_Z - 0.25) { o.resolved = true; resolveCrossing(o); }
    if (o.z > DESPAWN_Z || !o.active) {
      o.active = false; pools[o.type].release(o);
      items.splice(i, 1);
    }
  }

  // lerp biome colours
  const k = Math.min(1, dt * 1.2);
  biome.fog.lerp(targetBiome.fog, k);
  biome.floor.lerp(targetBiome.floor, k);
  biome.accent.lerp(targetBiome.accent, k);
  biome.rail.lerp(targetBiome.rail, k);
  biome.light.lerp(targetBiome.light, k);
  scene.fog.color.copy(biome.fog);
  scene.background.copy(biome.fog);
  floorMat.color.copy(biome.floor);
  railMat.emissive.copy(biome.rail); rungMat.emissive.copy(biome.rail); hurdleMat.emissive.copy(biome.rail);
  barrierMat.emissive.copy(biome.accent); pylonMat.emissive.copy(biome.accent);
  playerLight.color.copy(biome.light);
  playerLight.position.set(player.position.x, 2.6, player.position.z + 1);

  // dash camera kick
  const kick = g.dashLeft > 0 ? 1.4 : 0;
  camera.position.z += ((9.6 - kick) - camera.position.z) * Math.min(1, dt * 4);
  camera.position.x += (player.position.x * 0.35 - camera.position.x) * Math.min(1, dt * 4);

  // boost meter UI
  if (playing) dom.boost.style.width = (g.boost * 100).toFixed(0) + '%';
}

let lastScoreShown = -1;
function updateHUD() {
  const sc = Math.floor(g.distance);
  if (sc !== lastScoreShown) { dom.score.textContent = sc; lastScoreShown = sc; }
  dom.shard.textContent = g.shards;
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // clamp after tab-out
  update(dt);
  if (state === S.PLAYING) updateHUD();
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ resize
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) composer.setSize(w, h);
  if (bloom) bloom.setSize(w, h);
}
addEventListener('resize', resize);
resize();

// pause when tab hidden
document.addEventListener('visibilitychange', () => { if (document.hidden && state === S.PLAYING) doPause(); });

// ------------------------------------------------------------------ UI wiring
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

function doPause() { if (state !== S.PLAYING) return; state = S.PAUSED; hide(dom.hud); show(dom.pause); }
function doResume() { if (state !== S.PAUSED) return; hide(dom.pause); show(dom.hud); last = performance.now(); state = S.PLAYING; }

$('#playBtn').onclick = startRun;
$('#againBtn').onclick = startRun;
$('#pauseBtn').onclick = doPause;
$('#resumeBtn').onclick = doResume;
$('#quitBtn').onclick = () => { hide(dom.pause); toMenu(); };
$('#goMenuBtn').onclick = toMenu;
$('#reviveBtn').onclick = async () => {
  toast('▶ ad reward');
  setTimeout(revive, 500);
};

function toMenu() {
  state = S.MENU;
  hide(dom.hud); hide(dom.gameover); hide(dom.pause); hide(dom.shop);
  show(dom.menu);
  dom.menuBest.textContent = save.best;
}

// sound (light stub — real SFX can be added later)
function refreshSound() { dom.soundBtn.textContent = save.sound ? '🔊' : '🔇'; }
dom.soundBtn.onclick = () => { save.sound = !save.sound; persist(); refreshSound(); };
refreshSound();

// shop
$('#shopBtn').onclick = openShop;
$('#goShopBtn').onclick = openShop;
$('#shopClose').onclick = () => { hide(dom.shop); (state === S.DEAD ? show(dom.gameover) : show(dom.menu)); };

function openShop() {
  hide(dom.menu); hide(dom.gameover);
  buildShop();
  show(dom.shop);
}
function buildShop() {
  dom.skinGrid.innerHTML = '';
  for (const s of SKINS) {
    const owned = save.owned.includes(s.id);
    const selected = save.skin === s.id;
    const card = document.createElement('div');
    card.className = 'skin-card' + (selected ? ' selected' : '');
    card.innerHTML =
      `<div class="skin-swatch" style="background:#${s.color.toString(16).padStart(6, '0')};color:#${s.emissive.toString(16).padStart(6, '0')}"></div>
       <div class="skin-name">${s.name}</div>
       <div class="skin-tag ${owned ? 'owned' : ''}">${owned ? (selected ? 'EQUIPPED' : 'TAP TO EQUIP') : '$' + s.price.toFixed(2)}</div>`;
    card.onclick = () => onSkin(s);
    dom.skinGrid.appendChild(card);
  }
  dom.removeAds.textContent = save.removeAds ? 'ADS REMOVED ✓' : 'REMOVE ADS · $2.99';
  dom.removeAds.disabled = save.removeAds;
}
async function onSkin(s) {
  if (save.owned.includes(s.id)) { applySkin(s.id); persist(); buildShop(); return; }
  const ok = await Store.buy('skin_' + s.id, s.price);
  if (ok) { save.owned.push(s.id); applySkin(s.id); persist(); buildShop(); toast(`${s.name} unlocked!`); }
}
dom.removeAds.onclick = async () => {
  if (save.removeAds) return;
  const ok = await Store.buy('remove_ads', 2.99);
  if (ok) { save.removeAds = true; persist(); buildShop(); toast('Ads removed — thank you!'); }
};

// ------------------------------------------------------------------ go
dom.menuBest.textContent = save.best;
requestAnimationFrame(frame);
