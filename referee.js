/* ============================================================
   referee.js — the referee's scoring pad

   Lives on referee.html, behind a password. Viewers never load
   this file; they see the read-only portal and scoreboard.

   A note on the password: this page asks for it so the controls
   are not left lying around, but the real protection is in the
   Worker — every publish is checked against DRAW_ADMIN_PASSWORD
   on the server, so nobody can push a fake score without it.
   ============================================================ */

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/* ============================================================
   REFEREE PAD
   PAR scoring: every rally is a point, the winner of the rally
   serves next, games go to 11 and must be won by two clear
   points. Match is best of five.
   ============================================================ */
const PAD_TARGET = 11;
const PAD_GAMES_TO_WIN = 3;
const PAD_WARMUP_MS = 5 * 60 * 1000;   // 5 minutes, half on each side
const PAD_REST_MS = 90 * 1000;         // rest between games
const PAD_REVIEWS = 2;                 // video reviews per player per game

let PAD_ID = Math.random().toString(36).slice(2, 10);
let pad = null;
let padLive = false;       // publishing to the site?
let padTimer = null;       // debounce handle for publishing
let padPanel = null;       // which decision panel is open: {type, p}  (screen only)

const newStats = () => ({
  decisions: 0, stroke: 0, yesLet: 0, noLet: 0, appeals: 0,
  reviews: 0, upheld: 0, overruled: 0, warnings: 0, injury: 0
});

function padFresh() {
  const now = Date.now();
  return {
    score: [0, 0],         // points in the current game
    games: [],             // finished games, e.g. [[11,7],[9,11]]
    gw: [],                // who won each finished game (0 or 1)
    server: null,          // 0, 1, or null before the first rally
    side: null,            // 'L' or 'R': the box the server serves from
    sideFree: true,        // true while the server may still pick the side
    matchId: null,         // which scheduled match this is, if any
    schedId: null,         // which schedule (tournament division) it belongs to
    tournamentId: '',
    phase: 'ready',        // ready -> warmup -> play -> interval -> play ... -> done
    phaseStart: now,
    phaseLen: 0,           // length of a timed phase (warm-up, rest), in ms
    done: false,
    winner: null,          // set when the match ends
    endNote: '',           // 'retired', 'conduct', ...
    rallies: [],           // every point, for the printed scoresheet
    reviews: [PAD_REVIEWS, PAD_REVIEWS],
    stats: [newStats(), newStats()],
    events: [],            // decisions, warnings, reviews, in order
    call: null,            // the last announcement, shown on the big screen
    started: now,          // match start
    gameStarted: null,     // current game start, for the game clock
    history: []
  };
}

function padSnapshot() {
  const { history, ...rest } = pad;
  return JSON.stringify(rest);
}

const val = id => (document.getElementById(id)?.value || '').trim();

function padCourt() {
  return val('padCourt') || '1';
}

function padMeta() {
  return {
    court: padCourt(),
    tournament: val('padTournament'),
    round: val('padRound'),
    players: [
      { name: val('padName0') || 'Player 1', dept: val('padDept0'), country: val('padCountry0') },
      { name: val('padName1') || 'Player 2', dept: val('padDept1'), country: val('padCountry1') }
    ]
  };
}

function padNames() {
  const m = padMeta();
  return [m.players[0].name, m.players[1].name];
}

function padGamesWon() {
  return [pad.gw.filter(w => w === 0).length, pad.gw.filter(w => w === 1).length];
}

/* A game is won at 11+ with a lead of two or more. */
function padGameWinner() {
  const [a, b] = pad.score;
  if (a >= PAD_TARGET && a - b >= 2) return 0;
  if (b >= PAD_TARGET && b - a >= 2) return 1;
  return null;
}

/* ============================================================
   MATCH PHASES
   ready    nothing started yet
   warmup   5 minutes, 2:30 on each side
   play     rallies are being scored
   interval 90 seconds between games
   done     match over
   ============================================================ */
function padLeft() {
  return Math.max(0, pad.phaseLen - (Date.now() - pad.phaseStart));
}

function padStartWarmup() {
  pad.phase = 'warmup';
  pad.phaseStart = Date.now();
  pad.phaseLen = PAD_WARMUP_MS;
  pad.call = null;
  padRender(); padPublishSoon();
}

function padStartGame() {
  const first = pad.games.length === 0;
  pad.phase = 'play';
  pad.phaseLen = 0;
  pad.gameStarted = Date.now();
  if (first) pad.started = pad.gameStarted;
  padRender(); padPublishSoon();
  if (first) padReportLive();
}

/* ============================================================
   SCORING

   SERVING RULES
   - The server serves from L or R. If the server wins the rally, the
     next serve is from the other box.
   - If the receiver wins, they become the server and may choose
     either box, so the side is left open until the referee picks it.
   - The winner of a game serves first in the next, and chooses a box.
   ============================================================ */
function padCanScore() {
  return !pad.done && pad.phase === 'play' && pad.server !== null && pad.side !== null;
}

function padLog(type, p, text) {
  pad.events.push({
    g: pad.games.length + 1, a: pad.score[0], b: pad.score[1], type, p, text
  });
  pad.call = { text, at: Date.now() };
}

