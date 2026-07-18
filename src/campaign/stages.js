/* ============================================================
   stages.js — declarative campaign definition.
   Positions use named anchors resolved by StageManager against
   the live world (dock, beacon, console...). Time-of-day drives
   the campaign's mood: dawn landing -> dusk climb -> night finale.
   ============================================================ */

export const STAGES = [
  {
    title: 'Landfall',
    subtitle: 'INSTALLATION 04 — 06:20',
    tod: 0.18, fog: 0.5, waves: 0.30,
    start: 'start',
    intro: [
      'Spartan, you’re awake. Good.',
      'We came down hard on the ring. This lake basin is our landing zone.',
      'Get your bearings — move to the dock marked on your HUD.',
      'Then clear those three Covenant drones. Consider it a warm-up.',
    ],
    outro: ['Beachhead secured. Nicely done, Chief.'],
    objectives: [
      { id: 'reach_dock', type: 'reach', label: 'Reach the dock', anchor: 'dock', radius: 8 },
      { id: 'kill_drones', type: 'eliminate', label: 'Destroy 3 drones', count: 3,
        spawn: { types: ['grunt', 'grunt', 'grunt'], anchor: 'dock', minR: 12, maxR: 34 } },
    ],
  },
  {
    title: 'The Silent Shore',
    subtitle: 'INSTALLATION 04 — 09:10',
    tod: 0.30, fog: 0.42, waves: 0.45,
    start: 'start',
    intro: [
      'Covenant are massing along the shoreline.',
      'Six hostiles between us and the tree line — including an Elite.',
      'Watch your shields, Chief. Let them recharge behind cover.',
    ],
    outro: ['Shoreline’s clear. The path to the highlands is open.'],
    objectives: [
      { id: 'clear_shore', type: 'eliminate', label: 'Clear the shore (6)', count: 6,
        spawn: { types: ['grunt', 'grunt', 'grunt', 'grunt', 'elite', 'grunt'], anchor: 'shore', minR: 20, maxR: 70 } },
    ],
  },
  {
    title: 'Into the Highlands',
    subtitle: 'INSTALLATION 04 — 17:25',
    tod: 0.70, fog: 0.5, waves: 0.5,
    start: 'start',
    intro: [
      'The Forerunner beacon is up in the highlands. Reach it.',
      'They’ll throw everything they have to stop us — two waves at least.',
      'The sun’s going down. Use the light while you have it.',
    ],
    outro: ['Beacon’s online. The Cartographer is close now.'],
    objectives: [
      { id: 'survive', type: 'eliminate', label: 'Break the assault (8)', count: 8,
        spawn: { types: ['grunt', 'elite', 'grunt', 'grunt', 'elite', 'grunt', 'grunt', 'elite'], anchor: 'beacon', minR: 15, maxR: 55, reinforce: true } },
      { id: 'reach_beacon', type: 'reach', label: 'Reach the beacon', anchor: 'beacon', radius: 10 },
    ],
  },
  {
    title: 'The Cartographer',
    subtitle: 'INSTALLATION 04 — 22:00',
    tod: 0.96, fog: 0.45, waves: 0.35,
    start: 'start',
    intro: [
      'This is it, Chief — the map room, under the ring itself.',
      'Recover three energy cores. They’ll be glowing; you can’t miss them.',
      'Then get them to the console and activate the Cartographer.',
      'And Chief… there’s a Field Marshal down here. Be ready.',
    ],
    outro: [
      'Cartographer online. I have the coordinates.',
      'We did it, Spartan. The ring is ours. … for now.',
    ],
    objectives: [
      { id: 'cores', type: 'collect', label: 'Recover energy cores', count: 3, anchor: 'console', spread: 60 },
      { id: 'boss', type: 'eliminate', label: 'Defeat the Field Marshal', count: 1,
        spawn: { types: ['elite'], anchor: 'console', minR: 14, maxR: 24, boss: true } },
      { id: 'activate', type: 'activate', label: 'Activate the Cartographer', anchor: 'console', radius: 7, requires: ['cores', 'boss'] },
    ],
  },
];
