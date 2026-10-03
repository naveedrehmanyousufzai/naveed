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

/* ---------- One game, drawn the way a paper sheet is ----------
   A column per rally. The player who won it shows their new score;
   the other side is left blank. */
function gameGrid(m, gameNo) {
  const rallies = (m.rallies || []).filter(r => r.g === gameNo);
  if (!rallies.length) return '';

  const row = i => rallies.map(r =>
    `<td class="${r.w === i ? 'pt' : 'pt pt--blank'}">${r.w === i ? (i === 0 ? r.a : r.b) : ''}</td>`
  ).join('');

  const g = (m.games || [])[gameNo - 1] || ['', ''];

  return `
  <div class="sheet-game">
    <div class="sheet-game__head">
      <h3>Game ${gameNo}</h3>
      <span class="sheet-game__final">${esc(g[0])}–${esc(g[1])}</span>
    </div>
    <div class="sheet-game__scroll">
      <table class="sheet-grid">
        <tbody>
          <tr><th>${esc(m.players?.[0]?.name || 'Player 1')}</th>${row(0)}</tr>
          <tr><th>${esc(m.players?.[1]?.name || 'Player 2')}</th>${row(1)}</tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

/* ---------- The printable sheet ---------- */
function openSheet(id) {
  const m = load().find(x => x.id === id);
  if (!m) return;

  const view = document.getElementById('sheetView');
  const won = m.games_won || [0, 0];
  const winner = won[0] > won[1] ? 0 : 1;
  const games = (m.games || []).length;

  view.innerHTML = `
  <div class="sheet">
    <div class="sheet-tools no-print">
      <button class="btn btn--solid" id="sheetPrint">Print this sheet</button>
      <button class="btn btn--ghost" id="sheetBack">Back to the list</button>
    </div>

    <article class="sheet-paper">
      <header class="sheet-head">
        <img class="sheet-logo" src="images/nr-logo.png" alt="">
        <div>
          <h2 class="sheet-title">${esc(m.tournament || 'Match')}</h2>
          <p class="sheet-sub">${esc(m.round || '')}</p>
        </div>
        <p class="sheet-date">${esc(when(m.finished))}</p>
      </header>

      <table class="sheet-players">
        <tbody>
          <tr${winner === 0 ? ' class="is-winner"' : ''}>
            <td class="sheet-players__name">${esc(m.players?.[0]?.name || '')}</td>
            <td class="sheet-players__dept">${esc(m.players?.[0]?.dept || '')}</td>
            <td class="sheet-players__games">${esc(won[0])}</td>
          </tr>
          <tr${winner === 1 ? ' class="is-winner"' : ''}>
            <td class="sheet-players__name">${esc(m.players?.[1]?.name || '')}</td>
            <td class="sheet-players__dept">${esc(m.players?.[1]?.dept || '')}</td>
            <td class="sheet-players__games">${esc(won[1])}</td>
          </tr>
        </tbody>
      </table>

      <p class="sheet-result">
        <strong>${esc(m.players?.[winner]?.name || '')}</strong> won
        ${esc(won[winner])}–${esc(won[1 - winner])}
        (${(m.games || []).map(g => esc(g[0]) + '–' + esc(g[1])).join(', ')})
        · ${games} game${games === 1 ? '' : 's'}
        · ${esc(mins(m.started, m.finished))}
      </p>

      ${[1, 2, 3, 4, 5].map(n => gameGrid(m, n)).join('')}

      <footer class="sheet-foot">
        <div class="sheet-sign"><span></span><p>Referee${m.referee ? ' \u2014 ' + esc(m.referee) : ''}</p></div>
        <div class="sheet-sign"><span></span><p>Marker</p></div>
        <p class="sheet-mark">naveedrehman.com</p>
      </footer>
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