/* Award a rally to player i. `why` says if it was a decision. */
function padScore(i, why) {
  const before = { sv: pad.server, sd: pad.side };
  pad.score[i]++;
  pad.rallies.push({
    g: pad.games.length + 1,            // which game
    w: i,                               // who won the rally
    a: pad.score[0], b: pad.score[1],   // running score after it
    sv: before.sv, sd: before.sd,       // who served, from which side
    ...(why ? { why } : {})
  });

  if (i === before.sv) {                // server won: other box next
    pad.side = before.sd === 'L' ? 'R' : 'L';
    pad.sideFree = false;
  } else {                              // receiver won: new server, free choice
    pad.server = i;
    pad.side = null;
    pad.sideFree = true;
  }

  const w = padGameWinner();
  if (w !== null) padFinishGame(w);
}

function padFinishGame(w, why) {
  pad.games.push([pad.score[0], pad.score[1]]);
  pad.gw.push(w);
  pad.score = [0, 0];
  pad.server = w;                       // game winner serves first next game
  pad.side = null;
  pad.sideFree = true;
  pad.reviews = [PAD_REVIEWS, PAD_REVIEWS];
  pad.gameStarted = null;
  if (padGamesWon()[w] >= PAD_GAMES_TO_WIN) {
    padEndMatch(w, why);
  } else {
    pad.phase = 'interval';             // 90 seconds before the next game
    pad.phaseStart = Date.now();
    pad.phaseLen = PAD_REST_MS;
  }
}

function padEndMatch(w, why) {
  pad.done = true;
  pad.endedAt = Date.now();
  pad.winner = w;
  pad.endNote = why || '';
  pad.phase = 'done';
  pad.gameStarted = null;
  padArchive();                         // keep it for the printed scoresheet
  padReportResult(w);
}

function padPoint(i) {
  if (!padCanScore()) return;
  pad.history.push(padSnapshot());
  padScore(i);
  padRender();
  padPublishSoon();
}

/* ---------- Decisions ----------
   A player asks for a decision; the referee rules:
     stroke   the point goes to the player who asked
     yes let  replay the rally, no point
     no let   the point goes to the other player
   Appeals and video reviews are counted too. */
function padDecision(p, kind) {
  if (!padCanScore()) return;
  pad.history.push(padSnapshot());
  const s = pad.stats[p];
  const name = padNames()[p];
  s.decisions++;

  if (kind === 'stroke') {
    s.stroke++;
    padLog('stroke', p, `Stroke — ${name}`);
    padScore(p, 'stroke');
  } else if (kind === 'yesLet') {
    s.yesLet++;
    padLog('yesLet', p, 'Yes let');
  } else if (kind === 'noLet') {
    s.noLet++;
    padLog('noLet', p, 'No let');
    padScore(1 - p, 'noLet');
  } else if (kind === 'appeal') {
    s.decisions--;                      // an appeal is not a new decision
    s.appeals++;
    padLog('appeal', p, `Appeal — ${name}`);
  }
  padPanel = null;
  padRender(); padPublishSoon();
}

/* A video review of the last call. Upheld costs the player a review;
   overruled does not — the last call is taken back and the referee
   makes the new one. */
function padReview(p, outcome) {
  if (pad.reviews[p] < 1 || pad.done) return;
  const name = padNames()[p];

  if (outcome === 'upheld') {
    pad.reviews[p]--;
    pad.stats[p].reviews++;
    pad.stats[p].upheld++;
    padLog('review', p, 'Decision upheld');
    padPanel = null;
  } else {
    const prev = pad.history.pop();
    if (prev) {
      const h = pad.history;
      Object.assign(pad, JSON.parse(prev));
      pad.history = h;
    }
    pad.stats[p].reviews++;
    pad.stats[p].overruled++;
    padLog('review', p, 'Decision overruled');
    padPanel = { type: 'decision', p };          // referee now makes the new call
  }
  padRender(); padPublishSoon();
}

/* ---------- Conduct and options ---------- */
function padConduct(p, kind) {
  if (pad.done) return;
  const name = padNames()[p];
  const opp = padNames()[1 - p];

  if (kind === 'game' && !confirm(`Award the game to ${opp}?`)) return;
  if (kind === 'match' && !confirm(`Award the match to ${opp}?`)) return;
  if (kind === 'stroke' && !padCanScore()) return;

  pad.history.push(padSnapshot());
  if (kind === 'warning') {
    pad.stats[p].warnings++;
    padLog('warning', p, `Conduct warning — ${name}`);
  } else if (kind === 'stroke') {
    padLog('conduct', p, `Conduct stroke — ${name}`);
    padScore(1 - p, 'conduct');
  } else if (kind === 'game') {
    padLog('conduct', p, `Conduct game — ${name}`);
    padFinishGame(1 - p, 'conduct');
  } else if (kind === 'match') {
    padLog('conduct', p, `Conduct match — ${name}`);
    padEndMatch(1 - p, 'conduct');
  }
  padPanel = null;
  padRender(); padPublishSoon();
}

function padOption(p, kind) {
  if (pad.done) return;
  const name = padNames()[p];
  const opp = padNames()[1 - p];

  if (kind === 'concede' && !confirm(`${name} concedes the game. ${opp} wins it. Continue?`)) return;
  if (kind === 'retire' && !confirm(`${name} retires and loses the match. ${opp} wins. Continue?`)) return;
  if (kind === 'concede' && pad.phase !== 'play') return;

  pad.history.push(padSnapshot());
  if (kind === 'injury') {
    pad.stats[p].injury++;
    padLog('injury', p, `Injury break — ${name}`);
  } else if (kind === 'concede') {
    padLog('concede', p, `${name} concedes the game`);
    padFinishGame(1 - p, 'concede');
  } else if (kind === 'retire') {
    padLog('retire', p, `${name} retires`);
    padEndMatch(1 - p, 'retired');
  }
  padPanel = null;
  padRender(); padPublishSoon();
}

