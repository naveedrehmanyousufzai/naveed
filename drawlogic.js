/* ============================================================
   drawlogic.js — how a draw is actually made

   Pure arithmetic, no page involved, so it can be tested on its
   own. Used by drawmaker.html to build draws and by draw.html to
   work out group standings.

   SEEDING, THE PSA WAY
   Seeds do not simply go 1, 2, 3, 4 down the sheet. They go into
   blocks, and within a block the positions are drawn at random:

     seed 1          top of the draw, always
     seed 2          bottom of the draw, always
     seeds 3-4       drawn between the two quarter positions
     seeds 5-8       drawn between the four eighth positions
     seeds 9-16      drawn between their eight positions
     unseeded        drawn into whatever is left

   That is why two draws from the same entry list are not identical
   below the top two seeds, and why this file shuffles.
   ============================================================ */

/* ---------- small helpers ---------- */

/* Fisher-Yates. Every ordering equally likely. */
function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 5 -> 8, 16 -> 16, 17 -> 32. A knockout draw is always a power of two. */
function drawSizeFor(entryCount) {
  let n = 2;
  while (n < entryCount) n *= 2;
  return Math.max(2, n);
}

/* The standard bracket order.
   For a draw of 8 this returns [1,8,5,4,3,6,7,2], meaning position 1
   holds seed 1, position 2 holds seed 8, and so on. It is what keeps
   seed 1 and seed 2 apart until the final. */
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    const next = [];
    order.forEach((s, i) => {
      /* Alternating the pair order each time is what keeps seed 2 at the
         very bottom and gives the conventional sheet. */
      if (i % 2 === 0) { next.push(s); next.push(total - s); }
      else { next.push(total - s); next.push(s); }
    });
    order = next;
  }
  return order;
}

/* Which seeds share a block and may therefore swap places.
   [1], [2], [3,4], [5,6,7,8], [9..16], ... */
function seedBlocks(size) {
  const blocks = [[1], [2]];
  let lo = 3;
  while (lo <= size) {
    const hi = Math.min((lo - 1) * 2, size);
    const block = [];
    for (let s = lo; s <= hi; s++) block.push(s);
    blocks.push(block);
    lo = hi + 1;
  }
  return blocks;
}

/* ============================================================
   KNOCKOUT
   entries: [{ name, club, seed }]  seed optional
   ============================================================ */
function buildKnockout(entries, opts = {}) {
  const rand = opts.rand || Math.random;
  const size = opts.size || drawSizeFor(entries.length);

  if (entries.length > size) {
    throw new Error(`${entries.length} entries will not fit a ${size} draw.`);
  }

  const order = seedOrder(size);              // position -> seed number
  const posOfSeed = new Map();                // seed number -> position index
  order.forEach((seed, i) => posOfSeed.set(seed, i));

  const slots = new Array(size).fill(null);

  /* --- seeded players, block by block, shuffled within each block --- */
  const seeded = entries
    .filter(e => Number.isFinite(Number(e.seed)) && Number(e.seed) >= 1)
    .sort((a, b) => Number(a.seed) - Number(b.seed));

  const bySeed = new Map();
  for (const e of seeded) {
    const s = Number(e.seed);
    if (!bySeed.has(s) && s <= size) bySeed.set(s, e);
  }

  for (const block of seedBlocks(size)) {
    const present = block.filter(s => bySeed.has(s));
    if (!present.length) continue;

    /* The positions this block owns, and the players who belong in it.
       Blocks of one (seeds 1 and 2) have nothing to shuffle. */
    const positions = present.map(s => posOfSeed.get(s));
    const players = present.map(s => bySeed.get(s));
    const drawnPositions = positions.length > 1 ? shuffle(positions, rand) : positions;

    drawnPositions.forEach((pos, i) => { slots[pos] = players[i]; });
  }

  /* --- everyone else, drawn at random into what is left --- */
  const placed = new Set(seeded.filter(e => bySeed.get(Number(e.seed)) === e));
  const unseeded = shuffle(entries.filter(e => !placed.has(e)), rand);

  let free = [];
  slots.forEach((v, i) => { if (v === null) free.push(i); });

  /* Byes belong next to the strongest players, so fill the slots whose
     opponent is weakest first and let the byes land at the top. */
  free = free.sort((a, b) => opponentSeedRank(b, order, size) - opponentSeedRank(a, order, size));

  unseeded.forEach((player, i) => { slots[free[i]] = player; });

  return {
    format: 'knockout',
    size,
    byes: size - entries.length,
    slots: slots.map((player, i) => ({
      position: i + 1,
      player: player || null,          // null means a bye
      seed: player && player.seed ? Number(player.seed) : null
    })),
    rounds: knockoutRounds(size)
  };
}

/* An empty bracket: every place open, to be filled in by hand.
   seedSpots marks the places a seed would normally take (positions listed by seed number). */
function blankKnockout(size) {
  const order = seedOrder(size);
  return {
    format: 'knockout', size, byes: 0, blank: true,
    slots: order.map((seed, i) => ({ position: i + 1, player: null, seed: null, open: true, spot: seed <= size / 2 ? seed : null })),
    rounds: knockoutRounds(size)
  };
}

/* How strong is the player this slot will face in round one?
   Lower number = stronger opponent. Used only to park byes sensibly. */
function opponentSeedRank(index, order, size) {
  const partner = index % 2 === 0 ? index + 1 : index - 1;
  return order[partner] ?? size;
}

