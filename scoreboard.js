/* ============================================================
   scoreboard.js — the big-screen venue display

   Polls /api/live and paints the current match. Read-only: there
   is nothing to press. The referee pad on /squash publishes to it.

   The game clock is worked out without comparing clocks between
   machines: each update tells us how long the game had been
   running when it was sent, and we count on locally from there.
   ============================================================ */

const POLL_MS = 3000;
const STALE_MS = 15 * 60 * 1000;   // give up on a match nobody has touched

const $ = id => document.getElementById(id);
const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };

let clockBase = 0;        // ms the game had run at the last update
let clockTakenAt = 0;     // when we received that update (local clock)
let clockAnchor = 0;      // the d.updated we anchored to
let haveMatch = false;

function mmss(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function tickClock() {
  if (!haveMatch) return;
  txt('bClock', mmss(clockBase + (Date.now() - clockTakenAt)));
}

function show(on) {
  if (!on) clockAnchor = 0;
  $('boardLive').hidden = !on;
  $('boardWaiting').hidden = on;
  haveMatch = on;
}

/* The tournament logo comes with the schedule, so it is fetched once in a
   while rather than sent with every point. */
let sched = null;
async function loadSchedule() {
  try {
    const res = await fetch('/api/schedule', { cache: 'no-store' });
    sched = res.ok ? await res.json() : null;
  } catch { /* keep the last one */ }
}

const DEFAULT_LOGO = 'images/nr-logo-light.png';
function setLogo(d) {
  const img = $('bLogo');
  const same = sched && sched.logo && (
    (d.match_id && (sched.matches || []).some(m => m.id === d.match_id)) ||
    String(sched.tournament || '').trim().toLowerCase() === String(d.tournament || '').trim().toLowerCase());
  const want = same ? sched.logo : DEFAULT_LOGO;
  if (img.getAttribute('src') !== want) img.src = want;
  img.classList.toggle('board__logo--event', !!same);
}

function paint(d) {
  const fresh = d && d.updated && (Date.now() - d.updated < STALE_MS);
  if (!fresh) { show(false); return; }

  /* Changing court restarts the clock anchor. */
  if (d.court !== undefined && d.court !== paint._court) {
    paint._court = d.court;
    clockAnchor = 0;
  }

  const p = d.players || [];
  const score = d.score || [0, 0];
  const won = d.games_won || [0, 0];

  txt('bTournament', d.tournament || '');
  setLogo(d);
  txt('bRound', [d.court ? 'Court ' + d.court : '', d.round || '']
    .filter(Boolean).join(' \u00b7 '));

  for (let i = 0; i < 2; i++) {
    txt('bName' + i, p[i]?.name || '');
    txt('bDept' + i, p[i]?.dept || '');
    txt('bPts' + i, score[i]);
    txt('bG' + i, won[i]);
    const serving = d.server === i && !d.done;
    $('bServe' + i).style.visibility = serving ? 'visible' : 'hidden';
    $('bServe' + i).innerHTML = serving
      ? '● serving' + (d.side
          ? `<span class="board__sideflag" aria-label="${d.side === 'L' ? 'left' : 'right'} box">${d.side}</span>`
          : '<span class="board__sideflag board__sideflag--wait">…</span>')
      : '';
    $('bSide' + i).classList.toggle('board__player--serving', d.server === i && !d.done);
  }

  /* Finished games, left to right */
  $('bHistory').innerHTML = (d.games || [])
    .map((g, n) => `<li><b>G${n + 1}</b> ${g[0]}–${g[1]}</li>`).join('');

  /* Status line */
  const state = $('bState');
  if (d.done) {
    const w = won[0] > won[1] ? 0 : 1;
    state.textContent = `${p[w]?.name || 'Winner'} wins ${won[w]}–${won[1 - w]}`;
    state.className = 'board__result';
  } else {
    const [a, b] = score;
    let note = `Game ${(d.games || []).length + 1} · first to 11, win by 2`;
    if (a >= 10 && b >= 10) note = 'Two clear points needed';
    else if (a >= 10 && a - b >= 1) note = `Game ball — ${p[0]?.name || ''}`;
    else if (b >= 10 && b - a >= 1) note = `Game ball — ${p[1]?.name || ''}`;
    state.textContent = note;
    state.className = '';
  }

  /* Game clock, anchored to the moment this update was produced */
  if (d.game_started && d.updated && d.updated !== clockAnchor) {
    clockAnchor = d.updated;
    clockBase = Math.max(0, d.updated - d.game_started);
    clockTakenAt = Date.now();
  }

  txt('bStamp', 'Updated ' +
    new Date(d.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  show(true);
  tickClock();
}

/* ---------- Which match to show ----------
   scoreboard.html?court=2  pins that court.
   With no court, it cycles through everything that is live, so one
   screen can cover several courts. */
const pinned = new URLSearchParams(location.search).get('court');
let rotation = [];
let rotateAt = 0;
let shownCourt = null;

const ROTATE_MS = 20000;

function choose(matches) {
  const live = matches.filter(m => m && m.updated && (Date.now() - m.updated < STALE_MS));
  if (!live.length) return null;

  if (pinned) return live.find(m => String(m.court) === String(pinned)) || null;

  rotation = live.map(m => String(m.court));
  if (!shownCourt || !rotation.includes(shownCourt)) {
    shownCourt = rotation[0];
    rotateAt = Date.now() + ROTATE_MS;
  } else if (rotation.length > 1 && Date.now() > rotateAt) {
    const i = rotation.indexOf(shownCourt);
    shownCourt = rotation[(i + 1) % rotation.length];
    rotateAt = Date.now() + ROTATE_MS;
  }
  return live.find(m => String(m.court) === shownCourt) || live[0];
}

async function poll() {
  try {
    const url = pinned ? '/api/live?court=' + encodeURIComponent(pinned) : '/api/live';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    /* One court comes back as the match itself; the list comes back wrapped. */
    const matches = pinned ? (data ? [data] : []) : (data.matches || []);
    paint(choose(matches));
  } catch (err) {
    console.warn('Scoreboard poll failed:', err.message);
  }
}

loadSchedule().then(poll);
setInterval(loadSchedule, 60000);
setInterval(poll, POLL_MS);
setInterval(tickClock, 1000);