function padPickServer(i) {
  if (pad.done || pad.score[0] || pad.score[1] || !pad.sideFree) return;
  pad.server = i;
  padRender();
  padPublishSoon();
}

function padPickSide(side) {
  if (pad.done || pad.server === null || !pad.sideFree) return;
  pad.side = side;
  padRender();
  padPublishSoon();
}

function padUndo() {
  const prev = pad.history.pop();
  if (!prev) return;
  const h = pad.history;
  Object.assign(pad, JSON.parse(prev));
  pad.history = h;
  padPanel = null;
  padRender();
  padPublishSoon();
}

/* ---------- Completed matches, kept on this device for printing ---------- */
const PAD_STORE = 'nr-matches';

function padScoreString() {
  return pad.games.map(g => g[0] + '-' + g[1]).join(', ') +
    (pad.endNote === 'retired' ? ' (ret.)' : pad.endNote === 'conduct' ? ' (conduct)' : '');
}

function padArchive() {
  try {
    const m = padMeta();
    const all = JSON.parse(localStorage.getItem(PAD_STORE) || '[]');
    all.unshift({
      id: 'm' + Date.now(),
      match_id: pad.matchId,
      referee: sessionStorage.getItem(NAME_KEY) || '',
      tournament: m.tournament,
      round: m.round,
      court: m.court,
      players: m.players,
      games: pad.games,
      games_won: padGamesWon(),
      winner: pad.winner,
      end_note: pad.endNote,
      stats: pad.stats,
      events: pad.events,
      rallies: pad.rallies,
      started: pad.started,
      finished: Date.now()
    });
    localStorage.setItem(PAD_STORE, JSON.stringify(all.slice(0, 200)));
  } catch (err) {
    console.warn('Could not save the scoresheet on this device:', err);
  }
}

/* ---------- Publishing ---------- */
function padPayload() {
  const m = padMeta();
  const now = Date.now();
  return {
    live: !pad.done,
    court: m.court,
    tournament: m.tournament,
    round: m.round,
    players: m.players,
    score: pad.score,
    games: pad.games,
    games_won: padGamesWon(),
    server: pad.server,
    side: pad.side,
    match_id: pad.matchId,
    sched_id: pad.schedId,
    tournament_id: pad.tournamentId,
    phase: pad.phase,
    phase_left: pad.phase === 'warmup' || pad.phase === 'interval' ? padLeft() : null,
    phase_len: pad.phaseLen,
    call: pad.call ? { text: pad.call.text, age: now - pad.call.at } : null,
    reviews: pad.reviews,
    winner: pad.winner,
    end_note: pad.endNote,
    done: pad.done,
    started: pad.started,
    game_started: pad.gameStarted,
    rallies: pad.rallies.slice(-40),
    ended: pad.endedAt || null,
    pad_id: PAD_ID,
    updated: now
  };
}

/* Nothing goes on the big screen until a match is chosen or the referee
   starts scoring — signing in alone must not put "Player 1 v Player 2" up. */
let padTouched = false;
function padActive() {
  return !!pad.matchId || padTouched || pad.server !== null || pad.games.length > 0 ||
         pad.score[0] > 0 || pad.score[1] > 0 || pad.phase !== 'ready';
}

async function padPublish() {
  if (!padLive) return;
  const state = document.getElementById('padLiveState');
  if (!padActive()) {
    state.textContent = 'Ready. Nothing is shown on the site until you pick a match or start scoring.';
    state.className = 'pad__publish-state';
    return;
  }
  try {
    const res = await fetch('/api/live?court=' + encodeURIComponent(padCourt()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': sessionStorage.getItem('nr-pass') || ''
      },
      body: JSON.stringify(padPayload())
    });
    if (res.status === 401) {
      padSetLive(false);
      state.textContent = 'Wrong password — publishing stopped.';
      state.className = 'pad__publish-state pad__publish-state--bad';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.textContent = 'Publishing live · last sent ' +
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    state.className = 'pad__publish-state pad__publish-state--good';
  } catch (err) {
    state.textContent = 'Could not reach the server — will retry on the next point.';
    state.className = 'pad__publish-state pad__publish-state--bad';
  }
}

/* Publishing is throttled so a fast rally sequence is not one write per tap. */
function padPublishSoon() {
  if (!padLive) return;
  clearTimeout(padTimer);
  padTimer = setTimeout(padPublish, 1200);
}

function padSetLive(on) {
  padLive = on;
  const btn = document.getElementById('padGoLive');
  const state = document.getElementById('padLiveState');
  btn.textContent = on ? 'Stop publishing' : 'Go live';
  btn.className = on ? 'btn btn--ghost' : 'btn btn--solid';
  if (!on) {
    state.textContent = 'Not publishing.';
    state.className = 'pad__publish-state';
  }
}

/* ============================================================
   DRAWING THE PAD
   ============================================================ */
const mmss = ms => {
  const t = Math.ceil(Math.max(0, ms) / 1000);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};

