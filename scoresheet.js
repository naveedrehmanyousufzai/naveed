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

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); }
  catch { return []; }
};

const when = ms => new Date(ms).toLocaleString([], {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

const mins = (a, b) => {
  const m = Math.max(0, Math.round((b - a) / 60000));
  return m < 1 ? 'under a minute' : m + (m === 1 ? ' minute' : ' minutes');
};

/* ---------- The list ---------- */
function renderList() {
  const root = document.getElementById('sheetList');
  const all = load();

  if (!all.length) {
    root.innerHTML = `<p class="pad__empty">No finished matches saved on this device yet.
    Run a match through to the end on the referee pad and it will appear here.</p>`;
    return;
  }

  root.innerHTML = `<div class="sheet-list">` + all.map(m => `
    <button class="sheet-row" data-id="${esc(m.id)}">
      <span class="sheet-row__main">
        <strong>${esc(m.players?.[0]?.name || '')} v ${esc(m.players?.[1]?.name || '')}</strong>
        <span class="sheet-row__meta">${esc(m.tournament || '')}${m.round ? ' · ' + esc(m.round) : ''}</span>
      </span>
      <span class="sheet-row__score">${esc((m.games_won || [])[0])}–${esc((m.games_won || [])[1])}</span>
      <span class="sheet-row__date">${esc(when(m.finished))}</span>
    </button>`).join('') + `</div>`;

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

function openSheet(id) {
  const m = load().find(x => x.id === id);
  if (!m) return;

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

  document.getElementById('sheetPrint').addEventListener('click', () => window.print());
  document.getElementById('sheetBack').addEventListener('click', () => {
    view.hidden = true;
    view.innerHTML = '';
    document.querySelectorAll('.no-print').forEach(el => { el.style.display = ''; });
  });
}

/* ---------- Export and clear ---------- */
document.getElementById('sheetExport').addEventListener('click', () => {
  const all = load();
  if (!all.length) return alert('There is nothing saved on this device yet.');
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nr-scoresheets-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('sheetClear').addEventListener('click', () => {
  if (!load().length) return;
  if (!confirm('Delete every saved scoresheet on this device? This cannot be undone.')) return;
  localStorage.removeItem(STORE);
  renderList();
});

renderList();
