/**
 * RE:START — THE LAST SIGNAL
 * Story data: dialogue, recordings and narration. Kept free of three.js so it
 * can be read by systems, tests and the debug API alike.
 *
 * Speakers:
 *   RELAY     — damaged maintenance assistant, later a guide
 *   RECORDING — recovered audio (doctor, Restorer's own voice)
 *   RESTORER  — the player character thinking aloud
 *   GRID      — the restored ASTER network broadcast
 *   NARRATOR  — the opening cinematic's narration
 */

export const SPEAKERS = {
  RELAY: { label: 'RELAY', sub: 'ASSISTANT DRONE', kind: 'relay' },
  RECORDING: { label: 'RECOVERED AUDIO', sub: 'ARCHIVE FRAGMENT', kind: 'recording' },
  DOCTOR: { label: 'DR. ELIAS VOSS', sub: 'EMERGENCY RECORDING', kind: 'recording' },
  RESTORER: { label: 'THE RESTORER', sub: 'MEMORY FRAGMENT', kind: 'memory' },
  GRID: { label: 'ASTER GRID', sub: 'RESTORED NETWORK', kind: 'grid' },
  NARRATOR: { label: 'NARRATION', sub: 'THE LAST SIGNAL', kind: 'narration' },
};

/** Opening cinematic narration. Used for video subtitles and the fallback reel. */
export const INTRO_NARRATION = [
  {
    kicker: 'ASTER · TWENTY YEARS AGO',
    line: 'Aster was a city that ran on light. Its streets were clean, its windows warm, and the ASTER Grid carried power to every home without a single wire above the ground.',
    cue: 2.0,
    dur: 7600,
  },
  {
    kicker: 'THE ASTER GRID',
    line: 'The Grid did more than power the city. It listened. Every signal, every heartbeat of Aster passed through its Core, and the city learned to breathe in time with it.',
    cue: 9.5,
    dur: 7400,
  },
  {
    kicker: 'EXPERIMENT RE:START',
    line: 'Then came the experiment. A pattern of energy that could carry thought itself — a signal designed to rebuild a mind from the inside out.',
    cue: 17.0,
    dur: 7200,
  },
  {
    kicker: 'CONTAINMENT FAILURE',
    line: 'It worked. That was the problem. The pattern left the Core and moved through the Grid, through the streets, through the people. The city did not fall. It simply stopped.',
    cue: 24.0,
    dur: 8200,
  },
  {
    kicker: 'THE HOLLOWED',
    line: 'Those it touched are still alive. They wander the ruins drawn to sound, to movement, to any current still running. Aster calls them the Hollowed.',
    cue: 32.0,
    dur: 7600,
  },
  {
    kicker: 'ONE SURVIVOR',
    line: 'One person survived untouched. The Restorer — a field engineer who tried to shut the experiment down, and failed. They have slept beneath the plaza ever since.',
    cue: 39.5,
    dur: 8000,
  },
  {
    kicker: 'RELAY',
    line: 'A maintenance assistant stayed awake through all of it, keeping one small shell of light alive. Now, at last, it has someone to talk to.',
    cue: 47.0,
    dur: 7600,
  },
];

/** Corrupted emergency recording recovered from the Plaza terminal. */
export const PLAZA_RECORDING = [
  { speaker: 'RECORDING', text: 'Grid failure… sector three through nine. Residents down. I repeat, residents are down—', ms: 6200 },
  { speaker: 'RECORDING', text: 'Containment protocol is not holding. The pattern is propagating through the Grid faster than we can isolate it.', ms: 6600 },
  { speaker: 'RECORDING', text: 'Core access… someone get to Core access. Do not let it reach the—', ms: 5400 },
  { speaker: 'RELAY', text: 'The recording degrades there. But it named the Core, Restorer. Whatever happened in Aster, the answer was kept below the city.', ms: 8200 },
];