function padRenderServeBar(names) {
  const bar = document.getElementById('padServeBar');
  if (!bar) return;
  const fresh = !pad.score[0] && !pad.score[1];
  const needServer = !pad.done && pad.games.length === 0 && fresh && pad.sideFree;
  const needSide = !pad.done && pad.sideFree && pad.server !== null;
  bar.hidden = !(needServer || needSide);
  if (bar.hidden) { bar.innerHTML = ''; return; }

  let html = '';
  if (needServer) {
    html += `<p class="pad__serve-q">Who serves first?</p><div class="pad__serve-grid">` +
      [0, 1].map(i => `<button class="pad__chip${pad.server === i ? ' pad__chip--on' : ''}" data-srv="${i}">${esc(names[i])}</button>`).join('') +
      `</div>`;
  }
  if (needSide) {
    html += `<p class="pad__serve-q">${esc(names[pad.server])} serves from</p><div class="pad__serve-grid">` +
      ['L', 'R'].map(sd => `<button class="pad__chip pad__chip--side${pad.side === sd ? ' pad__chip--on' : ''}" data-sd="${sd}"
        aria-label="Serve from ${sd === 'L' ? 'left' : 'right'}">${sd}</button>`).join('') + `</div>`;
  }
  bar.innerHTML = html;
}

/* Warm-up, rest, and the button that moves on. Counts down live. */
function padRenderPhase() {
  const box = document.getElementById('padPhase');
  if (!box) return;
  const next = pad.games.length + 1;

  if (pad.phase === 'play' || pad.phase === 'done') { box.hidden = true; return; }
  box.hidden = false;

  if (pad.phase === 'ready') {
    box.innerHTML = `
      <p class="pad__phase-title">Ready</p>
      <p class="pad__phase-note">Warm-up is 5 minutes — 2:30 on each side.</p>
      <div class="pad__controls">
        <button class="btn btn--solid" data-act="warmup">Start warm-up</button>
        <button class="btn btn--ghost" data-act="start">Skip — start game 1</button>
      </div>`;
  } else if (pad.phase === 'warmup') {
    box.innerHTML = `
      <p class="pad__phase-title" id="padPhaseTitle"></p>
      <p class="pad__phase-clock" id="padPhaseClock"></p>
      <div class="pad__controls">
        <button class="btn btn--solid" data-act="start">End warm-up — start game 1</button>
      </div>`;
  } else if (pad.phase === 'interval') {
    box.innerHTML = `
      <p class="pad__phase-title" id="padPhaseTitle"></p>
      <p class="pad__phase-clock" id="padPhaseClock"></p>
      <div class="pad__controls">
        <button class="btn btn--solid" data-act="start">Start game ${next}</button>
      </div>`;
  }
  padTick();
}

function padTick() {
  if (!pad) return;
  const tm = document.getElementById('padTimer');
  if (tm) {
    if (pad.phase === 'play' && pad.started && !pad.done) {
      tm.hidden = false;
      tm.textContent = 'Match ' + mmss(Date.now() - pad.started) +
        (pad.gameStarted ? '  \u00b7  Game ' + (pad.games.length + 1) + ' ' + mmss(Date.now() - pad.gameStarted) : '');
    } else tm.hidden = true;
  }
  const title = document.getElementById('padPhaseTitle');
  const clock = document.getElementById('padPhaseClock');
  if (!title || !clock) return;
  const left = padLeft();

  if (pad.phase === 'warmup') {
    const second = left <= PAD_WARMUP_MS / 2;
    title.textContent = left === 0 ? 'Warm-up over' :
      second ? 'Warm-up · second half — players have switched sides'
             : 'Warm-up · first half';
    clock.textContent = left === 0 ? '0:00' : mmss(left);
    clock.className = 'pad__phase-clock' + (left === 0 ? ' pad__phase-clock--over' : '');
  } else if (pad.phase === 'interval') {
    title.textContent = left === 0 ? `Time — start game ${pad.games.length + 1}`
                                   : `Rest before game ${pad.games.length + 1}`;
    clock.textContent = mmss(left);
    clock.className = 'pad__phase-clock' + (left === 0 ? ' pad__phase-clock--over' : '');
  }
}

