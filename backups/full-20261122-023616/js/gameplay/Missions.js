export const MISSIONS = [
  {
    id: 0,
    title: 'Arrival Plaza',
    subtitle: 'ASTER CITY · FIRST CONTACT',
    intro: 'RELAY: Restorer, you are awake. Aster has gone dark. Reach the plaza terminal and bring the first signal back.',
    copy: 'The plaza remembers footsteps. Yours are the first in years.',
    objectives: [
      { id: 'reach', text: 'Reach the Plaza Marker' },
      { id: 'relay', text: 'Meet RELAY, your assistant drone' },
      { id: 'jump', text: 'Leap the collapsed barricade' },
      { id: 'terminal', text: 'Activate the Plaza Terminal' },
    ],
  },
  {
    id: 1,
    title: 'Solar Walkway',
    subtitle: 'POWER DISTRICT · ELEVATED GRID',
    intro: 'RELAY: The solar grid is fractured. Cross the maintenance walkway and bring the arrays back online.',
    copy: 'Sunlight returns to the wires. The city feels a pulse.',
    objectives: [
      { id: 'reach', text: 'Cross onto the Solar Walkway' },
      { id: 'arrays', text: 'Repair the solar arrays (0/3)' },
      { id: 'inverter', text: 'Activate the solar inverter' },
      { id: 'relay', text: 'Power the district relay' },
    ],
  },
  {
    id: 2,
    title: 'The Restart Core',
    subtitle: 'FINAL MISSION · THE HEART OF ASTER',
    intro: 'RELAY: The first district is alive. I have rerouted reserve power to the other relay lines. Reach the Core and restart the city.',
    copy: 'Every light in Aster answers at once.',
    objectives: [
      { id: 'relays', text: 'Confirm reserve relays are online' },
      { id: 'core', text: 'Reach and activate the Restart Core' },
      { id: 'restore', text: 'Restore Aster City' },
    ],
  },
];

for (const m of MISSIONS) {
  for (const o of m.objectives) o.baseText = o.text;
}

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
    this.index = index;
    this.status = {};
    this.active = true;
    this._completing = false;
    for (const o of this.mission.objectives) {
      this.status[o.id] = false;
      o.text = o.baseText;
    }
    if (!silent) {
      this.ui.setMission(this.mission, this.status);
      this.ui.missionBanner(this.mission);
      this.ui.subtitle('RELAY', this.mission.intro, 8000);
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
    if (!this.active) return;
    if (!(id in this.status) || this.status[id]) return;
    this.status[id] = true;
    this.ui.setMission(this.mission, this.status);
    this.audio.sfx('objective');
    if (this.onObjective) this.onObjective(id);
    this._checkComplete();
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
