/**
 * RE:START — THE LAST SIGNAL · five chapters.
 *
 * Each chapter is actual gameplay in its own district:
 *   1 Arrival Plaza   — movement, RELAY, barricade, terminal, recording
 *   2 Solar Walkway   — array repairs, inverter, relay, escape
 *   3 Water Station   — conduit puzzle, pump pressure, doctor's recording
 *   4 Garden Courtyard— energy cells, crates, lift, Bloom Console
 *   5 Restart Core    — relay synchronization, counter-signal, ending
 */

export const MISSIONS = [
  {
    id: 0,
    chapter: 1,
    title: 'Arrival Plaza',
    subtitle: 'THE FIRST SIGNAL',
    district: 'plaza',
    intro: 'Restorer, you are awake. Aster has gone dark. Reach the plaza marker — then we bring the first signal back together.',
    copy: 'The plaza remembers footsteps. Yours are the first in years — and somewhere in the fog, something else has started to listen.',
    objectives: [
      { id: 'reach', text: 'Reach the Plaza Marker' },
      { id: 'relay', text: 'Meet RELAY, your assistant drone' },
      { id: 'jump', text: 'Cross the collapsed barricade' },
      { id: 'terminal', text: 'Activate the Plaza Terminal' },
      { id: 'recording', text: 'Play the emergency recording' },
    ],
  },
  {
    id: 1,
    chapter: 2,
    title: 'Solar Walkway',
    subtitle: 'THE SIGNAL DRAWS NEAR',
    district: 'solar',
    intro: 'I am reading usable solar power on the elevated walkway. Bring the arrays online, Restorer — but the Hollowed are drawn to electrical noise.',
    copy: 'Sunlight returns to the wires. In the streets below, heads turn toward the hum.',
    objectives: [
      { id: 'reach', text: 'Cross onto the Solar Walkway' },
      { id: 'arrays', text: 'Repair the solar arrays (0/3)' },
      { id: 'inverter', text: 'Activate the solar inverter' },
      { id: 'relay', text: 'Power the Solar relay' },
      { id: 'escape', text: 'Escape the walkway' },
    ],
  },
  {
    id: 2,
    chapter: 3,
    title: 'Water Station',
    subtitle: 'EVIDENCE OF LIFE',
    district: 'water',
    intro: 'There is an irregular biological signal beneath the Water Station. Not interference. Something alive.',
    copy: 'Water moves through dead pipes again, and for the first time the city has proof that its people are still in there.',
    objectives: [
      { id: 'reach', text: 'Enter the Water Station' },
      { id: 'nodes', text: 'Align the conduit nodes (0/3)' },
      { id: 'pump', text: 'Restore water pressure' },
      { id: 'recording', text: "Recover the doctor's recording" },
      { id: 'relay', text: 'Restore the Water relay' },
    ],
  },
  {
    id: 3,
    chapter: 4,
    title: 'Overgrown Courtyard',
    subtitle: 'MEMORIES BENEATH THE CITY',
    district: 'garden',
    intro: 'The Garden District has been reclaimed by roots. Recover the energy cells and reach the Bloom Console — and Restorer… I found a fragment of your voice.',
    copy: 'The courtyard breathes again. From the rooftop, the first lights of Aster answer back.',
    objectives: [
      { id: 'reach', text: 'Enter the Overgrown Courtyard' },
      { id: 'cells', text: 'Collect energy cells (0/3)' },
      { id: 'lift', text: 'Power the courtyard lift' },
      { id: 'bloom', text: 'Activate the Bloom Console' },
      { id: 'relay', text: 'Restore the Garden relay' },
      { id: 'view', text: 'See the lights from the rooftop' },
    ],
  },
  {
    id: 4,
    chapter: 5,
    title: 'The Restart Core',
    subtitle: 'THE TRUTH',
    district: 'core',
    intro: 'All three district relays are feeding the Core. What we find down there will explain everything, Restorer. Including you.',
    copy: 'The counter-signal leaves the Core. Across Aster, the Hollowed stop moving — and one of them lifts their head.',
    objectives: [
      { id: 'reach', text: 'Reach the Restart Core' },
      { id: 'relays', text: 'Confirm all three relays are online' },
      { id: 'sequence', text: 'Synchronize the relay pylons (0/3)' },
      { id: 'core', text: 'Activate the Restart Core' },
      { id: 'signal', text: 'Send the controlled counter-signal' },
    ],
  },
];

