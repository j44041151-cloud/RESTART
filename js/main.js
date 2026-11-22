import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Colliders, clamp, Shake } from './core/utils.js';
import { Input } from './core/Input.js';
import { AudioEngine } from './core/Audio.js';
import { SaveSystem } from './core/SaveSystem.js';
import { UI } from './ui/UI.js';
import { IntroCinematic } from './ui/IntroCinematic.js';
import { EndingSequence } from './story/Ending.js';
import { RELAY_MEMORIES, CHAPTER_HINTS } from './story/Story.js';
import { createMaterials } from './world/Materials.js';
import { SkyRig } from './world/Sky.js';
import { City } from './world/City.js';
import { VFX } from './world/VFX.js';
import { Interactables } from './gameplay/Interactables.js';
import { MissionManager } from './gameplay/Missions.js';
import { InsightSystem } from './gameplay/InsightSparks.js';
import { Pickup } from './gameplay/Pickups.js';
import { ZombieSystem } from './gameplay/Zombies.js';
import { Combat } from './gameplay/Combat.js';
import { Player } from './player/Player.js';
import { CameraRig } from './player/CameraRig.js';
import { SolarDistrict } from './world/districts/Solar.js';
import { WaterDistrict } from './world/districts/Water.js';
import { GardenDistrict } from './world/districts/Garden.js';
import { CoreDistrict } from './world/districts/Core.js';
import { PlazaDistrict } from './world/districts/Plaza.js';

