/* ============================================================
   scoresheet.js — printable match scoresheets

   Matches finished on the referee pad are saved in this browser
   (localStorage, key "nr-matches"). This page lists them and
   builds a traditional rally-by-rally sheet you can print or
   save as a PDF.

   Nothing here touches the server.
   ============================================================ */

const STORE = 'nr-matches';

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const localLoad = () => {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); }
  catch { return []; }
};

/* The list on screen: this device's sheets plus, for the organiser, every
   sheet on the server. Server entries are summaries until opened. */
let ALL = localLoad();
let isAdmin = false;
const pw = () => sessionStorage.getItem('nr-pass') || '';
const load = () => ALL;

function fromMeta(k) {
  return { id: k.id, remote: true, players: [{ name: k.a }, { name: k.b }], tournament: k.t, round: k.r,
    games_won: k.gw, finished: k.f, referee: k.ref };
}

async function syncAdmin() {
  const res = await fetch('/api/scoresheets', { headers: { 'x-admin-password': pw() }, cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const remote = (await res.json()).sheets || [];
  const have = new Set(remote.map(k => k.id));
  const local = localLoad();
  /* send up anything this device has that the server does not */
  for (const m of local) {
    if (have.has(m.id)) continue;
    try {
      await fetch('/api/scoresheets', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw() }, body: JSON.stringify(m) });
      remote.push({ id: m.id, a: m.players?.[0]?.name, b: m.players?.[1]?.name, t: m.tournament, r: m.round,
        gw: m.games_won, f: m.finished, ref: m.referee });
    } catch { /* try again next visit */ }
  }
  const localById = new Map(local.map(m => [m.id, m]));
  ALL = remote.map(k => localById.get(k.id) || fromMeta(k)).sort((a, b) => (b.finished || 0) - (a.finished || 0));
}

async function checkAdmin() {
  if (!pw()) return false;
  try {
    const res = await fetch('/api/verify', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw() }, body: '{}' });
    return res.ok && (await res.json()).name === 'Admin';
  } catch { return false; }
}

const when = ms => new Date(ms).toLocaleString([], {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

const mins = (a, b) => {
  const m = Math.max(0, Math.round((b - a) / 60000));
  return m < 1 ? 'under a minute' : m + (m === 1 ? ' minute' : ' minutes');
};

/* ---------- The list ---------- */
function bindLogin() {
  const f = document.getElementById('sheetLogin');
  if (!f) return;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('sheetLoginMsg');
    msg.textContent = 'Checking\u2026';
    sessionStorage.setItem('nr-pass', document.getElementById('sheetPw').value);
    if (!(await checkAdmin())) { sessionStorage.removeItem('nr-pass'); msg.textContent = 'That is not the organiser password.'; return; }
    sessionStorage.setItem('nr-referee', 'Admin');
    await start();
  });
}

function renderList() {
  const root = document.getElementById('sheetList');
  const all = load();
  const login = isAdmin ? '' : `<form class="sheet-login" id="sheetLogin">
      <strong>Organiser? Sign in to see every scoresheet from every device.</strong>
      <input class="pad__name" type="password" id="sheetPw" placeholder="Admin password" autocomplete="current-password">
      <button class="btn btn--solid" type="submit">Sign in</button>
      <span class="pad__publish-state" id="sheetLoginMsg"></span></form>`;

  if (!all.length) {
    root.innerHTML = login + `<p class="pad__empty">No finished matches saved yet.
    Run a match through to the end on the referee pad and it will appear here.</p>`;
    bindLogin();
    return;
  }

  root.innerHTML = login + `<div class="sheet-list">` + all.map(m => `
    <button class="sheet-row" data-id="${esc(m.id)}">
      <span class="sheet-row__main">
        <strong>${esc(m.players?.[0]?.name || '')} v ${esc(m.players?.[1]?.name || '')}</strong>
        <span class="sheet-row__meta">${esc(m.tournament || '')}${m.round ? ' \u00b7 ' + esc(m.round) : ''}${m.referee ? ' \u00b7 ' + esc(m.referee) : ''}</span>
      </span>
      <span class="sheet-row__score">${esc((m.games_won || [])[0])}\u2013${esc((m.games_won || [])[1])}</span>
      <span class="sheet-row__date">${esc(when(m.finished))}</span>
    </button>`).join('') + `</div>`;
  bindLogin();

  root.querySelectorAll('.sheet-row').forEach(b =>
    b.addEventListener('click', () => openSheet(b.dataset.id)));
}

