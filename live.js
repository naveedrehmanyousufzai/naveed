/* ============================================================
   live.js — every match running right now

   Polls /api/live, which returns one entry per court, and draws
   a card for each. Read-only: nothing here changes a score.
   ============================================================ */

const POLL_MS = 5000;
const STALE_MS = 15 * 60 * 1000;   // a match nobody has touched is not live

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

function card(m) {
  const p = m.players || [];
  const score = m.score || [0, 0];
  const won = m.games_won || [0, 0];

  const side = i => `
    <div class="lm__side${m.server === i && !m.done ? ' lm__side--serving' : ''}">
      <div class="lm__who">
        <span class="lm__name">${esc(p[i]?.name || '')}${m.server === i && !m.done && m.side
          ? `<span class="lm__side-tag">serving ${esc(m.side)}</span>` : ''}</span>
        ${p[i]?.dept ? `<span class="lm__dept">${esc(p[i].dept)}</span>` : ''}
      </div>
      <span class="lm__pts">${esc(score[i])}</span>
    </div>`;

  const games = (m.games || [])
    .map((g, n) => `<li><b>G${n + 1}</b> ${esc(g[0])}–${esc(g[1])}</li>`).join('');

  return `
  <article class="lm" data-k="${esc(m.key || m.court)}" tabindex="0" role="button" title="Match details">
    <header class="lm__head">
      <span class="lm__court">Court ${esc(m.court)}</span>
      <span class="${m.done ? 'tag tag--done' : 'tag tag--live'}">${m.done ? 'Finished'
        : m.phase === 'warmup' ? 'Warm-up' : m.phase === 'interval' ? 'Rest' : m.phase === 'ready' ? 'Starting' : 'Live'}</span>
    </header>

    <p class="lm__event">${esc(m.tournament || '')}${m.round ? ' · ' + esc(m.round) : ''}</p>

    ${side(0)}
    <div class="lm__games">
      <span>${esc(won[0])}–${esc(won[1])} games</span>
      ${games ? `<ul class="lm__history">${games}</ul>` : ''}
    </div>
    ${side(1)}

    <a class="lm__open" data-nopop href="scoreboard.html?court=${encodeURIComponent(m.court)}">
      Open full screen
    </a>
  </article>`;
}

let shown = [];

function render(list) {
  const root = document.getElementById('live-grid');

  if (!list.length) {
    root.innerHTML = `
      <div class="lm-empty">
        <p class="lm-empty__big">No matches are being played right now.</p>
        <p class="pad__empty">When a referee starts scoring, the match will appear here
        within a few seconds. You can leave this page open.</p>
      </div>`;
    return;
  }

  root.innerHTML = `<div class="lm-grid">${list.map(card).join('')}</div>`;
}

async function poll() {
  try {
    const res = await fetch('/api/live', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const seen = new Map();
    (data.matches || []).filter(m => m && m.updated && (Date.now() - m.updated < STALE_MS))
      .forEach(m => {
        /* the same match published twice shows once — the newest wins */
        const k = m.match_id && m.sched_id ? m.sched_id + '|' + m.match_id
          : (m.players || []).map(p => String(p && p.name || '').toLowerCase()).join('|') + '|' + m.court;
        if (!seen.has(k) || (seen.get(k).updated || 0) < m.updated) seen.set(k, m);
      });
    const fresh = [...seen.values()];
    shown = fresh;
    render(fresh);
  } catch (err) {
    const root = document.getElementById('live-grid');
    if (!root.innerHTML.trim()) {
      root.innerHTML = `<p class="pad__empty">Live scores are not reachable right now.
      This page will keep trying.</p>`;
    }
  }
}

poll();
setInterval(poll, POLL_MS);


/* ---------- Today's matches, from the schedule ---------- */
const fmt = t => {
  if (!t) return '';
  const d = new Date(t);
  return isNaN(d) ? t : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

async function loadSchedule() {
  const root = document.getElementById('sched');
  if (!root) return;
  try {
    const res = await fetch('/api/schedule', { cache: 'no-store' });
    const list = res.ok ? (await res.json()).schedules || [] : [];
    const rows = [];
    list.forEach(s => (s.matches || []).forEach(m => {
      if (m.status === 'bye' || !m.p1 || !m.p2) return;
      rows.push({ ...m, tournament: s.tournament, event: s.event });
    }));
    if (!rows.length) { root.innerHTML = ''; return; }
    rows.sort((a, b) => String(a.time || '9999').localeCompare(String(b.time || '9999')));

    root.innerHTML = `
      <hr class="rule">
      <div class="section-head"><h2>Schedule</h2></div>
      ${rows.map(m => `
        <div class="sched__row">
          <span class="sched__time">${esc(fmt(m.time) || 'Time to be set')}${m.court ? '<br>Court ' + esc(m.court) : ''}</span>
          <span class="sched__who">${esc(m.p1.name)} v ${esc(m.p2.name)}
            <span class="sched__meta">${esc(m.tournament || '')} · ${esc(m.event || '')} · ${esc(m.round)}${m.referee ? ' · Referee ' + esc(m.referee) : ''}</span></span>
          <span class="sched__res">${m.status === 'done' ? esc(m.score)
            : m.status === 'live' ? '<span class="tag tag--live">Live</span>' : ''}</span>
        </div>`).join('')}`;
  } catch { /* leave it as it was */ }
}
loadSchedule();
setInterval(loadSchedule, 30000);


/* ---------- Match details popup (time, court, referee from the schedule) ---------- */
let schedCache = { at: 0, list: [] };
async function schedules() {
  if (Date.now() - schedCache.at < 30000) return schedCache.list;
  try {
    const r = await fetch('/api/schedule', { cache: 'no-store' });
    if (r.ok) schedCache = { at: Date.now(), list: (await r.json()).schedules || [] };
  } catch { /* use the last list */ }
  return schedCache.list;
}
const lc = s => String(s || '').trim().toLowerCase();
const lmClock = t => {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d)) return '';
  const day = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return String(t).includes('T') ? day + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : day;
};

