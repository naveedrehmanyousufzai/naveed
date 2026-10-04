/* ============================================================
   tournament.js — one tournament: Info, Draws, Entries,
   Matches, Referees and Feedback, with a side menu.

   Static details come from content/tournaments.json. Draws and
   matches come from the Worker (/api/draw, /api/schedule) and
   refresh by themselves while the page is open.
   ============================================================ */
const { esc, status, statusTag, fmtRange, fmtDate, fmtStamp } = NR;

const TABS = [
  ['info', 'Info'], ['draws', 'Draws'], ['entries', 'Entries'],
  ['matches', 'Matches'], ['referees', 'Referees'], ['feedback', 'Feedback']
];
const ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  draws: '<rect x="9" y="3" width="6" height="5"/><rect x="2" y="16" width="6" height="5"/><rect x="16" y="16" width="6" height="5"/><path d="M12 8v4M5 16v-4h14v4"/>',
  entries: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>',
  matches: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8"/>',
  referees: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3"/>',
  feedback: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/>'
};
const icon = k => `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

let T = null;                       // this tournament
let tab = 'info';
let timer = null;
let divPick = { draws: '', entries: '', matches: '' };

const id = new URLSearchParams(location.search).get('id') || '';
const root = document.getElementById('tpage');

/* ---------- Page frame ---------- */
function frame() {
  const st = status(T);
  root.innerHTML = `
  <div class="thero">
    ${T.logo ? `<img class="thero__logo" src="${esc(T.logo)}" alt="">` : ''}
    <div>
      <h1 class="thero__name">${esc(T.name)}</h1>
      <p class="thero__dates">${esc(fmtRange(T.start, T.end))}${T.location ? ' · ' + esc(T.location) : ''}</p>
      <p class="thero__tags">${statusTag(st)}${T.sample ? '<span class="sample-flag">Sample data</span>' : ''}</p>
    </div>
  </div>
  <div class="tlayout">
    <nav class="tside" aria-label="Tournament sections">
      ${TABS.map(([k, label]) => `
        <a href="#${k}" class="tside__link${k === tab ? ' tside__link--on' : ''}" data-tab="${k}">${icon(k)}<span>${label}</span></a>`).join('')}
      <a href="tournaments.html" class="tside__back">&larr; All tournaments</a>
    </nav>
    <div class="tmain" id="tmain"></div>
  </div>`;
}

/* ---------- Division chips ---------- */
function divChips(key, names, noAll) {
  if (names.length < 2) return '';
  const cur = divPick[key];
  return `<div class="filters" data-chips="${key}">
    ${noAll ? '' : `<button class="chip${cur === '' ? ' chip--on' : ''}" data-d="">All</button>`}
    ${names.map(n => `<button class="chip${cur === n ? ' chip--on' : ''}" data-d="${esc(n)}">${esc(n)}</button>`).join('')}
  </div>`;
}

/* ============================================================
   INFO
   ============================================================ */
function infoPanel() {
  const row = (k, v) => v ? `<p class="icard__row"><b>${k}</b> ${v}</p>` : '';
  return `
  <div class="icards">
    <article class="icard">
      <h3>Promoters</h3>
      ${row('Organiser:', esc(T.organiser))}
      ${row('Promoter:', esc(T.promoters))}
      ${row('Contact:', T.contact ? `<a href="mailto:${esc(T.contact)}">${esc(T.contact)}</a>` : '')}
    </article>
    <article class="icard">
      <h3>Deadlines</h3>
      ${row('Entries:', esc(fmtStamp(T.entry_deadline)) || 'to be announced')}
      ${row('Withdrawals:', esc(fmtStamp(T.withdrawal_deadline)) || 'to be announced')}
      ${row('Dates:', esc(fmtRange(T.start, T.end)))}
    </article>
    <article class="icard">
      <h3>Level and prizes</h3>
      ${row('Level:', esc(T.level))}
      ${row('Prize money:', esc(T.prize_money))}
      ${row('Status:', statusTag(status(T)))}
    </article>
    <article class="icard">
      <h3>Venue</h3>
      ${row('', `<strong>${esc(T.venue)}</strong>`)}
      ${row('', esc(T.venue_address))}
      ${row('', esc(T.location))}
    </article>
  </div>

  ${(T.divisions || []).length ? `
  <section class="tsec">
    <h3>Divisions</h3>
    <p class="tt__divs tt__divs--big">${T.divisions.map(d => `<i>${esc(d)}</i>`).join('')}</p>
  </section>` : ''}

  ${T.description ? `<section class="tsec"><h3>About</h3><p class="tprose">${esc(T.description)}</p></section>` : ''}

  <section class="tsec">
    <h3>How to enter</h3>
    <p class="tprose">${esc(T.how_to_enter || 'Entry details will be announced soon.')}</p>
    ${T.contact ? `<p class="tprose">Questions? <a href="mailto:${esc(T.contact)}">${esc(T.contact)}</a></p>` : ''}
  </section>`;
}

/* ============================================================
   DRAWS
   ============================================================ */
let draws = null;

async function drawsPanel(box) {
  if (!box.querySelector('#drawBody')) box.innerHTML = '<div id="drawChips"></div><div id="drawBody"><p class="pad__empty">Loading the draws…</p></div>';
  try {
    const res = await fetch('/api/draw?tournament=' + encodeURIComponent(T.id), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    draws = (await res.json()).draws || [];
  } catch {
    box.querySelector('#drawBody').innerHTML = '<p class="pad__empty">Draws are not available right now. This page will keep trying.</p>';
    return;
  }
  if (!draws.length) {
    box.querySelector('#drawBody').innerHTML = '<p class="pad__empty">No draws have been published yet. They appear here as soon as the organisers make them.</p>';
    return;
  }
  const names = draws.map(d => d.event || 'Draw');
  if (!names.includes(divPick.draws)) divPick.draws = names[0];
  box.querySelector('#drawChips').innerHTML = divChips('draws', names, true);
  const d = draws[names.indexOf(divPick.draws)];
  const body = box.querySelector('#drawBody');
  body.innerHTML = `<div class="dm__controls no-print"><button class="btn btn--ghost" id="tPrint">Print this draw</button></div><div id="drawView"></div>`;
  DrawView.render(body.querySelector('#drawView'), d);
  body.querySelector('#tPrint').addEventListener('click', () => window.print());
}

/* ============================================================
   ENTRIES
   ============================================================ */
const ENTRY_CATS = ['Boys Under 9','Boys Under 11','Boys Under 13','Boys Under 15','Boys Under 17','Boys Under 19','Men',
  'Girls Under 9','Girls Under 11','Girls Under 13','Girls Under 15','Girls Under 17','Girls Under 19','Women'];
let entryList = null;       // from the server
let isAdmin = false;

const rankKey = e => (Number(e.rank) > 0 ? Number(e.rank) : 1e9);

async function loadEntries() {
  let list = [];
  try {
    const res = await fetch('/api/entries?tournament=' + encodeURIComponent(T.id), { cache: 'no-store' });
    if (res.ok) list = (await res.json()).entries || [];
  } catch { /* none */ }
  entryList = list;
}

async function checkAdmin() {
  const pw = sessionStorage.getItem('nr-pass');
  if (!pw) { isAdmin = false; return; }
  try {
    const res = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': pw }, body: '{}' });
    isAdmin = res.ok && (await res.json()).name === 'Admin';
  } catch { isAdmin = false; }
}

async function saveEntries() {
  const res = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem('nr-pass') || '' },
    body: JSON.stringify({ tournament: T.id, entries: entryList })
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Sign in as organiser first.' : 'Could not save.');
  entryList = (await res.json()).entries;
}

async function entriesPanel(box) {
  if (entryList === null) { box.innerHTML = '<p class="pad__empty">Loading…</p>'; await Promise.all([loadEntries(), checkAdmin()]); }
  if (tab !== 'entries') return;

  /* entries typed into the CMS still show too */
  const cms = (T.entries || []).filter(e => e.name).map((e, i) => ({ id: 'cms' + i, name: e.name, club: e.club || '', division: e.division || 'Entries', rank: e.rank || e.seed || null, cms: true }));
  const list = entryList.concat(cms);
  const names = ENTRY_CATS.filter(c => list.some(e => e.division === c))
    .concat([...new Set(list.map(e => e.division))].filter(d => !ENTRY_CATS.includes(d)));
  const cur = divPick.entries;
  const shown = names.filter(n => !cur || n === cur);

  const admin = isAdmin ? `
    <div class="ent-admin">
      <h3 class="tsec__h">Add a player</h3>
      <form id="entForm">
        <div class="ent-admin__grid">
          <label class="pad__field"><span>Name</span><input class="pad__name" name="name" required></label>
          <label class="pad__field"><span>Association / department</span><input class="pad__name" name="club"></label>
          <label class="pad__field"><span>National rank</span><input class="pad__name" name="rank" type="number" min="1" inputmode="numeric"></label>
          <label class="pad__field"><span>Category</span><select class="pad__name" name="division">${ENTRY_CATS.map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="pad__field"><span>Country (optional)</span><input class="pad__name" name="country"></label>
        </div>
        <button class="btn btn--solid" type="submit">Add player</button>
        <span class="pad__publish-state" id="entState"></span>
      </form>
    </div>` : `<p class="pad__publish-note"><a href="drawmaker.html">Organiser? Sign in on the draw maker page</a>, then come back here to add players.</p>`;

  box.innerHTML = `${admin}
    ${list.length ? `<p class="pad__intro">${list.length} player${list.length === 1 ? '' : 's'} entered, highest national rank first.</p>${divChips('entries', names)}` : '<p class="pad__empty">No entries have been published yet.</p>'}
    ${shown.map(n => {
      const rows = list.filter(e => e.division === n).sort((a, b) => rankKey(a) - rankKey(b) || String(a.name).localeCompare(b.name));
      return `<h3 class="tsec__h">${esc(n)} <small>${rows.length}</small></h3>
      <table class="table plain-table"><thead><tr><th>Rank</th><th>Player</th><th>Association</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(e => `<tr><td>${esc(e.rank || '–')}</td><td>${esc(e.name)}${e.country ? ' <small>' + esc(e.country) + '</small>' : ''}</td><td>${esc(e.club || '')}</td>${isAdmin ? `<td>${e.cms ? '' : `<button class="ent-del" data-del="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">×</button>`}</td>` : ''}</tr>`).join('')}
      </tbody></table>`;
    }).join('')}`;
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'entForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const st = document.getElementById('entState');
  const division = f.get('division');
  entryList.push({ id: Math.random().toString(36).slice(2, 10), name: f.get('name'), club: f.get('club'),
    country: f.get('country'), division, rank: f.get('rank') || null });
  try { await saveEntries(); divPick.entries = division; show(); }
  catch (err) { entryList.pop(); st.textContent = err.message; }
});

document.addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (!d || !confirm('Remove this player?')) return;
  const keep = entryList;
  entryList = entryList.filter(x => x.id !== d.dataset.del);
  try { await saveEntries(); } catch (err) { entryList = keep; alert(err.message); }
  show();
});

/* ============================================================
   MATCHES — who plays whom, where and when
   ============================================================ */
let schedules = null;

const dayKey = t => (t ? String(t).slice(0, 10) : '');
const clock = t => {
  if (!t || !String(t).includes('T')) return '';
  const d = new Date(t);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

async function matchesPanel(box) {
  if (!box.querySelector('#matchBody')) box.innerHTML = '<div id="matchChips"></div><div id="matchBody"><p class="pad__empty">Loading the matches…</p></div>';
  try {
    const res = await fetch('/api/schedule?tournament=' + encodeURIComponent(T.id), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    schedules = (await res.json()).schedules || [];
  } catch {
    box.querySelector('#matchBody').innerHTML = '<p class="pad__empty">Matches are not available right now. This page will keep trying.</p>';
    return;
  }

  const events = schedules.map(s => s.event || 'Matches');
  box.querySelector('#matchChips').innerHTML = divChips('matches', events);

  const all = [];
  schedules.forEach(s => (s.matches || []).forEach(m => {
    if (divPick.matches && (s.event || 'Matches') !== divPick.matches) return;
    if (m.status === 'bye' || (!m.p1 && !m.p2 && !m.time)) return;
    all.push({ ...m, event: s.event || '' });
  }));

  if (!all.length) {
    box.querySelector('#matchBody').innerHTML = '<p class="pad__empty">No matches have been scheduled yet.</p>';
    return;
  }

  all.sort((a, b) => (String(a.time || '9999') + a.event).localeCompare(String(b.time || '9999') + b.event));
  const days = [...new Set(all.map(m => dayKey(m.time)))];

  box.querySelector('#matchBody').innerHTML = days.map(dk => `
    <h3 class="tsec__h">${dk ? esc(fmtDate(dk)) : 'To be scheduled'}</h3>
    <div class="mt">
      ${all.filter(m => dayKey(m.time) === dk).map(m => {
        const who = p => p ? esc(p.name) : '<em>to be decided</em>';
        const win = i => m.status === 'done' && m.winner === i ? ' mt__win' : '';
        return `<div class="mt__row">
          <span class="mt__when">${esc(clock(m.time)) || '—'}<small>${m.court ? 'Court ' + esc(m.court) : 'Court tbc'}</small></span>
          <span class="mt__who"><span class="${win(0).trim()}">${who(m.p1)}</span> <i>v</i> <span class="${win(1).trim()}">${who(m.p2)}</span>
            <small>${esc(m.event)}${m.event ? ' · ' : ''}${esc(m.round)}</small></span>
          <span class="mt__res">${m.status === 'done' ? esc(m.score) : m.status === 'live' ? '<span class="tag tag--live">Live</span>' : ''}</span>
        </div>`;
      }).join('')}
    </div>`).join('');
}

/* ============================================================
   REFEREES
   ============================================================ */
function refereesPanel() {
  const list = T.referees || [];
  if (!list.length) return '<p class="pad__empty">Referees have not been announced yet.</p>';
  return `<table class="table plain-table"><thead><tr><th>Referee</th><th>Role</th></tr></thead><tbody>
    ${list.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.role || '')}</td></tr>`).join('')}</tbody></table>`;
}