const SETTINGS_KEY = 'restart_settings_v1';
// Opening cinematic: once per browser session (launch), not on every reload.
const INTRO_SEEN_KEY = 'restart_intro_seen';
// A timer-based yield keeps loading progress moving even when the tab is
// throttled (background tab / remote preview).
const nextFrame = () => new Promise((r) => {
  if (document.hidden) { r(); return; }
  setTimeout(r, 12);
});

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = 'loading';
    this.clock = new THREE.Clock();
    this.playTime = 0;
    this.saveTimer = 0;
    this.menuAngle = 0;
    this.everStarted = false;
    this.respawning = false;
    this.pendingMission = 0;
    this.restoredDistricts = new Set();
    this.ending = null;
    this.endingSequence = null;
    this.completed = false;
    this.relayMemories = [];
    this.errors = [];
    this.quality = 'high';

    window.addEventListener('error', (e) => {
      this.errors.push(String(e.message || e.error));
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.errors.push(String(e.reason));
    });
  }

  async boot() {
    const stored = this._loadSettings();
    this.uiSettings = stored;

    // ---- renderer ---------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const pr = this._pixelRatio(stored.quality);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = stored.quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d0f);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(38, 18, 38);

    this.ui = new UI(this.camera);
    this.ui.setLoading(0.02, 'CALIBRATING OPTICS…');
    await nextFrame();

    this.audio = new AudioEngine();
    this.audio.setMasterVolume(stored.master);
    this.audio.setMusicVolume(stored.music);
    this.audio.setMusicState('menu');
    this.ui.applySettings(stored);
    this.ui.setSubtitles(stored.subtitles !== false);
    this.intro = new IntroCinematic({
      audio: this.audio,
      subtitles: stored.subtitles !== false,
    });
    window.addEventListener('pointerdown', () => this.audio.init(), { once: true });

    this.input = new Input(this.canvas);
    this.input.sensitivity = stored.sensitivity;
    this.shake = new Shake();

    this.colliders = new Colliders(16);
    this.vfx = new VFX(this.scene);
    this.interactables = new Interactables({ scene: this.scene, vfx: this.vfx });

    this.ui.setLoading(0.08, 'GENERATING PBR SURFACES…');
    await nextFrame();
    this.materials = createMaterials();

    this.ui.setLoading(0.28, 'LIGHTING THE ATMOSPHERE…');
    await nextFrame();
    this.sky = new SkyRig(this.scene, renderer, stored.quality);
    this.sun = this.sky.sun;
    this.sky.setRestoration(0, true);

    this.ui.setLoading(0.36, 'RECONSTRUCTING ASTER…');
    await nextFrame();
    this.city = new City({
      scene: this.scene,
      colliders: this.colliders,
      materials: this.materials,
      vfx: this.vfx,
    });
    this.city.build();

    this.ui.setLoading(0.56, 'WAKING THE RESTORER…');
    await nextFrame();

    this.player = new Player({
      scene: this.scene,
      camera: this.camera,
      colliders: this.colliders,
      input: this.input,
      audio: this.audio,
      vfx: this.vfx,
    });
    this.cameraRig = new CameraRig(this.camera, this.colliders);
    this.player.cameraRig = this.cameraRig;
    this.player.onFall = () => {
      this.sparks.struggle('fall', 1);
      this.sparks.struggle('solar_jump', 1);
      this.respawn();
    };
    this.player.onLand = (impact) => {
      this.shake.add(0.05 + impact * 0.16);
    };

    this.missions = new MissionManager({ ui: this.ui, audio: this.audio });
    this.missions.onAllComplete = (mission) => this.onMissionComplete(mission);
    this.missions.onObjective = () => this.sparks && this.sparks.noteProgress();
    this.sparks = new InsightSystem({
      ui: this.ui, audio: this.audio, missions: this.missions,
      player: this.player, vfx: this.vfx,
    });
    this._registerSparks();

    this.pickups = [];
    this._buildDistricts();
    this._buildMotes();
    this._tooFar = false;

    this.zombies = new ZombieSystem({
      scene: this.scene,
      colliders: this.colliders,
      player: this.player,
      audio: this.audio,
      vfx: this.vfx,
      ui: this.ui,
    });
    this.combat = new Combat({
      scene: this.scene,
      camera: this.camera,
      colliders: this.colliders,
      player: this.player,
      ui: this.ui,
      audio: this.audio,
      vfx: this.vfx,
      shake: this.shake,
      zombies: this.zombies,
    });
    this.combat.onDeath = () => this.playerDown();
    this.zombies.onAttackPlayer = (damage, zombie) => this.combat.hurt(damage, zombie);
    this.zombies.onKilled = (zombie) => this.combat.dropAmmo(zombie.position);

    this.ui.setLoading(0.66, 'LOADING CHARACTER RIG…');
    window.__BOOT_STAGE = 'pre-player-load';
    await nextFrame();
    window.__BOOT_STAGE = 'player-loading';
    await this.player.load((p) => {
      window.__BOOT_STAGE = 'player-progress-' + p.toFixed(2);
      this.ui.setLoading(0.66 + p * 0.24, p < 1 ? 'LOADING CHARACTER RIG…' : 'BINDING ANIMATION CLIPS…');
    });
    window.__BOOT_STAGE = 'player-loaded';
    this.player.group.visible = false;
    this.player.onNoise = (pos, radius) => this.zombies?.emitNoise(pos, radius);

    this.ui.setLoading(0.93, 'COMPILING SHADERS…');
    window.__BOOT_STAGE = 'compile';
    await nextFrame();
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      /* non fatal */
    }

    this._setupCheckpoints();
    this._bindUI();
    this._bindInput();
    this._applyQuality(stored.quality, true);

    window.addEventListener('resize', () => this._onResize());
    this._setupComposer();
    this._onResize();

    this.ui.setLoading(1, 'READY');
    await nextFrame();
    this.ui.hideLoading();
    this.state = 'menu';
    this.ui.showMenu(SaveSystem.exists());
    this.ui.showHUD(false);

    this.clock.start();
    this.lastFrameTime = performance.now();
    this._tickBound = () => this._tick();
    requestAnimationFrame(this._tickBound);
    // Watchdog: browsers stop rAF in background tabs; keep simulation alive
    // so the game never appears frozen when the window is re-shown.
    this._watchdog = setInterval(() => {
      if (performance.now() - this.lastFrameTime > 120) this._frameOnce();
    }, 40);
    this._exposeDebug();

    const autostart = sessionStorage.getItem('restart_autostart');
    const autoresume = sessionStorage.getItem('restart_autoresume');
    if (autostart) {
      sessionStorage.removeItem('restart_autostart');
      this.newGame(true);
    } else if (autoresume) {
      sessionStorage.removeItem('restart_autoresume');
      this.continueGame();
    } else if (!sessionStorage.getItem(INTRO_SEEN_KEY)) {
      // First launch of this session: story cinematic before the main menu.
      sessionStorage.setItem(INTRO_SEEN_KEY, '1');
      this.playOpeningCinematic();
    }
  }

  _loadSettings() {
    let s = { master: 0.8, music: 0.55, sensitivity: 1, quality: 'high', bloom: true, subtitles: true };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) s = { ...s, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return s;
  }

  _pixelRatio(quality) {
    const dpr = window.devicePixelRatio || 1;
    if (quality === 'high') return Math.min(dpr, 1.75);
    if (quality === 'medium') return Math.min(dpr, 1.25);
    return 0.9;
  }

  _setupComposer() {
    const pr = this._pixelRatio(this.quality);
    const samples = this.quality === 'high' ? 4 : 0;
    const rt = new THREE.WebGLRenderTarget(
      Math.floor(window.innerWidth * pr),
      Math.floor(window.innerHeight * pr),
      { type: THREE.HalfFloatType, samples }
    );
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42, 0.62, 0.86
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.bloomEnabled = this.uiSettings.bloom && this.quality !== 'low';
    this.bloomPass.enabled = this.bloomEnabled;
  }

  _applyQuality(quality, initial = false) {
    this.quality = quality;
    const pr = this._pixelRatio(quality);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = quality !== 'low';
    if (this.sun) {
      this.sun.castShadow = quality !== 'low';
      const size = quality === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        if (this.sun.shadow.map) {
          this.sun.shadow.map.dispose();
          this.sun.shadow.map = null;
        }
      }
    }
    this.city?.setRestoration(this.city.restoration);
    if (!initial && this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.bloomEnabled = this.uiSettings.bloom && quality !== 'low';
      this.bloomPass.enabled = this.bloomEnabled;
    }
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this._pixelRatio(this.quality));
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) this.bloomPass.resolution.set(w, h);
  }

  _buildDistricts() {
    const ctx = {
      scene: this.scene,
      colliders: this.colliders,
      materials: this.materials,
      vfx: this.vfx,
      audio: this.audio,
      ui: this.ui,
      missions: this.missions,
      sparks: this.sparks,
      interactables: this.interactables,
      player: this.player,
      city: this.city,
      vegetation: this.city.vegetation,
      pickups: this.pickups,
      onRestored: (name) => this.onDistrictRestored(name),
      onCoreActivated: () => this.startEnding(),
    };
    this.plaza = new PlazaDistrict(ctx);
    this.solar = new SolarDistrict(ctx);
    this.water = new WaterDistrict(ctx);
    this.garden = new GardenDistrict(ctx);
    this.core = new CoreDistrict(ctx);
    this.districts = [this.plaza, this.solar, this.water, this.garden, this.core];
    this.plaza.build();
    this.solar.build();
    this.water.build();
    this.garden.build();
    this.core.build();
    this.core.setRelayPositions([this.solar.relayPos, this.water.relayPos, this.garden.relayPos]);
    this.districtByName = {
      plaza: this.plaza, solar: this.solar, water: this.water, garden: this.garden, core: this.core,
    };
  }

  _buildMotes() {
    const defs = [
      { id: 'mote_plaza', pos: [12, 1.3, 18] },
      { id: 'mote_solar', pos: [46, 3.2, 1.5] },
      { id: 'mote_water', pos: [-64, 1.3, 10] },
      { id: 'mote_garden_a', pos: [10, 1.3, 80] },
      { id: 'mote_garden_b', pos: [-8, 1.3, 104] },
      { id: 'mote_core', pos: [0, 1.3, -58] },
    ];
    for (const d of defs) {
      const p = new Pickup({
        scene: this.scene,
        position: new THREE.Vector3(...d.pos),
        color: 0xffb347,
        kind: 'mote',
        audio: this.audio,
        vfx: this.vfx,
        onCollect: () => {
          this.missions.addEnergy(1);
          this.ui.toast(`ENERGY ${this.missions.energy}/${this.missions.energyMax}`);
          this.save();
        },
      });
      p.id = d.id;
      this.pickups.push(p);
      this.motes = this.motes || [];
      this.motes.push(p);
    }
  }

  _registerSparks() {
    const h = this.sparks;
    h.register('solar_jump', {
      hint: 'Hold SHIFT at the edge of a gap, then jump. Running leaps clear 4 metres. The Insight Surge also grants a mid-air bounce.',
      assistLabel: 'Extended Bounce',
    });
    h.register('water_nodes', {
      hint: 'Numbers are painted faintly on each pedestal. Node 1 feeds SOUTH, Node 2 feeds EAST, Node 3 feeds WEST. Rotate until each arrow faces that way.',
      assistLabel: 'Routing Insight',
    });
    h.register('garden_cells', {
      hint: 'One cell sits on the wrecked bus roof, one in the rubble beside the lift, one on the east ledge. Stack crates to climb.',
      assistLabel: 'Cell Tracker',
    });
    h.register('garden_lift', {
      hint: 'The lift needs all three cells. Once powered it rises and falls by itself — step on at the bottom and ride up to the Bloom Console.',
      assistLabel: 'Lift Insight',
    });
    this.sparks.register('fall', {
      hint: 'Falling costs nothing but time. Your checkpoint and every repaired panel are still yours.',
      assistLabel: 'Steady Feet',
    });
  }

  _setupCheckpoints() {
    this.checkpoints = [
      { name: 'Arrival Plaza', position: new THREE.Vector3(0, 0.2, 31), yaw: Math.PI, radius: 8 },
      { name: 'Solar Walkway', position: new THREE.Vector3(37, 2.16, 0), yaw: Math.PI / 2, radius: 6 },
      { name: 'Water Station', position: new THREE.Vector3(-56, 0.2, 0), yaw: -Math.PI / 2, radius: 6 },
      { name: 'Overgrown Courtyard', position: new THREE.Vector3(0, 0.2, 57), yaw: 0, radius: 7 },
      { name: 'Restart Core', position: new THREE.Vector3(0, 0.2, -62), yaw: Math.PI, radius: 7 },
    ];
    this.checkpointIndex = 0;
  }

  _bindUI() {
    this.ui.setCallbacks({
      newGame: () => this.newGame(),
      continueGame: () => this.continueGame(),
      replayCinematic: () => this.replayCinematic(),
      resume: () => this.resume(),
      restartCheckpoint: () => this.restartAtCheckpoint(),
      toMenu: () => this.toMenu(),
      missionContinue: () => this.continueAfterMission(),
      endingMenu: () => this.toMenu(),
      onSettings: (s) => this.applySettings(s),
      onDialogueLine: (info) => {
        this.audio.sfx('relayVoice', { volume: info.kind === 'relay' ? 0.5 : 0.32 });
      },
    });
    this.ui.applySettings(this.uiSettings);
  }

  _bindInput() {
    this.input.onEscape = () => {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state !== 'loading' && !this.ui.el.settings.classList.contains('hidden')) {
        this.ui.hideSettings();
      }
    };
    this.input.onLockLost = () => {
      if (this.state === 'playing' && !this.respawning) {
        this.pause();
      }
    };
    this.input.onKey = (code) => {
      if (this.state === 'playing') {
        if (code === 'KeyH') this.sparks.activate();
        if (code === 'KeyF') this._toggleFullscreen();
      }
    };
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  applySettings(s) {
    this.uiSettings = { ...this.uiSettings, ...s };
    this.audio.setMasterVolume(this.uiSettings.master);
    this.audio.setMusicVolume(this.uiSettings.music);
    this.input.sensitivity = this.uiSettings.sensitivity;
    this.ui.setSubtitles(this.uiSettings.subtitles !== false);
    this.bloomEnabled = this.uiSettings.bloom && this.quality !== 'low';
    if (this.bloomPass) this.bloomPass.enabled = this.bloomEnabled;
    this._applyQuality(this.uiSettings.quality);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.uiSettings));
    } catch {
      /* ignore */
    }
  }

  // ==================================================================
  /**
   * New Game starts the run. The opening cinematic is a launch-time sequence
   * (see playOpeningCinematic) and is rewatchable from the main menu, so it is
   * never replayed here. A reload (restarting from an existing session) picks
   * up with fromBoot=true.
   */
  newGame(fromBoot = false) {
    this.audio.init();
    if (!fromBoot && this.everStarted) {
      sessionStorage.setItem('restart_autostart', '1');
      window.location.reload();
      return;
    }
    this.everStarted = true;
    SaveSystem.clear();
    this._beginFreshRun();
  }

  /**
   * Play the opening cinematic, then land on the main menu. Never starts
   * gameplay: the player chooses PLAY / NEW GAME afterwards.
   */
  playOpeningCinematic({ replay = false } = {}) {
    if (!this.intro || this.intro.playing) return Promise.resolve('busy');
    this.audio?.init();
    this.state = 'intro';
    this.ui.hideMenu();
    this.ui.showHUD(false);
    this.ui.hideDialogue();
    this.ui.setPrompt(null);
    this.ui.setLetterbox(false);
    this.intro.subtitles = this.uiSettings.subtitles !== false;
    this.audio?.setMusicState('intro');
    return this.intro.play().then((result) => {
      this.state = 'menu';
      this.audio?.setMusicState('menu');
      this.introResult = result;
      this.ui.showMenu(SaveSystem.exists());
      this.ui.showHUD(false);
      if (replay && result === 'unavailable') {
        this.ui.toast('CINEMATIC UNAVAILABLE — restart_intro.mp4 NOT FOUND', 'cyan');
      }
      return result;
    });
  }

  replayCinematic() {
    return this.playOpeningCinematic({ replay: true });
  }

  /** Kept for existing callers: plays the cinematic, then calls back. */
  _playIntro(done) {
    this.playOpeningCinematic().then((result) => done && done(result));
  }

  _beginFreshRun() {
    this.startFresh();
    this.state = 'playing';
    this.audio.setMusicState('exploration');
    this.ui.hideMenu();
    this.ui.showHUD(true);
    this.ui.setLetterbox(false);
    this.ui.el.ending.classList.add('hidden');
    this.player.setControl(true);
    this.player.group.visible = true;
    this.cameraRig.initialized = false;
    this.input.requestLock();
    this.ui.showInsight(false);
    this.save();
  }

  startFresh() {
    this.playTime = 0;
    this.completed = false;
    this.relayMemories = [];
    this.ending = null;
    this.endingSequence = null;
    this.restoredDistricts = new Set();
    this.checkpointIndex = 0;
    this.player.teleport(new THREE.Vector3(0, 0.2, 32), Math.PI);
    this.cameraRig.yaw = 0;
    this.cameraRig.pitch = 0.16;
    this.cameraRig.initialized = false;
    this.missions.energy = 0;
    this.missions.sparks = 0;
    this.ui.hideDialogue();
    this.missions.begin(0);
    this._grantMemory(0);
    this.sky.setRestoration(0, true);
    this.city.setRestoration(0);
    this.core.setRelays(0, true);
    this.audio.setRestoration(0);
    this.ui.setMission(this.missions.mission, this.missions.status);
    this.ui.setStats({ energy: 0, energyMax: 9, sparks: 0 });
    this.solar.setState({ repaired: 0 });
    this.water.setState({ rotations: [0, 0, 0] });
    this.garden.setState({ cells: [false, false, false], cellsCount: 0 });
    this.plaza.setState({});
    this.checkpoints.forEach((c) => (c.reached = false));
    this.combat.reset();
    this.zombies.reset();
    this.zombies.scatter(new THREE.Vector3(0, 0, 32), 20);
  }

  continueGame() {
    const data = SaveSystem.load();
    if (!data) {
      this.newGame();
      return;
    }
    if (this.everStarted) {
      sessionStorage.setItem('restart_autoresume', '1');
      window.location.reload();
      return;
    }
    this.audio.init();
    this.audio.setMusicState('exploration');
    this.everStarted = true;
    this.state = 'playing';
    this.ui.hideMenu();
    this.ui.showHUD(true);
    this.player.group.visible = true;
    this.applySavedState(data);
    if (this.completed) {
      this._showEndingCard();
      return;
    }
    if (this.state === 'playing') {
      this.player.setControl(true);
      this.input.requestLock();
    }
  }

  _showEndingCard() {
    this.state = 'ending';
    this.audio.setMusicState('ending');
    this.ui.showHUD(false);
    this.ui.setLetterbox(false);
    this.ui.hideDialogue();
    this.player.setControl(false);
    this.ui.showEnding({
      energy: this.missions.energy,
      energyMax: this.missions.energyMax,
      sparks: this.missions.sparks,
      time: this.playTime,
    });
  }

  applySavedState(data) {
    this.playTime = data.time || 0;
    this.completed = !!data.completed;
    this.missions.restore(data.mission || {});

    // v1 saves used three missions; map them onto the five chapters.
    const legacyIndex = data.mission?.index ?? 0;
    let chapter = data.chapter;
    if (chapter === undefined) chapter = legacyIndex >= 2 ? 4 : legacyIndex;
    chapter = Math.max(0, Math.min(4, chapter));
    this.missions.index = chapter;
    this.missions.active = !this.completed;
    if (data.legacy) {
      const valid = new Set(this.missions.mission.objectives.map((o) => o.id));
      for (const key of Object.keys(this.missions.status)) {
        if (!valid.has(key)) delete this.missions.status[key];
      }
      for (const o of this.missions.mission.objectives) this.missions.status[o.id] = false;
      if (chapter > 0) this.missions.status.reach = true;
      this.relayMemories = [];
    }
    this.relayMemories = Array.isArray(data.memories) && data.memories.length
      ? data.memories.slice()
      : [...new Set([...this.relayMemories, chapter])];

    const d = data.districts || {};
    this.plaza.setState(d.plaza);
    this.solar.setState(d.solar);
    this.water.setState(d.water);
    this.garden.setState(d.garden);
    this.combat.restore(data.combat);
    this.zombies.reset();

    this.restoredDistricts = new Set(data.restored || []);
    const count = ['solar', 'water', 'garden'].filter((n) => this.restoredDistricts.has(n)).length;
    this.core.setRelays(count, true);
    this.core.setState(d.core);
    const visual = clamp(count / 3 + (this.restoredDistricts.has('plaza') ? 0.08 : 0), 0, 1);
    this.city.setRestoration(visual);
    this.sky.setRestoration(clamp(count / 3 * 0.94 + (this.restoredDistricts.has('plaza') ? 0.04 : 0), 0, 1), true);
    this.audio.setRestoration(count / 3);

    if (data.motes && this.motes) {
      data.motes.forEach((c, i) => {
        if (c && this.motes[i]) this.motes[i].setCollected(true);
      });
    }
    if (data.cells && this.garden.cellPickups) {
      data.cells.forEach((c, i) => {
        if (c && this.garden.cellPickups[i]) this.garden.cellPickups[i].setCollected(true);
      });
    }

    this.checkpointIndex = data.checkpoint || chapter;
    const p = data.player;
    if (p) {
      this.player.teleport(new THREE.Vector3(p.x, p.y, p.z), p.facing ?? Math.PI);
      this.cameraRig.yaw = (p.facing ?? Math.PI) - Math.PI;
    } else {
      const cp = this.checkpoints[this.checkpointIndex] || this.checkpoints[0];
      this.player.teleport(cp.position.clone(), cp.yaw);
      this.cameraRig.yaw = cp.yaw - Math.PI;
    }
    this.zombies.scatter(this.player.position, 20);
    this.cameraRig.pitch = 0.16;
    this.cameraRig.initialized = false;

    if (data.legacy && chapter === 4 && count === 3) this.missions.status.relays = true;
    if (this.completed) {
      for (const o of this.missions.mission.objectives) this.missions.status[o.id] = true;
    }

    this.ui.setMission(this.missions.mission, this.missions.status);
    this.ui.setStats({ energy: this.missions.energy, energyMax: 9, sparks: this.missions.sparks });
    this.player.group.visible = true;

    if (this.completed) return;

    // A save taken at a hand-off continues into the next chapter instead of
    // stranding the player on an already-complete objective list.
    const mission = this.missions.mission;
    const allDone = mission.objectives.every((o) => this.missions.status[o.id]);
    if (chapter < 4 && allDone) {
      this.beginMission(chapter + 1, true);
    } else if (chapter === 4 && this.missions.status.core && !this.missions.status.signal) {
      this.startEnding();
    }
  }

  beginMission(index, travel = false) {
    this.pendingMission = index;
    this.missions.begin(index);
    this.sparks.noteProgress();
    this._grantMemory(index);
    this.checkpointIndex = index;
    if (this.checkpoints[index]) this.checkpoints[index].reached = true;
    if (travel) this._travelToChapter(index);
    this.save();
  }

  /** Chapter hand-off: fade, move to the district approach, fade back in. */
  _travelToChapter(index) {
    const cp = this.checkpoints[index];
    if (!cp) return;
    this.player.setControl(false);
    this.ui.fade(true, false);
    setTimeout(() => {
      this.player.teleport(cp.position.clone(), cp.yaw);
      this.cameraRig.yaw = cp.yaw - Math.PI;
      this.cameraRig.pitch = 0.16;
      this.cameraRig.initialized = false;
      this.checkpointIndex = index;
      this.zombies.scatter(this.player.position, 20);
      this.ui.fade(false);
      if (this.state === 'playing') this.player.setControl(true);
      this.save();
    }, 620);
  }

  /** RELAY remembers one more piece of itself per chapter. */
  _grantMemory(chapter) {
    const memory = RELAY_MEMORIES[chapter];
    if (!memory || this.relayMemories.includes(chapter)) return;
    this.relayMemories.push(chapter);
    setTimeout(() => {
      if (this.state === 'loading' || this.state === 'menu') return;
      this.ui.toast(memory.title, 'cyan');
      this.ui.dialogue([{ speaker: 'RELAY', text: memory.text, ms: 9000 }]);
      this.audio.sfx('relayVoice', { volume: 0.4 });
    }, chapter === 0 ? 5200 : 4200);
  }

  onMissionComplete(mission) {
    this.save();
    this.ui.setPrompt(null);
    if (mission.id >= 4) return;
    this.audio.sfx('missionComplete');
    this.audio.setMusicState('relief');
    this.audio.relief(8);
    this.state = 'missionScreen';
    this.player.setControl(false);
    this.input.exitLock();
    this.ui.showMissionComplete(
      mission.title,
      mission.copy,
      `CHAPTER ${String(mission.chapter || mission.id + 1).padStart(2, '0')} COMPLETE`
    );
    this.pendingMission = mission.id + 1;
  }

  continueAfterMission() {
    this.ui.hideMissionComplete();
    this.state = 'playing';
    this.audio.setMusicState('exploration');
    this.player.setControl(true);
    this.beginMission(this.pendingMission, true);
    this.input.requestLock();
    this.save();
  }

  onDistrictRestored(name) {
    this.restoredDistricts.add(name);
    const restoredCount = ['solar', 'water', 'garden'].filter((n) => this.restoredDistricts.has(n)).length;
    const visualProgress = restoredCount / 3;
    this.city.setRestoration(clamp(visualProgress + (this.restoredDistricts.has('plaza') ? 0.08 : 0), 0, 1));
    this.sky.setRestoration(clamp(visualProgress * 0.94 + (this.restoredDistricts.has('plaza') ? 0.04 : 0), 0, 1));
    this.audio.setRestoration(visualProgress);
    // Restoration is a moment of earned relief, not a victory fanfare
    this.audio.relief(10);
    this.core.setRelays(restoredCount);
    if (name !== 'plaza') {
      this.ui.toast(`${name.toUpperCase()} DISTRICT RESTORED — RELAY ${restoredCount}/3`, 'cyan big');
    }
    this.sparks.noteProgress();
    this.save();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.setMusicPaused(true);
    this.player.setControl(false);
    this.input.exitLock();
    this.ui.setPrompt(null);
    this.ui.showPause({
      energy: this.missions.energy,
      energyMax: this.missions.energyMax,
      sparks: this.missions.sparks,
      time: this.playTime,
    });
    this.save();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hidePause();
    this.ui.hideSettings();
    this.state = 'playing';
    this.audio.setMusicPaused(false);
    this.player.setControl(true);
    this.input.requestLock();
  }

  restartAtCheckpoint() {
    this.ui.hidePause();
    this.ui.hideSettings();
    this.state = 'playing';
    this.player.setControl(true);
    this.input.requestLock();
    this.combat.revive();
    this.zombies.scatter(this.player.position, 15);
    this.respawn(true);
  }

  toMenu() {
    this.save();
    this.combat.aimHeld = false;
    this.combat.fireHeld = false;
    this.combat.aiming = false;
    this.combat.laser.visible = false;
    this.combat.laserDot.visible = false;
    this.state = 'menu';
    this.everStarted = true;
    this.input.exitLock();
    this.player.setControl(false);
    this.ui.hidePause();
    this.ui.hideSettings();
    this.ui.hideMissionComplete();
    this.ui.hideDeath();
    this.ui.setLetterbox(false);
    this.ui.el.ending.classList.add('hidden');
    this.ui.showHUD(false);
    this.ui.setPrompt(null);
    this.ui.showInsight(false);
    this.ui.setSurge(false, 0);
    this.ui.hideDialogue();
    this.renderer.toneMappingExposure = 1;
    this.endingSequence = null;
    this.audio.setMusicPaused(false);
    this.audio.setThreatLevel(0, false);
    this.audio.setMusicState('menu');
    this.ui.showMenu(SaveSystem.exists());
  }

  respawn(fromMenu = false) {
    if (this.respawning) return;
    this.respawning = true;
    this.player.setControl(false);
    this.ui.fade(true, false);
    setTimeout(() => {
      const cp = this.checkpoints[this.checkpointIndex];
      this.player.teleport(cp.position.clone(), cp.yaw);
      this.cameraRig.yaw = cp.yaw - Math.PI;
      this.cameraRig.pitch = 0.18;
      this.cameraRig.initialized = false;
      this.player.setControl(true);
      this.respawning = false;
      this.ui.fade(false);
      // Back in safety: let the score breathe out after the danger
      this.audio.setMusicState('exploration');
      this.audio.setThreatLevel(0, false);
      this.audio.relief(6);
      this.ui.toast('CHECKPOINT RESTORED — NOTHING LOST', 'cyan');
      if (fromMenu) this.save();
    }, 560);
  }

  /** Health hit zero: hold on the death card, then return to the checkpoint. */
  playerDown() {
    if (this.respawning || this.state !== 'playing') return;
    this.respawning = true;
    this.state = 'dying';
    this.combat.aimHeld = false;
    this.combat.fireHeld = false;
    this.player.aiming = false;
    this.player.setControl(false);
    this.input.exitLock();
    this.ui.setPrompt(null);
    this.ui.showDeath();
    this.audio.sfx('death');
    // The chase drops away; the score holds its breath on a low danger bed
    this.audio.setThreatLevel(0.6, false);
    this.audio.setMusicState('danger');
    setTimeout(() => {
      const cp = this.checkpoints[this.checkpointIndex];
      this.player.teleport(cp.position.clone(), cp.yaw);
      this.cameraRig.yaw = cp.yaw - Math.PI;
      this.cameraRig.pitch = 0.18;
      this.cameraRig.initialized = false;
      this.combat.revive();
      this.zombies.scatter(this.player.position, 15);
      this.state = 'playing';
      this.player.setControl(true);
      this.respawning = false;
      this.ui.hideDeath();
      this.audio.setMusicState('exploration');
      this.audio.relief(6);
      this.ui.toast('CHECKPOINT RESTORED — NOTHING LOST', 'cyan');
      this.input.requestLock();
      this.save();
    }, 1250);
  }

  startEnding() {
    if (this.completed) return;
    if (this.state === 'cinematic' || this.state === 'ending') return;
    this.combat.aimHeld = false;
    this.combat.fireHeld = false;
    this.combat.aiming = false;
    this.combat.laser.visible = false;
    this.combat.laserDot.visible = false;
    this.audio.setThreatLevel(0, false);
    this.audio.setMusicState('ending');
    this.core.restore();
    this.endingSequence = new EndingSequence(this);
    this.endingSequence.start();
    this.save();
  }

  _updateEnding(dt) {
    if (this.endingSequence) this.endingSequence.update(dt);
  }

  // ==================================================================
  save() {
    if (!this.player || !this.player.loaded || !this.missions) return;
    SaveSystem.save({
      mission: this.missions.toJSON(),
      chapter: this.missions.index,
      memories: [...this.relayMemories],
      completed: this.completed,
      player: {
        x: this.player.position.x, y: this.player.position.y, z: this.player.position.z,
        facing: this.player.facing,
      },
      checkpoint: this.checkpointIndex,
      districts: {
        plaza: this.plaza.getState(),
        solar: this.solar.getState(),
        water: this.water.getState(),
        garden: this.garden.getState(),
        core: this.core.getState(),
      },
      motes: this.motes.map((m) => m.collected),
      cells: this.garden.cellPickups.map((p) => p.collected),
      restored: [...this.restoredDistricts],
      combat: this.combat.toJSON(),
      time: this.playTime,
    });
    this.ui.el.continueBtn.disabled = false;
  }

  _tick() {
    requestAnimationFrame(this._tickBound);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.frame(dt);
    this.input.endFrame();
  }

  _frameOnce() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.frame(dt);
    this.input.endFrame();
  }

  /** Synchronous simulation stepping for automated verification. */
  advance(seconds, step = 1 / 60) {
    this._noRender = true;
    let t = 0;
    while (t < seconds) {
      this.frame(Math.min(step, seconds - t));
      this.input.endFrame();
      t += step;
    }
    this._noRender = false;
    this.lastFrameTime = performance.now();
  }

  frame(dt) {
    this.ui.update(dt);
    const camera = this.camera;

    if (this.state === 'loading' || this.state === 'menu' || this.state === 'intro') {
      this.menuAngle += dt * 0.045;
      const a = this.menuAngle;
      camera.position.set(Math.cos(a) * 47, 17 + Math.sin(a * 0.6) * 3, Math.sin(a) * 47 - 5);
      camera.lookAt(0, 5, -6);
      camera.fov = 58;
      camera.updateProjectionMatrix();
      this.sky.update(dt, camera.position, camera);
      this.city.update(dt, camera.position, camera);
      this.vfx.update(dt, camera, this.city.restoration);
      this.audio.update(dt, this.city.restoration, this.player.position);
      this.render();
      return;
    }

    if (this.state === 'paused' || this.state === 'missionScreen' || this.state === 'ending' || this.state === 'dying') {
      this.sky.update(dt, this.player.position, camera);
      this.vfx.update(dt, camera, this.city.restoration);
      this.city.update(dt, this.player.position, camera);
      // Keep the score alive here so pause/relief crossfades stay smooth.
      this.audio.update(dt, this.city.restoration, this.player.position);
      this.render();
      return;
    }

    if (this.state === 'playing') {
      this.playTime += dt;
      this.combat.aimHeld = this.input.isMouseDown(2);
      this.combat.fireHeld = this.input.isMouseDown(0);
      this.player.aiming = this.combat.refreshAim();
      this.player.aimTargetYaw = this.combat.aimYaw;
      this.player.update(dt);
      this.combat.update(dt);
      this.zombies.update(dt, this.player.position, this.combat.alive);

      // Threat level feeds the ambience: muffled groans and shifting weight
      // rise as the Hollowed close in, without ever drowning the footsteps.
      const threat = this.zombies.nearestTo(this.player.position, 46);
      let danger = 0;
      if (threat) {
        const d = Math.hypot(threat.position.x - this.player.position.x, threat.position.z - this.player.position.z);
        danger = Math.max(0, Math.min(1, 1 - d / 46));
      }
      // Distant groans (ambience) follow proximity; the urgent music layer only
      // starts when a Hollowed is actually chasing or attacking.
      this.audio.setThreat(danger);
      const hunting = this.zombies.zombies.some((z) => !z.dead && z.state === 'chase');
      this.audio.setThreatLevel(danger, hunting);

      for (const d of this.districts) d.update(dt, this.player.position);

      // ride the courtyard lift
      if (this.garden.liftDelta && this.player.groundBox === this.garden.liftBox) {
        this.player.position.y += this.garden.liftDelta;
        this.player.group.position.y = this.player.position.y;
      }

      for (const p of this.pickups) p.update(dt, this.player.position);
      this.interactables.update(dt);

      // interaction prompt + interaction
      const near = this.interactables.find(this.player.position);
      this.ui.setPrompt(near ? near.label : null);
      this._interactCooldown = Math.max(0, (this._interactCooldown || 0) - dt);
      if (near && this.input.wasPressed('KeyE') && this._interactCooldown <= 0) {
        this._interactCooldown = 0.35;
        this.audio.sfx('interact');
        near.onInteract(near);
      }
      if (this.input.wasPressed('Escape') && this.state === 'playing') this.pause();

      // district zones
      for (const d of this.districts) {
        if (!d.zone) continue;
        const dist = Math.hypot(this.player.position.x - d.zone.x, this.player.position.z - d.zone.z);
        if (dist < d.zone.r && !d._entered) {
          d._entered = true;
          d.enter?.();
          if (d === this.solar) this.sparks.setActive('solar_jump', true);
        }
      }

      // checkpoints
      for (let i = 0; i < this.checkpoints.length; i++) {
        const cp = this.checkpoints[i];
        const d = Math.hypot(this.player.position.x - cp.position.x, this.player.position.z - cp.position.z);
        if (d < cp.radius && i !== this.checkpointIndex && !cp.reached) {
          cp.reached = true;
          this.checkpointIndex = i;
          this.audio.sfx('checkpoint');
          this.ui.toast(`CHECKPOINT — ${cp.name.toUpperCase()}`, 'cyan');
          this.save();
        }
      }

      // objective marker + compass
      this.ui.updateNavigation(this._objectiveTarget(), this.cameraRig.yaw);

      // sky / city / vfx / audio
      this.sky.update(dt, this.player.position, camera);
      this.city.update(dt, this.player.position, camera);
      this.vfx.update(dt, camera, this.city.restoration);
      this.audio.update(dt, this.city.restoration, this.player.position);

      // camera last so it follows the new position
      const shaking = this.shake.update(dt);
      this.cameraRig.update(dt, this.player.position, this.input, {
        running: this.input.isRunning && this.player.speed2D > 2,
        speed: this.player.speed2D,
        shake: shaking,
        aiming: this.combat.aiming,
      });

      this.sparks.update(dt, this._missionHint());
      this.saveTimer += dt;
      if (this.saveTimer > 25) {
        this.saveTimer = 0;
        this.save();
      }
      this.render();
      return;
    }

    if (this.state === 'cinematic') {
      this.player.update(dt);
      this.zombies.update(dt, this.player.position, false);
      for (const d of this.districts) d.update(dt, this.player.position);
      this.interactables.update(dt);
      this.vfx.update(dt, camera, this.city.restoration);
      this.city.update(dt, this.player.position, camera);
      this.sky.update(dt, this.player.position, camera);
      this.audio.update(dt, 1, this.player.position);
      this.cameraRig.update(dt, this.player.position, this.input, { paused: true });
      this._updateEnding(dt);
      this.render();
      return;
    }

    this.render();
  }

  _objectiveTarget() {
    if (this.missions.index === 0 && !this.missions.status.reach) {
      return { x: 0, y: 0, z: 7, label: 'PLAZA MARKER' };
    }
    let best = null;
    let bestD = Infinity;
    for (const it of this.interactables.items) {
      if (!it.active || it.done || !it.visible) continue;
      const d = Math.hypot(this.player.position.x - it.position.x, this.player.position.z - it.position.z);
      if (d < bestD && d < 150) {
        bestD = d;
        best = it;
      }
    }
    if (best) return { x: best.position.x, y: best.position.y, z: best.position.z, label: best.label };
    return null;
  }

  _missionHint() {
    return CHAPTER_HINTS[this.missions.index] || null;
  }

  render() {
    if (this._noRender) return;
    if (this.bloomEnabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ==================================================================
  _exposeDebug() {
    const game = this;
    window.__RESTART = {
      game,
      get state() {
        return game.state;
      },
      stats() {
        return {
          state: game.state,
          mission: game.missions.index,
          chapter: game.missions.index + 1,
          memories: [...game.relayMemories],
          completed: game.completed,
          objectiveStatus: { ...game.missions.status },
          energy: game.missions.energy,
          sparks: game.missions.sparks,
          player: {
            x: +game.player.position.x.toFixed(2),
            y: +game.player.position.y.toFixed(2),
            z: +game.player.position.z.toFixed(2),
            grounded: game.player.grounded,
            loaded: game.player.loaded,
            speed: +game.player.speed2D.toFixed(2),
          },
          restored: [...game.restoredDistricts],
          interactables: game.interactables.items.length,
          triangles: game.renderer.info.render.triangles,
          calls: game.renderer.info.render.calls,
          colliders: game.colliders.boxes.length,
          health: Math.round(game.combat.health),
          alive: game.combat.alive,
          hasGun: game.combat.hasGun,
          ammo: game.combat.ammo,
          infected: game.zombies.stats().alive,
          errors: game.errors.slice(-5),
        };
      },
      press(code) {
        game.input.keys.add(code);
        game.input.pressed.add(code);
      },
      release(code) {
        game.input.keys.delete(code);
      },
      look(dx, dy) {
        game.input.mouseDx += dx;
        game.input.mouseDy += dy;
      },
      teleport(x, y, z, yaw = Math.PI) {
        game.player.teleport(new THREE.Vector3(x, y, z), yaw);
        game.cameraRig.initialized = false;
      },
      newGame() {
        game.newGame();
      },
      continueGame() {
        game.continueGame();
      },
      interactWith(id) {
        const it = game.interactables.get(id);
        if (it && it.active && !it.done && it.visible) {
          it.onInteract(it);
          return true;
        }
        return false;
      },
      goTo(id) {
        const it = game.interactables.get(id);
        if (!it) return false;
        game.player.teleport(it.position.clone().setY(it.position.y + 0.05), Math.PI);
        game.cameraRig.initialized = false;
        return true;
      },
      sample() {
        game.renderer.render(game.scene, game.camera);
        const gl = game.renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(4);
        let min = 255, max = 0, sum = 0, n = 0;
        const colors = new Set();
        for (let y = 1; y <= 8; y++) {
          for (let x = 1; x <= 12; x++) {
            gl.readPixels(Math.floor((w * x) / 13), Math.floor((h * y) / 9), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            const l = (buf[0] + buf[1] + buf[2]) / 3;
            min = Math.min(min, l);
            max = Math.max(max, l);
            sum += l;
            n++;
            colors.add(`${buf[0]},${buf[1]},${buf[2]}`);
          }
        }
        return { min, max, avg: +(sum / n).toFixed(1), uniqueColors: colors.size, w, h };
      },
      endNow() {
        game.startEnding();
      },
      zombies() {
        return game.zombies.stats();
      },
      audioState() {
        return {
          ready: game.audio.ready,
          ctx: game.audio.ctx ? game.audio.ctx.state : 'none',
          surface: game.player.surface,
          duck: +game.audio.duckLevel.toFixed(2),
          threat: +game.audio.threat.toFixed(2),
          musicState: game.audio.musicState,
          musicMood: game.audio.music ? game.audio.music._effectiveState() : game.audio.musicState,
          musicPaused: !!game.audio.music?.paused,
          musicGains: game.audio.music
            ? Object.fromEntries(Object.entries(game.audio.music.gains).map(([k, g]) => [k, +g.gain.value.toFixed(3)]))
            : null,
          reverb: !!game.audio.reverb,
        };
      },
      damagePlayer(amount = 12) {
        game.combat.hurt(amount);
        return Math.round(game.combat.health);
      },
      giveGun(ammo = 40) {
        game.combat.giveGun(ammo);
        return game.combat.ammo;
      },
      aim(on = true) {
        game.combat.aimHeld = !!on;
        game.player.aiming = game.combat.refreshAim();
        return game.combat.aiming;
      },
      lock() {
        const hit = game.combat.lock;
        return hit
          ? { part: hit.part, distance: +game.camera.position.distanceTo(hit.zombie.position).toFixed(1) }
          : null;
      },
      attack() {
        game.combat.attack();
        return { ammo: game.combat.ammo, health: Math.round(game.combat.health) };
      },
      spawnZombie(x = 0, z = 0) {
        const list = game.zombies.zombies;
        let zz = list.find((z) => z.dead);
        if (!zz) {
          zz = list.slice().sort((a, b) =>
            b.position.distanceToSquared(game.player.position) - a.position.distanceToSquared(game.player.position))[0];
        }
        if (!zz) return null;
        const y = game.zombies.groundY(x, z, 6) ?? 0;
        zz.dead = false;
        zz.deathT = 0;
        zz.health = zz.maxHealth;
        zz.group.visible = true;
        zz.position.set(x, y, z);
        zz.group.position.copy(zz.position);
        zz.group.rotation.set(0, 0, 0);
        zz.respawnAt = 0;
        return [x, y, z];
      },
      chapter() {
        return { chapter: game.missions.index + 1, status: { ...game.missions.status }, memories: [...game.relayMemories] };
      },
      noise(radius = 40) {
        game.zombies.emitNoise(game.player.position.clone(), radius);
        return game.zombies.stats();
      },
      states() {
        return game.zombies.zombies.map((z) => ({ state: z.state, story: z.story, dead: z.dead, alerted: z.alerted }));
      },
      introPlaying() {
        return !!game.intro?.playing;
      },
      skipIntro() {
        game.intro?.skip();
        return game.state;
      },
      playIntro() {
        game.replayCinematic();
        return game.state;
      },
      ending() {
        game.startEnding();
        return game.state;
      },
      advance(seconds) {
        game.advance(seconds);
        return game.state;
      },
      hold(codes, seconds) {
        codes.forEach((c) => game.input.keys.add(c));
        game.advance(seconds);
        codes.forEach((c) => game.input.keys.delete(c));
        return window.__RESTART.stats();
      },
    };
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error('[RE:START] boot failed', err);
  game.errors.push(String(err));
  const el = document.getElementById('loading-text');
  if (el) el.textContent = 'BOOT ERROR: ' + String(err).slice(0, 160);
});