/* ============================================================
   THE PRINTED SHEET — the standard squash scoresheet layout:
   header, five game columns (serve side + points for each player),
   conduct penalties, winner, duration and the referee's signature.
   ============================================================ */
const clock = ms => ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const dateOnly = ms => ms ? new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/* One game: four narrow columns — A serve, A points, B points, B serve */
function wsGame(m, n, rows) {
  const rallies = (m.rallies || []).filter(r => r.g === n);
  const g = (m.games || [])[n - 1];
  let body = '';
  for (let i = 0; i < rows; i++) {
    const r = rallies[i];
    const a = r && r.w === 0 ? r.a : '';
    const b = r && r.w === 1 ? r.b : '';
    const sa = r && r.sv === 0 ? (r.sd || '') : '';
    const sb = r && r.sv === 1 ? (r.sd || '') : '';
    body += `<tr><td class="ws__sv">${esc(sa)}</td><td>${esc(a)}</td><td>${esc(b)}</td><td class="ws__sv">${esc(sb)}</td></tr>`;
  }
  return `<div class="ws__game">
    <div class="ws__gn"><span>${n}</span></div>
    <table class="ws__grid"><thead><tr><th colspan="2">A</th><th colspan="2">B</th></tr></thead><tbody>${body}</tbody></table>
    <div class="ws__set"><span>Set ${n}</span><b>${g ? esc(g[0]) : ''}</b><b>${g ? esc(g[1]) : ''}</b></div>
  </div>`;
}