/* ============================================================
   FEEDBACK
   ============================================================ */
function feedbackPanel() {
  return `
  <p class="pad__intro">Tell the organisers how it went — a suggestion, a problem, or something that worked well.</p>
  <form class="fb" id="fbForm">
    <label class="pad__field"><span>Your name (optional)</span><input class="pad__name" name="name" maxlength="80"></label>
    <label class="pad__field"><span>Email or phone (optional)</span><input class="pad__name" name="contact" maxlength="120"></label>
    <label class="pad__field"><span>Type</span>
      <select class="pad__name" name="kind">
        <option>Suggestion</option><option>Problem</option><option>Praise</option><option>Other</option>
      </select></label>
    <label class="pad__field"><span>Your feedback</span><textarea class="pad__name" name="message" rows="6" maxlength="2000" required></textarea></label>
    <input class="fb__trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn--solid" type="submit">Send feedback</button>
    <p class="pad__publish-state" id="fbState"></p>
  </form>`;
}

async function sendFeedback(form) {
  const state = document.getElementById('fbState');
  const f = new FormData(form);
  state.textContent = 'Sending…'; state.className = 'pad__publish-state';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: T.id, name: f.get('name'), contact: f.get('contact'),
        kind: f.get('kind'), message: f.get('message'), website: f.get('website')
      })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'HTTP ' + res.status);
    form.reset();
    state.textContent = 'Thank you — your feedback has been sent to the organisers.';
    state.className = 'pad__publish-state pad__publish-state--good';
  } catch (err) {
    state.textContent = 'Could not send: ' + err.message;
    state.className = 'pad__publish-state pad__publish-state--bad';
  }
}