/* The decision / conduct / options panel */
function padRenderPanel() {
  const box = document.getElementById('padPanel');
  const actions = document.getElementById('padActions');
  if (!box || !actions) return;
  const names = padNames();

  /* Always-visible buttons under the scores */
  const live = padCanScore();
  actions.hidden = pad.done;
  actions.innerHTML = [0, 1].map(i => `
    <div class="pad__act-col">
      <button class="btn btn--ghost" data-act="open:decision:${i}" ${live ? '' : 'disabled'}>Decision · ${esc(names[i])}</button>
    </div>`).join('') +
    `<div class="pad__act-col pad__act-col--wide">
      <button class="btn btn--ghost" data-act="open:options:0">Options · conduct · injury · retire</button>
    </div>`;

  if (!padPanel || pad.done) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  const { type, p } = padPanel;
  const b = (act, label, cls = '') =>
    `<button class="pad__opt ${cls}" data-act="${act}">${label}</button>`;
  const cancel = b('close', 'Cancel', 'pad__opt--cancel');

  if (type === 'decision') {
    box.innerHTML = `<h3 class="pad__panel-title">Decision — ${esc(names[p])}</h3>
      <div class="pad__panel-row">
        ${b(`decision:${p}:stroke`, 'Stroke', 'pad__opt--purple')}
        ${b(`decision:${p}:yesLet`, 'Yes let', 'pad__opt--purple')}
        ${b(`decision:${p}:noLet`, 'No let', 'pad__opt--purple')}
      </div>
      <div class="pad__panel-row">
        ${b(`decision:${p}:appeal`, 'Appeal', 'pad__opt--grey')}
        ${cancel}
      </div>`;
  } else if (type === 'conduct') {
    box.innerHTML = `<h3 class="pad__panel-title">Conduct — ${esc(names[p])}</h3>
      <div class="pad__panel-row">
        ${b(`conduct:${p}:warning`, 'Warning', 'pad__opt--orange')}
        ${b(`conduct:${p}:stroke`, 'Stroke', 'pad__opt--orange')}
        ${b(`conduct:${p}:game`, 'Game', 'pad__opt--orange')}
        ${b(`conduct:${p}:match`, 'Match', 'pad__opt--orange')}
        ${cancel}
      </div>`;
  } else if (type === 'options') {
    box.innerHTML = `<h3 class="pad__panel-title">Options</h3>
      <div class="pad__panel-cols">
        ${[0, 1].map(i => `
          <div class="pad__panel-col">
            <p class="pad__panel-who">${esc(names[i])}</p>
            ${b(`open:conduct:${i}`, 'Conduct', 'pad__opt--orange')}
            ${b(`option:${i}:injury`, 'Injury break', 'pad__opt--teal')}
            ${b(`option:${i}:concede`, 'Concede game', 'pad__opt--brown')}
            ${b(`option:${i}:retire`, 'Retirement', 'pad__opt--red')}
          </div>`).join('')}
      </div>
      <div class="pad__panel-row">${cancel}</div>`;
  }
}

const STAT_ROWS = [
  ['decisions', 'Decisions'], ['stroke', 'Strokes'], ['yesLet', 'Yes lets'],
  ['noLet', 'No lets'], ['appeals', 'Appeals'],
  ['upheld', 'Upheld'], ['overruled', 'Overruled'], ['warnings', 'Warnings']
];

function padRenderStats(names) {
  const box = document.getElementById('padStats');
  if (!box) return;
  box.innerHTML = `<table class="table pad__stats"><thead><tr><th></th>
    <th>${esc(names[0])}</th><th>${esc(names[1])}</th></tr></thead><tbody>` +
    STAT_ROWS.map(([k, label]) =>
      `<tr><td>${label}</td><td>${pad.stats[0][k]}</td><td>${pad.stats[1][k]}</td></tr>`).join('') +
    '</tbody></table>';
}

/* ============================================================
   THE ANNOUNCEMENT
   Said before the match, and again after each game. Once play
   starts it disappears and only the tournament name stays, so
   the referee has nothing extra to look at.
   ============================================================ */
function padAnnouncement() {
  const m = padMeta();
  const [a, b] = m.players;
  const who = p => p.name + (p.country ? ' of ' + p.country : '');
  const won = padGamesWon();
  const names = [a.name, b.name];
  const serve = pad.server === null ? '' : `${names[pad.server]} to serve`;

  if (pad.done) {
    const w = pad.winner ?? (won[0] > won[1] ? 0 : 1);
    return `Game and match to ${names[w]}, ${won[w]} games to ${won[1 - w]}. ` +
      (pad.endNote === 'retired' ? `${names[1 - w]} has retired. ` : '') +
      pad.games.map(g => g[0] + '-' + g[1]).join(', ') + '.';
  }

  if (pad.games.length > 0) {          // between games, and at 0-0 of the next one
    const n = pad.games.length;
    const g = pad.games[n - 1];
    const w = pad.gw[n - 1];
    const hi = Math.max(g[0], g[1]), lo = Math.min(g[0], g[1]);
    const lead = won[0] === won[1]
      ? (won[0] === 1 ? 'One game all' : `${won[0]} games all`)
      : `${names[won[0] > won[1] ? 0 : 1]} leads ${Math.max(...won)}\u2013${Math.min(...won)}`;
    return `${hi}\u2013${lo}, game to ${names[w]}. ${lead}.` +
      `  Game ${n + 1}${serve ? ': ' + serve : ''}. Love all.`;
  }

  /* ready / warm-up */
  const round = m.round ? `${m.round} match` : 'match';
  return `${m.tournament ? m.tournament + ', ' : ''}${round}, ${who(a)} versus ${who(b)}, ` +
    `best of ${PAD_GAMES_TO_WIN * 2 - 1} games, ` +
    (serve ? serve + '. ' : 'choose who serves first. ') + 'Love all.';
}

function padRenderAnnounce() {
  const title = document.getElementById('padTitle');
  const box = document.getElementById('padAnnounce');
  const m = padMeta();
  title.textContent = m.tournament;
  title.hidden = !m.tournament;

  const fresh = !pad.score[0] && !pad.score[1];
  const show = pad.done || pad.phase === 'interval' || fresh;
  box.hidden = !show;
  if (show) box.textContent = padAnnouncement();

  /* In play: nothing but the score and the controls */
  const root = document.getElementById('refPad');
  root.classList.toggle('pad--play', pad.phase === 'play' || (!!pad.matchId && pad.phase !== 'ready'));
}