/* Empty rounds, ready to be filled in as the tournament runs. */
function knockoutRounds(size) {
  const names = {
    2: ['Final'],
    4: ['Semifinals', 'Final'],
    8: ['Quarterfinals', 'Semifinals', 'Final'],
    16: ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'],
    32: ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'],
    64: ['Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'],
    128: ['Round of 128', 'Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final']
  }[size] || [];

  const rounds = [];
  let matches = size / 2;
  for (const name of names) {
    rounds.push({
      name,
      matches: Array.from({ length: matches }, () => ({
        p1: '', p2: '', score: '', status: 'Upcoming', winner: ''
      }))
    });
    matches /= 2;
  }
  return rounds;
}

/* ============================================================
   ROUND ROBIN GROUPS
   Snake seeding: with 2 groups and seeds 1,2,3,4 the order is
   A, B, B, A — so the strongest are kept apart.
   ============================================================ */
function buildGroups(entries, groupCount, opts = {}) {
  const rand = opts.rand || Math.random;
  if (groupCount < 1) throw new Error('A draw needs at least one group.');
  if (entries.length < groupCount) throw new Error('More groups than players.');

  const seeded = entries
    .filter(e => Number.isFinite(Number(e.seed)) && Number(e.seed) >= 1)
    .sort((a, b) => Number(a.seed) - Number(b.seed));
  const rest = shuffle(entries.filter(e => !seeded.includes(e)), rand);
  const ordered = [...seeded, ...rest];

  const groups = Array.from({ length: groupCount }, (_, i) => ({
    name: 'Group ' + String.fromCharCode(65 + i),
    players: [],
    matches: []
  }));

  ordered.forEach((player, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    const target = row % 2 === 0 ? col : groupCount - 1 - col;   // snake
    groups[target].players.push(player);
  });

  for (const g of groups) g.matches = roundRobinFixtures(g.players);

  return { format: 'groups', groupCount, groups };
}

/* Every player meets every other player once (circle method). */
function roundRobinFixtures(players) {
  const list = players.map(p => p.name);
  if (list.length < 2) return [];
  const fixtures = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      fixtures.push({ p1: list[i], p2: list[j], score: '', status: 'Upcoming', winner: '' });
    }
  }
  return fixtures;
}

/* Group table, ordered by matches won then games difference. */
function standings(group) {
  const table = new Map();
  for (const p of group.players) {
    table.set(p.name, { name: p.name, club: p.club || '', played: 0, won: 0, lost: 0, gf: 0, ga: 0 });
  }

  for (const m of group.matches || []) {
    if (m.winner !== '1' && m.winner !== '2') continue;
    const a = table.get(m.p1), b = table.get(m.p2);
    if (!a || !b) continue;

    a.played++; b.played++;
    if (m.winner === '1') { a.won++; b.lost++; } else { b.won++; a.lost++; }

    /* Count games from a score like "11-6, 9-11, 11-4" when it is there. */
    for (const part of String(m.score || '').split(',')) {
      const bits = part.trim().split('-').map(n => parseInt(n, 10));
      if (bits.length === 2 && bits.every(Number.isFinite)) {
        if (bits[0] > bits[1]) { a.gf++; b.ga++; } else { b.gf++; a.ga++; }
      }
    }
  }

  return [...table.values()].sort((x, y) =>
    y.won - x.won || (y.gf - y.ga) - (x.gf - x.ga) || x.name.localeCompare(y.name));
}


/* ============================================================
   MATCHES — turn a draw into a list of matches to schedule.
   Knockout: every match of every round (later rounds start with
   unknown players and fill in as winners come through). Byes are
   settled straight away. Groups: every fixture in every group.
   The organiser then adds court, time and referee to each.
   ============================================================ */
function matchesFromDraw(draw) {
  const P = p => p ? { name: p.name, club: p.club || '', country: p.country || '' } : null;
  const blank = (id, round, no) => ({
    id, round, no, p1: null, p2: null, court: '', time: '', referee: '',
    status: 'scheduled', winner: '', score: ''
  });
  const out = [];

  if (draw.format === 'groups') {
    (draw.groups || []).forEach((g, gi) => {
      g.matches.forEach((f, n) => {
        const m = blank(`g${gi + 1}m${n + 1}`, g.name, n + 1);
        const find = name => g.players.find(p => p.name === name);
        m.p1 = P(find(f.p1)); m.p2 = P(find(f.p2));
        m.ref = { g: gi, n };
        out.push(m);
      });
    });
    return out;
  }

  (draw.rounds || []).forEach((r, ri) => {
    r.matches.forEach((_, mi) => {
      const m = blank(`r${ri + 1}m${mi + 1}`, r.name, mi + 1);
      if (ri === 0) {
        m.p1 = P(draw.slots[mi * 2].player);
        m.p2 = P(draw.slots[mi * 2 + 1].player);
        m.open = !!(draw.slots[mi * 2].open || draw.slots[mi * 2 + 1].open);
      }
      m.ref = { ri, mi };
      out.push(m);
    });
  });

  /* A bye is a win without playing: move that player on. */
  for (const m of out.filter(x => x.ref.ri === 0)) {
    if (m.open || (m.p1 && m.p2) || (!m.p1 && !m.p2)) continue;
    m.status = 'bye';
    m.winner = m.p1 ? 0 : 1;
    const next = out.find(x => x.ref.ri === 1 && x.ref.mi === Math.floor(m.ref.mi / 2));
    if (next) next[m.ref.mi % 2 === 0 ? 'p1' : 'p2'] = m.p1 || m.p2;
  }
  return out;
}

/* Available to the browser and to node, so the same code is tested
   and shipped. */
const DrawLogic = {
  shuffle, drawSizeFor, seedOrder, seedBlocks,
  buildKnockout, blankKnockout, buildGroups, roundRobinFixtures, standings, matchesFromDraw
};
if (typeof window !== 'undefined') window.DrawLogic = DrawLogic;
if (typeof module !== 'undefined' && module.exports) module.exports = DrawLogic;
