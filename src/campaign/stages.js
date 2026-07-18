/* ============================================================
   stages.js — declarative campaign definition.

   Positions use named anchors resolved by StageManager against
   the live world (dock, beacon, console, midway_* waypoints).
   Time-of-day drives the mood: dawn landing -> dusk climb ->
   night finale.

   Each stage may declare `events`: scripted set-pieces fired by
   triggers —
     zone: 'anchor', radius     player enters an area
     delay: seconds             time since deploy
     objectiveDone: 'id'        an objective completes
     progress: { id, count }    an objective reaches a count
   — whose `do` actions are say / banner / spawn / dropship.

   Eliminate specs support:
     after: 'id'      defer the spawn until that objective is done
     via: 'dropship'  arrive by Phantom instead of appearing
     reinforce: true  second half of `types` held back, delivered
                      when the first half is nearly down
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
      'And stay sharp. We were not a quiet crash.',
    ],
    outro: ['Beachhead secured. Nicely done, Chief.'],
    objectives: [
      { id: 'reach_dock', type: 'reach', label: 'Reach the dock', anchor: 'dock', radius: 8 },
      { id: 'kill_drones', type: 'eliminate', label: 'Destroy 3 sentinel drones', count: 3,
        spawn: { types: ['drone', 'drone', 'drone'], anchor: 'dock', minR: 12, maxR: 26, after: 'reach_dock' } },
    ],
    events: [
      { delay: 6, do: [{ say: ['Motion tracker is live. Anything without a green blip — shoot it.'] }] },
      { zone: 'midway_dock', radius: 28, do: [
        { banner: 'PHANTOM INBOUND' },
        { say: ['Contact! Covenant dropship on approach — they found us fast.', 'Two grunts. Consider it a warm-up.'] },
        { dropship: { types: ['grunt', 'grunt'], anchor: 'midway_dock', minR: 10, maxR: 20 } },
      ] },
      { objectiveDone: 'reach_dock', do: [
        { banner: 'DRONES INBOUND' },
        { say: ['Sentinel drones closing on the dock. Watch the sky, Chief!'] },
      ] },
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
      { id: 'clear_shore', type: 'eliminate', label: 'Clear the shore', count: 6,
        spawn: { types: ['grunt', 'grunt', 'grunt', 'grunt', 'elite', 'grunt'], anchor: 'shore', minR: 20, maxR: 60, reinforce: true, via: 'dropship' } },
    ],
    events: [
      { delay: 5, do: [{ say: ['I’m reading a patrol ahead. Keep to the rocks until you have an angle.'] }] },
      { zone: 'midway_shore', radius: 26, do: [
        { banner: 'FLANKING FORCE' },
        { say: ['They’re trying to cut behind us — Phantom on your six!'] },
        { dropship: { types: ['grunt', 'drone'], anchor: 'midway_shore', minR: 12, maxR: 22 } },
      ] },
      { progress: { id: 'clear_shore', count: 3 }, do: [
        { say: ['Half of them down. The rest are calling for backup — make it not matter.'] },
      ] },
    ],
  },
  {
    title: 'Into the Highlands',
    subtitle: 'INSTALLATION 04 — 17:25',
    tod: 0.70, fog: 0.5, waves: 0.5,
    start: 'start',
    intro: [
      'The Forerunner beacon is up in the highlands. Reach it.',
      'Once I start the uplink, they’ll throw everything at us to stop it.',
      'The sun’s going down. Use the light while you have it.',
    ],
    outro: ['Uplink complete. Beacon’s online — the Cartographer is close now.'],
    objectives: [
      { id: 'reach_beacon', type: 'reach', label: 'Reach the beacon', anchor: 'beacon', radius: 12 },
      { id: 'hold_beacon', type: 'defend', label: 'Hold the beacon', anchor: 'beacon', radius: 15,
        duration: 45, requires: ['reach_beacon'],
        waves: { every: 13, types: [['grunt', 'grunt'], ['grunt', 'elite'], ['drone', 'drone'], ['elite', 'grunt']] } },
    ],
    events: [
      { delay: 5, do: [{ say: ['It’s a climb. Follow the waypoint and don’t stop for the view.'] }] },
      { zone: 'midway_beacon', radius: 26, do: [
        { banner: 'AMBUSH' },
        { say: ['Ambush! They were waiting on the ridge — Phantom overhead!'] },
        { dropship: { types: ['grunt', 'elite'], anchor: 'midway_beacon', minR: 10, maxR: 20 } },
      ] },
      { objectiveDone: 'reach_beacon', do: [
        { banner: 'HOLD POSITION' },
        { say: ['Uplink started — stay inside the perimeter while I work.', 'They’re coming, Chief. Hold the ring of light.'] },
      ] },
    ],
  },
  {
    title: 'The Pass',
    subtitle: 'INSTALLATION 04 — 19:40',
    tod: 0.84, fog: 0.55, waves: 0.4,
    start: 'beacon',
    playRadius: 275,          // opens the true mountains beyond the bowl
    intro: [
      'The Cartographer is sealed. There’s a Forerunner relay up in the peaks that can crack it.',
      'That means going over the mountains, Chief. Follow the ridge line.',
      'Air’s thin, cover’s thinner. The Covenant own the high ground — take it from them.',
    ],
    outro: ['Relay’s burning bright. The Cartographer is unlocked — one door left, Chief.'],
    objectives: [
      { id: 'reach_ridge', type: 'reach', label: 'Climb to the ridge line', anchor: 'ridge', radius: 12 },
      { id: 'pass_patrol', type: 'eliminate', label: 'Clear the summit guard', count: 5,
        spawn: { types: ['drone', 'drone', 'elite', 'grunt', 'drone'], anchor: 'pass', minR: 12, maxR: 30, after: 'reach_ridge', via: 'dropship' } },
      { id: 'light_relay', type: 'activate', label: 'Light the relay', anchor: 'pass', radius: 8, requires: ['pass_patrol'] },
    ],
    events: [
      { delay: 5, do: [{ say: ['The relay is above the snow line. Keep climbing — and mind the drop.'] }] },
      { zone: 'ridge', radius: 32, do: [
        { banner: 'CONTACT HIGH' },
        { say: ['Drones on the ridge — they patrol these peaks. Knock them down!'] },
        { dropship: { types: ['drone', 'drone'], anchor: 'ridge', minR: 10, maxR: 18 } },
      ] },
      { objectiveDone: 'reach_ridge', do: [
        { banner: 'SUMMIT GUARD INBOUND' },
        { say: ['Phantom rising over the crest — the summit guard knows we’re here.'] },
      ] },
      { progress: { id: 'pass_patrol', count: 3 }, do: [
        { say: ['Almost through them. The relay’s just past the crest.'] },
      ] },
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
      'Each one is guarded. Take them anyway.',
      'And Chief… their Field Marshal is down here somewhere. Be ready.',
    ],
    outro: [
      'Cartographer online. I have the coordinates.',
      'We did it, Spartan. The ring is ours. … for now.',
    ],
    objectives: [
      { id: 'cores', type: 'collect', label: 'Recover energy cores', count: 3, anchor: 'console', spread: 60,
        guards: ['grunt', 'drone'] },
      { id: 'boss', type: 'eliminate', label: 'Defeat the Field Marshal', count: 1,
        spawn: { types: ['elite'], anchor: 'console', minR: 14, maxR: 24, boss: true, after: 'cores', via: 'dropship' } },
      { id: 'activate', type: 'activate', label: 'Activate the Cartographer', anchor: 'console', radius: 7, requires: ['cores', 'boss'] },
    ],
    events: [
      { delay: 6, do: [{ say: ['Cores are marked. Guards on every one — hit them fast, before they group up.'] }] },
      { objectiveDone: 'cores', do: [
        { banner: 'FIELD MARSHAL INBOUND' },
        { say: ['All cores secured — wait. Heavy signature dropping in.', 'That’s him. That’s the Marshal. Give him everything, Chief!'] },
      ] },
      { objectiveDone: 'boss', do: [
        { say: ['Marshal down. I… actually wasn’t sure we’d win that one.'] },
      ] },
    ],
  },
];