/* ============================================================
   Show a tab
   ============================================================ */
function show() {
  clearInterval(timer);
  const box = document.getElementById('tmain');
  document.querySelectorAll('.tside__link').forEach(a =>
    a.classList.toggle('tside__link--on', a.dataset.tab === tab));
  document.title = `${T.name} — ${TABS.find(t => t[0] === tab)[1]}`;

  if (tab === 'info') box.innerHTML = infoPanel();
  else if (tab === 'entries') entriesPanel(box);
  else if (tab === 'referees') box.innerHTML = refereesPanel();
  else if (tab === 'feedback') box.innerHTML = feedbackPanel();
  else if (tab === 'draws') { box.innerHTML = ''; drawsPanel(box); timer = setInterval(() => drawsPanel(box), 30000); }
  else if (tab === 'matches') { box.innerHTML = ''; matchesPanel(box); timer = setInterval(() => matchesPanel(box), 15000); }
}

function fromHash() {
  const k = location.hash.replace('#', '');
  tab = TABS.some(t => t[0] === k) ? k : 'info';
}

document.addEventListener('click', e => {
  const chip = e.target.closest('[data-chips] [data-d]');
  if (chip) {
    divPick[chip.closest('[data-chips]').dataset.chips] = chip.dataset.d;
    show();
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'fbForm') { e.preventDefault(); sendFeedback(e.target); }
});
window.addEventListener('hashchange', () => { fromHash(); show(); window.scrollTo({ top: 0 }); });

NR.tournaments().then(list => {
  T = list.find(t => t.id === id);
  if (!T) {
    root.innerHTML = '<p class="pad__empty">That tournament could not be found. <a href="tournaments.html">See the calendar</a>.</p>';
    return;
  }
  fromHash();
  frame();
  show();
}).catch(() => {
  root.innerHTML = '<p class="pad__empty">This tournament could not be loaded. Please refresh.</p>';
});