/* The match in progress is kept on this device, so closing the tab or
   visiting another page does not lose it. */
const PAD_KEEP = 'nr-pad-active';
const PAD_FIELDS = ['padCourt', 'padTournament', 'padRound', 'padName0', 'padDept0', 'padCountry0', 'padName1', 'padDept1', 'padCountry1'];
function padSave() {
  try {
    if (!pad) return;
    const fields = {};
    PAD_FIELDS.forEach(f => { const el = document.getElementById(f); if (el) fields[f] = el.value; });
    localStorage.setItem(PAD_KEEP, JSON.stringify({
      pad, fields, padId: PAD_ID, touched: padTouched,
      who: sessionStorage.getItem(NAME_KEY) || '', at: Date.now()
    }));
  } catch { /* storage full or blocked — scoring carries on */ }
}
function padRestore() {
  try {
    const s = JSON.parse(localStorage.getItem(PAD_KEEP) || 'null');
    if (!s || !s.pad || Date.now() - s.at > 12 * 3600 * 1000) return false;
    const me = sessionStorage.getItem(NAME_KEY) || '';
    if (s.who && me && s.who !== me) return false;
    pad = Object.assign(padFresh(), s.pad, { history: s.pad.history || [] });
    PAD_ID = s.padId || PAD_ID;
    padTouched = true;
    Object.entries(s.fields || {}).forEach(([f, v]) => { const el = document.getElementById(f); if (el) el.value = v; });
    return true;
  } catch { return false; }
}

function padRender() {
  padSave();
  const names = padNames();
  const won = padGamesWon();

  for (let i = 0; i < 2; i++) {
    document.getElementById('padScore' + i).textContent = pad.score[i];
    document.getElementById('padLabel' + i).textContent = names[i];
    const sv = document.getElementById('padServe' + i);
    sv.style.visibility = (pad.server === i && !pad.done) ? 'visible' : 'hidden';
    sv.textContent = pad.side ? 'serving from ' + pad.side : 'serving — pick a side';
    document.getElementById('padSide' + i).disabled = !padCanScore();
  }
  padRenderServeBar(names);
  padRenderPhase();
  padRenderPanel();
  padRenderStats(names);
  padRenderAnnounce();
  padTick();

  document.getElementById('padGames').innerHTML =
    `<span class="pad__gamecount">${won[0]}</span>
     <span class="pad__gamelabel">games</span>
     <span class="pad__gamecount">${won[1]}</span>`;

  const st = document.getElementById('padStatus');
  if (pad.done) {
    const w = pad.winner ?? (won[0] > won[1] ? 0 : 1);
    st.textContent = `${names[w]} wins the match ${won[w]}–${won[1 - w]}` +
      (pad.endNote === 'retired' ? ' (retirement)' : pad.endNote === 'conduct' ? ' (conduct)' : '');
    st.className = 'pad__status pad__status--done';
  } else if (pad.phase !== 'play') {
    st.textContent = pad.phase === 'ready' ? 'Start the warm-up or the game.'
      : pad.phase === 'warmup' ? 'Warm-up in progress.' : 'Rest between games.';
    st.className = 'pad__status';
  } else if (!padCanScore()) {
    st.textContent = pad.server === null
      ? 'Choose who serves first, then the side.'
      : `${names[pad.server]} — choose L or R to serve from.`;
    st.className = 'pad__status pad__serve-need';
  } else {
    const [a, b] = pad.score;
    let note = `Game ${pad.games.length + 1} · first to ${PAD_TARGET}, win by 2`;
    if (a >= PAD_TARGET - 1 && b >= PAD_TARGET - 1) note = `Game ${pad.games.length + 1} · two clear points needed`;
    else if (a >= PAD_TARGET - 1 && a - b >= 1) note = `Game ball — ${names[0]}`;
    else if (b >= PAD_TARGET - 1 && b - a >= 1) note = `Game ball — ${names[1]}`;
    st.textContent = note;
    st.className = 'pad__status';
  }

  const hist = document.getElementById('padHistory');
  hist.innerHTML = pad.games.length
    ? pad.games.map((g, n) => `
      <li><span class="pad__gameno">Game ${n + 1}</span>
      <span class="pad__gamescore">${g[0]}–${g[1]}</span></li>`).join('')
    : '<li class="pad__empty">No games finished yet.</li>';

  document.getElementById('padUndo').disabled = pad.history.length === 0;
}

/* Every button in the new areas carries data-act="what:who:which". */
function padAct(act) {
  const [what, a, b] = act.split(':');
  if (what === 'warmup') return padStartWarmup();
  if (what === 'start') return padStartGame();
  if (what === 'close') { padPanel = null; return padRender(); }
  if (what === 'open') { padPanel = { type: a, p: Number(b) || 0 }; return padRender(); }
  if (what === 'decision') return padDecision(Number(a), b);
  if (what === 'review') return padReview(Number(a), b);
  if (what === 'conduct') return padConduct(Number(a), b);
  if (what === 'option') return padOption(Number(a), b);
}