async function openSheet(id) {
  let m = load().find(x => x.id === id);
  if (!m) return;
  if (m.remote) {
    try {
      const res = await fetch('/api/scoresheets?id=' + encodeURIComponent(id), { headers: { 'x-admin-password': pw() } });
      if (!res.ok) throw new Error();
      m = await res.json();
    } catch { return alert('Could not open that scoresheet right now.'); }
  }

  const view = document.getElementById('sheetView');
  const won = m.games_won || [0, 0];
  const winner = m.winner === 0 || m.winner === 1 ? m.winner : (won[0] > won[1] ? 0 : 1);
  const p = m.players || [{}, {}];
  const parts = String(m.round || '').split(' · ');
  const division = parts.length > 1 ? parts[0] : '';
  const round = parts.length > 1 ? parts.slice(1).join(' · ') : (m.round || '');
  const longest = Math.max(0, ...[1, 2, 3, 4, 5].map(n => (m.rallies || []).filter(r => r.g === n).length));
  const rows = Math.max(30, longest + 2);
  const minutes = m.started && m.finished ? Math.max(1, Math.round((m.finished - m.started) / 60000)) : '';
  const pen = (m.events || []).filter(e => ['conduct', 'warning'].includes(e.type) || /warning|conduct|penalt/i.test(e.text || ''));
  const penRows = Array.from({ length: Math.max(4, pen.length) }, (_, i) => pen[i]);
  const who = i => esc(p[i]?.name || '') + (p[i]?.dept ? ' — ' + esc(p[i].dept) : '') + (p[i]?.country ? ' (' + esc(p[i].country) + ')' : '');

  view.innerHTML = `
  <div class="sheet">
    <div class="sheet-tools no-print">
      <button class="btn btn--solid" id="sheetPrint">Print this sheet</button>
      <button class="btn btn--ghost" id="sheetBack">Back to the list</button>
      ${isAdmin ? '<button class="btn btn--ghost" id="sheetDel">Delete this scoresheet</button>' : ''}
    </div>

    <article class="ws">
      <div class="ws__top">
        <div class="ws__logo"><img src="images/nr-logo.png" alt=""></div>
        <div class="ws__event">${esc(m.tournament || 'Event name')}</div>
        <div class="ws__logo ws__logo--r"></div>
      </div>

      <div class="ws__bar">
        <div class="ws__loc">${esc(dateOnly(m.finished))}</div>
        <table class="ws__warm"><tr><th colspan="3">Warm-up</th></tr>
          ${[1, 2, 3, 4, 5].map(n => `<tr><td>${n}</td><td></td><td></td></tr>`).join('')}</table>
        <div class="ws__date"><span>Date</span>${esc(dateOnly(m.started || m.finished))}</div>
      </div>

      <div class="ws__info">
        <div class="ws__c ws__c--wide"><span>Division</span>${esc(division)}</div>
        <div class="ws__c"><span>Round</span>${esc(round)}</div>
        <div class="ws__c"><span>Court</span>${esc(m.court || '')}</div>
        <div class="ws__c"><span>Time</span>${esc(clock(m.started))}</div>
        <div class="ws__c ws__c--wide"><span>Central referee</span>${esc(m.referee || '')}</div>
        <div class="ws__c ws__c--half"><span>A</span>${who(0)}</div>
        <div class="ws__c ws__c--half"><span>B</span>${who(1)}</div>
        <div class="ws__c ws__c--wide"><span>Marker</span></div>
      </div>

      <div class="ws__games">${[1, 2, 3, 4, 5].map(n => wsGame(m, n, rows)).join('')}</div>

      <div class="ws__bottom">
        <table class="ws__pen">
          <thead><tr><th colspan="5">Conduct penalties</th></tr>
          <tr><th>Player</th><th>Level of penalty</th><th>Reason</th><th>Game</th><th>Score</th></tr></thead>
          <tbody>${penRows.map(e => `<tr>
            <td>${e ? esc(p[e.p]?.name || '') : ''}</td><td>${e ? esc(e.type === 'warning' ? 'Warning' : e.text) : ''}</td>
            <td></td><td>${e ? esc(e.g) : ''}</td><td>${e ? esc(e.a + '-' + e.b) : ''}</td></tr>`).join('')}</tbody>
        </table>
        <div class="ws__end">
          <div class="ws__win"><span>Winner</span>${esc(p[winner]?.name || '')}<small>${esc(won[winner])}–${esc(won[1 - winner])} · ${(m.games || []).map(g => esc(g[0]) + '-' + esc(g[1])).join(', ')}${m.end_note === 'retired' ? ' · retirement' : m.end_note === 'conduct' ? ' · conduct' : ''}</small></div>
          <div class="ws__dur"><span>Match duration (minutes)</span>${esc(minutes)}</div>
          <div class="ws__sig"><span>Central referee's signature</span></div>
        </div>
      </div>
    </article>
  </div>`;

  view.hidden = false;
  document.querySelectorAll('.no-print').forEach(el => {
    if (!view.contains(el)) el.style.display = 'none';
  });
  window.scrollTo(0, 0);

  const del = document.getElementById('sheetDel');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this scoresheet everywhere? This cannot be undone.')) return;
    await fetch('/api/scoresheets?id=' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-admin-password': pw() } });
    localStorage.setItem(STORE, JSON.stringify(localLoad().filter(x => x.id !== id)));
    ALL = ALL.filter(x => x.id !== id);
    document.getElementById('sheetBack').click();
    renderList();
  });
  document.getElementById('sheetPrint').addEventListener('click', () => window.print());
  document.getElementById('sheetBack').addEventListener('click', () => {
    view.hidden = true;
    view.innerHTML = '';
    document.querySelectorAll('.no-print').forEach(el => { el.style.display = ''; });
  });
}

/* ---------- Export and clear ---------- */
document.getElementById('sheetExport').addEventListener('click', () => {
  const all = localLoad();
  if (!all.length) return alert('There is nothing saved on this device yet.');
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nr-scoresheets-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('sheetClear').addEventListener('click', () => {
  if (!localLoad().length) return;
  if (!confirm('Delete the scoresheets saved on this device? Copies on the server stay.')) return;
  localStorage.removeItem(STORE);
  ALL = isAdmin ? ALL.filter(m => m.remote) : [];
  renderList();
});

async function start() {
  isAdmin = await checkAdmin();
  if (isAdmin) { try { await syncAdmin(); } catch { /* show this device's sheets */ } }
  renderList();
}
renderList();
start();