for (const m of MISSIONS) {
  for (const o of m.objectives) o.baseText = o.text;
}

export const CHAPTER_COUNT = MISSIONS.length;

export class MissionManager {
  constructor({ ui, audio }) {
    this.ui = ui;
    this.audio = audio;
    this.index = 0;
    this.status = {};
    this.energy = 0;
    this.energyMax = 9;
    this.sparks = 0;
    this.completed = [];
    this.active = false;
    this.onAllComplete = null;
    this.onObjective = null;
    this._completing = false;
  }

  get mission() {
    return MISSIONS[this.index] || MISSIONS[0];
  }

  begin(index, silent = false) {
    this.index = Math.max(0, Math.min(MISSIONS.length - 1, index));
    this.status = {};
    this.active = true;
    this._completing = false;
    for (const o of this.mission.objectives) {
      this.status[o.id] = false;
      o.text = o.baseText;
    }
    if (!silent) {
      this.ui.setMission(this.mission, this.status);
      this.ui.showChapterCard(this.mission);
      this.ui.dialogue([{ speaker: 'RELAY', text: this.mission.intro, ms: 8600 }]);
      this.audio.sfx('missionStart');
    } else {
      this.ui.setMission(this.mission, this.status);
    }
    this.ui.setStats({ energy: this.energy, energyMax: this.energyMax, sparks: this.sparks });
  }

  setObjectiveText(id, text) {
    const obj = this.mission.objectives.find((o) => o.id === id);
    if (obj) obj.text = text;
    this.ui.setMission(this.mission, this.status);
  }

  completeObjective(id) {
    if (!this.active) return false;
    if (!(id in this.status) || this.status[id]) return false;
    this.status[id] = true;
    this.ui.setMission(this.mission, this.status);
    this.audio.sfx('objective');
    if (this.onObjective) this.onObjective(id);
    this._checkComplete();
    return true;
  }

  _checkComplete() {
    if (this._completing) return;
    const objs = this.mission.objectives;
    if (!objs.length) return;
    if (objs.every((o) => this.status[o.id])) {
      this._completing = true;
      if (!this.completed.includes(this.index)) this.completed.push(this.index);
      this.active = false;
      if (this.onAllComplete) this.onAllComplete(this.mission);
    }
  }

  restore(data) {
    this.index = data.index ?? 0;
    this.status = data.status || {};
    this.energy = data.energy || 0;
    this.sparks = data.sparks || 0;
    this.completed = data.completed || [];
    this.active = !!data.active;
    for (const o of this.mission.objectives) {
      if (!(o.id in this.status)) this.status[o.id] = false;
    }
    this.ui.setMission(this.mission, this.status);
    this.ui.setStats({ energy: this.energy, energyMax: this.energyMax, sparks: this.sparks });
  }

  addEnergy(n = 1) {
    this.energy = Math.min(this.energyMax, this.energy + n);
    this.ui.setStats({ energy: this.energy, energyMax: this.energyMax, sparks: this.sparks });
    this.audio.sfx('pickup');
    return this.energy;
  }

  addSpark(n = 1) {
    this.sparks += n;
    this.ui.setStats({ energy: this.energy, energyMax: this.energyMax, sparks: this.sparks });
  }

  setEnergy(n) {
    this.energy = n;
    this.ui.setStats({ energy: this.energy, energyMax: this.energyMax, sparks: this.sparks });
  }

  toJSON() {
    return {
      index: this.index,
      status: this.status,
      energy: this.energy,
      sparks: this.sparks,
      completed: this.completed,
      active: this.active,
    };
  }
}