let lmTimer = null;
function closePop() { clearInterval(lmTimer); document.querySelectorAll('.mm--live').forEach(e => e.remove()); }

async function openPop(key) {
  const first = shown.find(m => String(m.key || m.court) === key);
  if (!first) return;
  closePop();
  const list = await schedules();
  let sc = null, sm = null;
  for (const s of list) {
    const f = (s.matches || []).find(x =>
      (first.match_id && s.id === first.sched_id && String(x.id) === String(first.match_id)) ||
      (x.p1 && x.p2 && first.players && first.players[0] && lc(x.p1.name) === lc(first.players[0].name) && lc(x.p2.name) === lc(first.players[1] && first.players[1].name)));
    if (f) { sc = s; sm = f; break; }
  }
  const tbd = '<span class="mm__tbd">To be announced</span>';
  const row = (k, v) => `<div class="mm__row"><dt>${k}</dt><dd>${v ? esc(v) : tbd}</dd></div>`;
  const el = document.createElement('div');
  el.className = 'mm mm--live';
  el.innerHTML = `<div class="mm__card" role="dialog" aria-modal="true" aria-label="Match details">
    <button class="mm__x" aria-label="Close">\u00d7</button>
    <p class="mm__tour" id="lpTour"></p><p class="mm__event" id="lpEvent"></p>
    <div class="mm__vs" id="lpVs"></div>
    <div class="mm__live" id="lpScore"></div>
    <dl class="mm__list" id="lpList"></dl>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', ev => { if (ev.target === el || ev.target.classList.contains('mm__x')) closePop(); });

  const fill = () => {
    const m = shown.find(x => String(x.key || x.court) === key) || first;
    const p = m.players || [], sc2 = m.score || [0, 0], gw = m.games_won || [0, 0];
    const games = (m.games || []).map((g, n) => `G${n + 1} ${g[0]}–${g[1]}`).join(' · ');
    el.querySelector('#lpTour').textContent = m.tournament || (sc && sc.tournament) || '';
    el.querySelector('#lpEvent').textContent = [sc && sc.event, m.round || (sm && sm.round)].filter(Boolean).join(' · ');
    el.querySelector('#lpVs').innerHTML = [0, 1].map(i => `<span>${esc(p[i]?.name || '')}${p[i]?.dept ? ` <em>${esc(p[i].dept)}</em>` : ''}</span>`).join('<em>v</em>');
    el.querySelector('#lpScore').innerHTML = `<span class="${m.done ? 'tag tag--done' : 'tag tag--live'}">${m.done ? 'Finished' : 'Live'}</span>
      <div class="mm__pts"><b>${esc(sc2[0])}</b><span>–</span><b>${esc(sc2[1])}</b></div>
      <p>Games ${esc(gw[0])}–${esc(gw[1])}${games ? ' · ' + esc(games) : ''}</p>`;
    el.querySelector('#lpList').innerHTML =
      row('Scheduled', sm && lmClock(sm.time)) +
      row('Court', (sm && sm.court) || m.court ? 'Court ' + ((sm && sm.court) || m.court) : '') +
      row('Referee', (sm && sm.referee) || m.referee);
  };
  fill();
  lmTimer = setInterval(fill, 3000);
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-nopop]')) return;
  const c = e.target.closest('.lm[data-k]');
  if (c) openPop(c.dataset.k);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePop();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.lm[data-k]')) { e.preventDefault(); openPop(e.target.dataset.k); }
});