function padInit() {
  if (!document.getElementById('padSide0')) return;
  pad = padFresh();
  const restored = padRestore();

  document.querySelectorAll('.pad__side').forEach(btn => {
    btn.addEventListener('click', () => padPoint(Number(btn.dataset.player)));
  });
  document.getElementById('padUndo').addEventListener('click', padUndo);
  document.getElementById('padDetails').addEventListener('click', () =>
    document.getElementById('refPad').classList.toggle('pad--details'));

  document.getElementById('padServeBar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.srv !== undefined) padPickServer(Number(b.dataset.srv));
    if (b.dataset.sd) padPickSide(b.dataset.sd);
  });

  ['padPhase', 'padActions', 'padPanel'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) padAct(b.dataset.act);
    });
  });
  setInterval(padTick, 500);
  setInterval(() => { if (padLive) padPublish(); }, 60000);   // heartbeat: keeps a quiet match on the live page

  document.getElementById('padMineRefresh').addEventListener('click', loadMine);
  document.getElementById('padMineList').addEventListener('click', e => {
    const b = e.target.closest('[data-start]');
    if (b) startScheduled(b.dataset.start);
  });

  document.getElementById('padReset').addEventListener('click', () => {
    if (pad.games.length || pad.score[0] || pad.score[1]) {
      if (!confirm('Start a new match? The current score will be cleared.')) return;
    }
    pad = padFresh();
    padTouched = false;
    padPanel = null;
    padRender();
    padPublishSoon();
  });

  /* The password came from the login, so this is just an on/off switch. */
  document.getElementById('padGoLive').addEventListener('click', () => {
    if (padLive) { padSetLive(false); return; }
    if (!sessionStorage.getItem('nr-pass')) {
      const state = document.getElementById('padLiveState');
      state.textContent = 'Sign in again to publish.';
      state.className = 'pad__publish-state pad__publish-state--bad';
      return;
    }
    padSetLive(true);
    padPublish();
  });

  ['padName0', 'padName1', 'padDept0', 'padDept1', 'padCountry0', 'padCountry1', 'padTournament', 'padRound', 'padCourt']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { padTouched = true; padRender(); padPublishSoon(); });
    });

  padRender();
}


/* ---------- Matches assigned to this referee ---------- */
let schedules = [];

const fmtTime = t => {
  if (!t) return 'time not set';
  const d = new Date(t);
  return isNaN(d) ? t : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

async function loadMine() {
  const box = document.getElementById('padMineList');
  try {
    const res = await fetch('/api/schedule', { cache: 'no-store' });
    schedules = res.ok ? (await res.json()).schedules || [] : [];
  } catch { schedules = []; }

  /* A tournament deleted from the site must disappear from here too. */
  let orphans = [];
  try {
    const tr = await fetch('/api/tournaments', { cache: 'no-store' }).then(r => r.ok ? r : fetch('/content/tournaments.json', { cache: 'no-store' }));
    if (tr.ok) {
      const live = new Set(((await tr.json()).tournaments || []).map(t => t.id));
      const tid = s => s.tournamentId || String(s.id || '').split('__')[0];
      orphans = schedules.filter(s => !live.has(tid(s)));
      schedules = schedules.filter(s => live.has(tid(s)));
    }
  } catch { /* keep everything if the list cannot be read */ }
  const cleanup = (sessionStorage.getItem(NAME_KEY) === 'Admin' && orphans.length)
    ? `<p class="pad__empty">${orphans.length} old schedule${orphans.length > 1 ? 's' : ''} from deleted tournaments. <button class="btn btn--ghost" id="padPurge">Delete ${orphans.length === 1 ? 'it' : 'them'}</button></p>` : '';
  const pb = () => { const b = document.getElementById('padPurge'); if (b) b.onclick = async () => {
    if (!confirm('Delete the old schedules and draws of removed tournaments?')) return;
    b.disabled = true;
    for (const s of orphans) await fetch('/api/schedule?id=' + encodeURIComponent(s.id), { method: 'DELETE', headers: { 'x-admin-password': sessionStorage.getItem(PASS_KEY) || '' } });
    loadMine();
  }; };

  if (!schedules.length) {
    box.innerHTML = '<p class="pad__empty">No schedule is published yet. You can still score a match by hand below.</p>' + cleanup;
    pb();
    return;
  }

  const me = sessionStorage.getItem(NAME_KEY) || '';
  const mine = [];
  schedules.forEach(s => (s.matches || []).forEach(m => {
    if (!m.p1 || !m.p2 || m.status === 'done' || m.status === 'bye') return;
    if (me !== 'Admin' && m.referee !== me) return;
    mine.push({ ...m, sid: s.id, tournament: s.tournament, event: s.event });
  }));
  mine.sort((a, b) => String(a.time || '9999').localeCompare(String(b.time || '9999')));

  box.innerHTML = mine.length ? mine.map(m => `
    <div class="mine__card${pad && pad.schedId === m.sid && pad.matchId === m.id ? ' mine__card--on' : ''}">
      <div>
        <div class="mine__when">${esc(fmtTime(m.time))}${m.court ? ' · Court ' + esc(m.court) : ''}</div>
        <div class="mine__who">${esc(m.p1.name)} <span class="mine__meta">v</span> ${esc(m.p2.name)}</div>
        <div class="mine__meta">${esc(m.tournament || '')} · ${esc(m.event || '')} · ${esc(m.round)}${me === 'Admin' && m.referee ? ' · ' + esc(m.referee) : ''}</div>
      </div>
      <button class="btn btn--solid" data-start="${esc(m.sid)}|${esc(m.id)}">Score this match</button>
    </div>`).join('')
    : `<p class="pad__empty">Nothing is assigned to <strong>${esc(me)}</strong> right now.</p>${padWhyEmpty(me)}`;
  box.insertAdjacentHTML('beforeend', cleanup);
  pb();
}

/* When the list is empty, say why — it is nearly always a name mismatch,
   a match whose players are not known yet, or a schedule never saved. */
function padWhyEmpty(me) {
  let total = 0, open = 0, unassigned = 0, tbd = 0;
  const names = {};
  schedules.forEach(s => (s.matches || []).forEach(m => {
    if (m.status === 'bye') return;
    total++;
    if (m.status === 'done') return;
    if (!m.p1 || !m.p2) { tbd++; return; }
    open++;
    if (!m.referee) unassigned++;
    else names[m.referee] = (names[m.referee] || 0) + 1;
  }));
  const who = Object.entries(names).map(([n, c]) => `${esc(n)} (${c})`).join(', ') || 'nobody';
  return `<p class="pad__empty">Published: ${schedules.length} draw${schedules.length === 1 ? '' : 's'}, ${total} matches.
    Ready to play: ${open} — assigned to ${who}; not assigned: ${unassigned}. Waiting for players: ${tbd}.
    The name must match your login exactly.</p>`;
}

function startScheduled(key) {
  const [sid, mid] = String(key).split('|');
  const sc = schedules.find(x => x.id === sid);
  const m = sc && sc.matches.find(x => x.id === mid);
  if (!m) return;
  if (!(pad.schedId === sid && pad.matchId === mid) &&
      (pad.games.length || pad.score[0] || pad.score[1]) && !pad.done) {
    if (!confirm('Switch to this match? The score on the pad will be cleared.')) return;
  }
  const set = (f, v) => { const el = document.getElementById(f); if (el) el.value = v || ''; };
  set('padCourt', m.court || '1');
  set('padTournament', sc.tournament);
  set('padRound', [sc.event, m.round].filter(Boolean).join(' · '));
  set('padName0', m.p1.name); set('padDept0', m.p1.club);
  set('padName1', m.p2.name); set('padDept1', m.p2.club);
  set('padCountry0', m.p1.country); set('padCountry1', m.p2.country);

  pad = padFresh();
  pad.matchId = m.id;
  pad.schedId = sid;
  pad.tournamentId = sc.tournamentId || '';
  padTouched = true;
  padRender();
  padPublish();
  padReportLive();
  loadMine();
  window.scrollTo({ top: document.getElementById('padScore0').getBoundingClientRect().top + scrollY - 120, behavior: 'smooth' });
}

/* Tell the server this match is live / finished, so the schedule and the
   draw update and the winner moves on to the next round. */
async function padReport(body) {
  if (!pad.matchId || !pad.schedId || !sessionStorage.getItem(PASS_KEY)) return;
  try {
    await fetch('/api/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem(PASS_KEY) },
      body: JSON.stringify({ sid: pad.schedId, id: pad.matchId, ...body })
    });
  } catch (err) { console.warn('Could not report the result:', err); }
}
const padReportLive = () => padReport({ status: 'live' });
async function padReportResult(winner) {
  const score = padScoreString();
  await padReport({ status: 'done', winner, score });
  loadMine();
}

