/* ============================================================
   rankings.js — full rankings, one category at a time
   ============================================================ */
const { esc } = NR;
let data = { categories: [], players: [] };
let cat = new URLSearchParams(location.search).get('cat') || '';

function renderTabs() {
  const box = document.getElementById('catFilters');
  box.innerHTML = data.categories.map(c => `
    <button class="chip${c === cat ? ' chip--on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
}

function renderTable() {
  const root = document.getElementById('rankings-root');
  const rows = data.players.filter(p => p.category === cat)
    .sort((a, b) => Number(a.rank) - Number(b.rank));
  if (!rows.length) { root.innerHTML = '<p class="pad__empty">No ranking for this category yet.</p>'; return; }

  root.innerHTML = `
  <h2 class="rk-title">${esc(cat)}</h2>
  <table class="table rk-table">
    <thead><tr><th>Rank</th><th>Player</th><th>Club</th><th>Points</th></tr></thead>
    <tbody>
      ${rows.map(p => `<tr>
        <td class="rk-table__rank">${esc(p.rank)}</td>
        <td>${esc(p.name)}</td>
        <td class="rk-table__club">${esc(p.club || '')}</td>
        <td class="rk-table__pts">${esc(p.points || '')}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

document.getElementById('catFilters').addEventListener('click', e => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  cat = b.dataset.c;
  history.replaceState(null, '', '?cat=' + encodeURIComponent(cat));
  renderTabs(); renderTable();
});

NR.load('rankings').then(d => {
  data = d;
  if (!data.categories.includes(cat)) cat = data.categories[0] || '';
  renderTabs(); renderTable();
}).catch(() => {
  document.getElementById('rankings-root').innerHTML =
    '<p class="pad__empty">Rankings could not be loaded. Please refresh.</p>';
});
