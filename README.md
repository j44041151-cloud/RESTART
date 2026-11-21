# RE:START — THE LAST SIGNAL

A five-chapter, third-person restoration adventure set in the abandoned city of Aster.
Built with three.js, procedural geometry and a fully local, dependency-free server.

You are **the Restorer**. Two decades ago you tried to shut down the RE:START
experiment and failed. Now **RELAY**, a damaged maintenance assistant, has woken
you beneath Arrival Plaza. Bring the three district relays back online, recover
the truth about the experiment, and send the controlled counter-signal — without
waking the Hollowed first.

---

## Launch

1. Double-click `Play RE-START.bat` (or run
   `powershell -ExecutionPolicy Bypass -File .\server.ps1`).
2. The server prints a loopback URL such as `http://127.0.0.1:8137/` and opens it.
3. Click **NEW GAME**. The opening cinematic plays; skip it with the button or
   Escape/Enter/Space.

No install step, no npm, no network access. The game runs from static files.

---

## Controls

| Action | Input |
| --- | --- |
| Move | `W A S D` |
| Look | Mouse |
| Run | `Shift` (loud — the Hollowed hear it) |
| Jump | `Space` |
| Interact / repair / activate | `E` |
| Fire / punch | Left mouse |
| Aim pistol | Right mouse |
| Insight Spark (RELAY hint) | `H` |
| Pause | `Esc` |
| Fullscreen | `F` |

---

## The five chapters

1. **Arrival Plaza — The First Signal.** Wake up, meet RELAY, cross the collapsed
   barricade, activate the plaza terminal, restore the first Grid section and play
   the corrupted emergency recording. Hollowed movement appears in the fog.
2. **Solar Walkway — The Signal Draws Near.** Run and jump the broken walkway,
   repair three solar arrays, wake the inverter, power the Solar relay — then get
   off the deck when the electrical noise pulls the Hollowed in.
3. **Water Station — Evidence of Life.** A dark reclamation station, three conduit
   nodes to align, the pump to restore, and Doctor Voss's emergency recording:
   the Hollowed still have brain activity. Water and the Aqua relay come back.
4. **Overgrown Courtyard — Memories Beneath the City.** Collect three energy cells
   (bus roof, rubble, east ledge), power the lift, ride to the Bloom Console and
   restore the Garden relay. RELAY recovers a fragment of your own voice: you
   helped test the prototype. From the rooftop, distant lights answer.
5. **The Restart Core — The Truth.** All three relays feed the Core. Recover the
   complete experiment record, synchronize the three pylons in RELAY's order
   (SOLAR → GARDEN → AQUA), activate the Core and send the controlled
   counter-signal. The ending plays out in nine beats and ends on
   **RE:START — THE LAST SIGNAL**, with room for the next chapter.

Each chapter begins with a chapter card, a RELAY memory fragment and a fade-in at
the district approach. Progress saves automatically at every checkpoint, chapter
hand-off and objective change.

---

## The Hollowed

The Hollowed are not generic zombies. They are people held by the carrier signal,
and they react to the environment:

- **wander** slowly around their anchor, drifting through the ruins
- **hear** running, landings, gunshots, recordings, pump/relay activation and
  investigate the exact position of the noise
- **search** the area for several seconds, sweeping their head around
- **see** the player only inside a narrow vision cone with a clear line of sight
- **return** home and forget once the search timer expires

Walking is quiet. Running, jumping from height and shooting are loud. Electrical
work always draws a crowd, which is why each relay has an escape beat.

---

## RELAY

RELAY communicates through the dialogue panel (no physical drone):

- five progressive **memory fragments**, one per chapter, unlocked at chapter start
- recovered **recordings** with distinct speaker identities: RELAY, recovered
  audio, Doctor Voss, the Restorer's own memory, and the ASTER Grid broadcast
- mission hints through the Insight Spark (`H`)
- subtitles + comms chirps; subtitles can be disabled in Settings

---

## The Restorer model

The player character is the existing procedural, rigged Restorer in
`js/player/RestorerModel.js` — dark tousled hair, futuristic jacket, cyan chest
prototype, backpack, utility belt, gloves and boots — with procedural
idle/walk/run/jump/landing and the two-handed repair pose.

`assets/models/Restorer.glb` was inspected and loads correctly, but it is a
different asset: a helmeted *Vanguard* body (`vanguard_Mesh`, `vanguard_visor`)
with only `Idle`, `Run`, `Walk` and `TPose` clips. It has no jump, landing or
repair animation and does not match the established Restorer design, so it is not
used for gameplay. The procedural Restorer remains the playable character.

---

## Opening cinematic and ending

- `assets/videos/restart_intro.mp4` is supported fullscreen with narration
  audio, game-drawn subtitles, skip button and a missing-file fallback reel.
  See `assets/videos/README.txt`. No fake video is shipped.
- New Game always plays the cinematic; Continue never replays it.
- The ending is a staged cinematic: silence and darkness, one Hollowed becoming
  still, the first awakening, others recovering while some stay unconscious, the
  network broadcast, faint windows lighting up, survivors emerging, and the title.
  It does not magically repair the whole city.

---

## Save data

- Key: `restart_bounce_back_save_v1`, format version 2.
- Stores chapter, objective status, district restore state, player position,
  combat/ammo state, collected motes and cells, RELAY memories and completion.
- Version 1 saves from the original three-mission build are migrated on load:
  mission index 0/1 → chapter 1/2, an old Core save → chapter 5, restored
  districts preserved.

---

## Assets

- `vendor/` — three.js r16x modules and addons (GLTFLoader, postprocessing).
- `assets/models/Restorer.glb` — original supplied character (inspected, unused).
- `assets/videos/` — drop `restart_intro.mp4` here.
- Everything else is generated procedurally at runtime (city, districts, Hollowed,
  character rig, textures, audio).

---

## Debug helpers

With the page open, `window.__RESTART` exposes the running game:

```
__RESTART.stats()            // chapter, objectives, health, draw calls, errors
__RESTART.chapter()          // chapter + objective status + memories
__RESTART.teleport(x,y,z)    // move the Restorer
__RESTART.goTo(id)           // stand at an interactable
__RESTART.interactWith(id)   // trigger it
__RESTART.giveGun(ammo)
__RESTART.aim(true) / .lock() / .attack()
__RESTART.spawnZombie(x,z)   // relocate a Hollowed
__RESTART.noise(radius)      // make a disturbance at the player
__RESTART.states()           // Hollowed AI states
__RESTART.skipIntro() / .playIntro() / .ending()
__RESTART.advance(seconds)   // synchronous simulation for verification
```