/* ---------- Login gate ---------- */
const PASS_KEY = 'nr-pass';
const NAME_KEY = 'nr-referee';

function showPad() {
  document.getElementById('refLogin').hidden = true;
  document.getElementById('refPad').hidden = false;
  const who = document.getElementById('refWho');
  const name = sessionStorage.getItem(NAME_KEY);
  if (who && name) {
    who.hidden = false;
    document.getElementById('refWhoName').textContent = name;
  }
  padInit();
  padSetLive(true);
  padPublish();
  loadMine();
}

async function tryLogin(pw) {
  const msg = document.getElementById('refLoginMsg');
  msg.textContent = 'Checking…';
  msg.className = 'ref-login__msg';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: '{}'
    });
    if (res.status === 401) {
      msg.textContent = 'Wrong password.';
      msg.className = 'ref-login__msg ref-login__msg--bad';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json().catch(() => ({}));
    sessionStorage.setItem(PASS_KEY, pw);
    sessionStorage.setItem(NAME_KEY, body.name || 'Referee');
    showPad();
  } catch (err) {
    msg.textContent = 'Could not reach the server. You can still score offline — ' +
                      'the match will save on this device but will not publish.';
    msg.className = 'ref-login__msg ref-login__msg--bad';
    document.getElementById('refOffline').hidden = false;
  }
}

document.getElementById('refLoginForm').addEventListener('submit', e => {
  e.preventDefault();
  const pw = document.getElementById('refPass').value;
  if (pw) tryLogin(pw);
});

document.getElementById('refOffline').addEventListener('click', () => {
  document.getElementById('refLogin').hidden = true;
  document.getElementById('refPad').hidden = false;
  padInit();
  padSetLive(false);
  document.getElementById('padLiveState').textContent =
    'Scoring offline. The match will save on this device but is not being published.';
});

/* Already signed in this session? Go straight in. */
if (sessionStorage.getItem(PASS_KEY)) showPad();

/* Signing out clears this device, so the next referee starts clean. */
const signOut = document.getElementById('refSignOut');
if (signOut) {
  signOut.addEventListener('click', () => {
    sessionStorage.removeItem(PASS_KEY);
    sessionStorage.removeItem(NAME_KEY);
    location.reload();
  });
}