/** Doctor's emergency recording (Chapter 3). */
export const DOCTOR_RECORDING = [
  { speaker: 'DOCTOR', text: 'This is Doctor Elias Voss. Reclamation Station, cycle nine. If anyone finds this — they are not gone.', ms: 6800 },
  { speaker: 'DOCTOR', text: 'The Hollowed still show brain activity. Slow, irregular, but present. The signal did not kill them. It is holding them.', ms: 7600 },
  { speaker: 'DOCTOR', text: 'The Core is transmitting a counter-pattern. It could restore neural function — but it needs every district relay to carry it.', ms: 7800 },
  { speaker: 'RELAY', text: 'Brain activity. He said it out loud. Aster did not lose its people. It is keeping them.', ms: 7200 },
  { speaker: 'RELAY', text: 'That changes what we are doing here. We are not restoring a city. We are going to wake it.', ms: 7200 },
];

/** The Restorer's own voice, recovered in the Garden (Chapter 4). */
export const RESTORER_RECORDING = [
  { speaker: 'RESTORER', text: 'Field log. Test seven. The prototype responds to the chest interface, just like the doctor said it would.', ms: 6600 },
  { speaker: 'RESTORER', text: 'I helped build this. I calibrated the pattern. I told them it was safe because I wanted it to be safe.', ms: 7200 },
  { speaker: 'RESTORER', text: 'If this recording survives, and I do not — the counter-signal is real. It needs all three relays. Do not activate it early.', ms: 8200 },
  { speaker: 'RELAY', text: 'That was your voice. You were there, at the beginning. You were trying to stop it.', ms: 7200 },
];

/** The complete experiment record, recovered at the Core (Chapter 5). */
export const CORE_RECORDING = [
  { speaker: 'RECORDING', text: 'RE:START experimental record, final entry. The energy pattern was designed to restore damaged neural tissue across an entire population.', ms: 8200 },
  { speaker: 'RECORDING', text: 'It succeeded beyond projection. The pattern propagated through the ASTER Grid and synchronized every connected mind to a single carrier wave.', ms: 8200 },
  { speaker: 'RECORDING', text: 'Subjects remain alive. Consciousness persists beneath the carrier. Emergency shutdown was attempted by field engineer — designation: Restorer.', ms: 8400 },
  { speaker: 'RECORDING', text: 'Shutdown failed. The engineer survived by sealing themselves inside the plaza substation. The counter-signal remains viable.', ms: 8200 },
  { speaker: 'RELAY', text: 'You remember now. You tried to stop it, and the city buried you for it. This is not a rescue, Restorer. It is a correction.', ms: 9000 },
];

/** RELAY's progressive memory recovery, one per chapter. */
export const RELAY_MEMORIES = [
  {
    chapter: 0,
    title: 'MEMORY 01 · BOOT SECTOR',
    text: 'I remember a corridor. I remember being carried. Everything before that is static — but I kept this shell lit for a reason.',
  },
  {
    chapter: 1,
    title: 'MEMORY 02 · POWER DRAW',
    text: 'I was connected to the Grid once. Not as a drone — as a maintenance node. I felt the pattern move through me. I think I helped it spread.',
  },
  {
    chapter: 2,
    title: 'MEMORY 03 · MEDICAL LOG',
    text: 'There was a doctor. He argued with the Core. He said the signal could be reversed. I archived his voice and then I lost it.',
  },
  {
    chapter: 3,
    title: 'MEMORY 04 · THE ENGINEER',
    text: 'I know your voice, Restorer. You gave me my name. You said: if the city goes dark, relay the last signal. That is what RELAY means.',
  },
  {
    chapter: 4,
    title: 'MEMORY 05 · THE TRUTH',
    text: 'I am not a survivor. I am the last part of the experiment that was told to keep transmitting. I am sorry. Let me help you end it.',
  },
];

/** Final broadcast, exactly as the restored network sends it. */
export const FINAL_BROADCAST =
  'If you can hear this, the signal has stopped. You are not alone. Stay where you are. We are coming.';

/** Per-chapter RELAY hint used by the Insight system. */
export const CHAPTER_HINTS = [
  'The plaza terminal sits west of the monument. Leap the collapsed barricade to reach it.',
  'Three solar arrays stand on the deck. Repair each one, then wake the inverter and the relay.',
  'Three conduit nodes feed the pump. Rotate each until its arrow points the way the pedestal is painted.',
  'Three energy cells: the bus roof, the rubble beside the lift, and the east ledge. Stack crates to climb.',
  'All three relay pylons must be synchronized before the Core will accept the counter-signal.',
];
