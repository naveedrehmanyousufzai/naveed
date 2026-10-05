/* ============================================================
   content.js — reads the files in /content and fills the pages.
   When Naveed saves something in /admin, those files change,
   and these functions redraw the page from them.
   You should not need to edit this file.
   ============================================================ */

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

async function load(name) {
  // The preview file embeds content directly; the real site fetches it.
  if (window.__CONTENT__ && window.__CONTENT__[name]) return window.__CONTENT__[name];
  const res = await fetch('content/' + name + '.json');
  if (!res.ok) throw new Error('Could not load ' + name);
  return res.json();
}

/* ---------- Home: career numbers + featured result ---------- */
async function renderHome() {
  const root = document.getElementById('record-root');
  const feat = document.getElementById('featured-root');
  if (!root && !feat) return;
  const d = await load('home');

  if (root) {
    root.innerHTML = d.stats.map(s => `
      <div class="record__cell">
        <div class="record__num">${esc(s.number)}</div>
        <div class="record__label">${esc(s.label)}</div>
      </div>`).join('');
  }

  if (feat) {
    const f = d.featured;
    const img = f.image
      ? `<img class="featured__img" src="${esc(f.image)}" alt="${esc(f.title)}">`
      : `<div class="featured__img"></div>`;
    feat.innerHTML = `
      ${img}
      <div>
        <p class="featured__meta">${esc(f.meta)}</p>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.text)}</p>
      </div>`;
  }
}

/* ---------- Press coverage cards ---------- */
async function renderNews() {
  const roots = document.querySelectorAll('[id^="news-root"]');
  if (!roots.length) return;
  const d = await load('news');
  roots.forEach(root => {
    const limit = parseInt(root.dataset.limit || '0', 10);
    const items = limit ? d.items.slice(0, limit) : d.items;
    root.innerHTML = items.map(n => `
      <a class="card" href="${esc(n.url || '#')}">
        ${n.image ? `<img class="card__img" src="${esc(n.image)}" alt="">`
                  : `<div class="card__img"></div>`}
        <p class="card__meta">${esc(n.source)}</p>
        <h3>${esc(n.title)}</h3>
      </a>`).join('');
  });
}

/* ---------- Results table + year filter ----------
   The file in /content plus anything added on the site (kept on the server). */
const MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHN_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* "15-20 Oct 2012", "May-13", "Aug 2013", "2013-08-14" -> {y, m, d} (last two may be 0) */
function parseWhen(r) {
  const t = String(r.dates || '').trim(), low = t.toLowerCase();
  let y = Number(r.year) || 0, m = MONTHS_.findIndex(x => low.includes(x)) + 1, d = 0;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else {
    const y4 = t.match(/\b(19|20)\d{2}\b/); if (y4) y = Number(y4[0]);
    const dm = t.match(/^(\d{1,2})\b/); if (dm) d = Number(dm[1]);
    const ym = low.match(/[a-z]{3}[a-z]*[-\/ ](\d{2})$/); if (!y4 && ym) y = 2000 + Number(ym[1]);
  }
  return { y, m, d };
}
const whenKey = r => { const w = parseWhen(r); return w.y * 10000 + w.m * 100 + w.d; };
function whenText(r) {
  const w = parseWhen(r), t = String(r.dates || '').trim();
  if (!t) return String(r.year || '');
  const hasY = /\b(19|20)\d{2}\b/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t);
  if (hasY) return t;
  const rng = t.match(/^(\d{1,2}(?:\s*-\s*\d{1,2})?)\s+([A-Za-z]+)/);
  if (rng) return rng[1] + ' ' + rng[2] + ' ' + w.y;
  if (w.m) return (w.d ? w.d + ' ' : '') + MONTHN_[w.m - 1] + ' ' + w.y;
  return t + ' ' + (w.y || r.year || '');
}
window.resultsAdded = [];

async function renderResults() {
  const root = document.getElementById('results-root');
  if (!root) return;
  const d = await load('results');
  try {
    const res = await fetch('/api/results', { cache: 'no-store' });
    if (res.ok) window.resultsAdded = (await res.json()).items || [];
  } catch { /* offline: the file alone */ }

  const keyOf = r => String(r.year).trim() + '|' + String(r.tournament).trim().toLowerCase();
  const hidden = new Set(window.resultsAdded.filter(r => r.replaces).map(r => r.replaces));
  const items = d.items.filter(r => !hidden.has(keyOf(r))).map((r, i) => ({ ...r, _o: i, _key: keyOf(r) }))
    .concat(window.resultsAdded.filter(r => !r.hidden).map((r, i) => ({ ...r, _o: 1000 + i })));
  items.sort((a, b) => whenKey(b) - whenKey(a) || a._o - b._o);
  const years = [...new Set(items.map(r => r.year))].sort().reverse();
  window.resultsView = items;
  const admin = !!window.ResultsAdmin && ResultsAdmin.on;

  root.innerHTML = `
    <div class="years">
      <button class="is-active" data-year="all">All years</button>
      ${years.map(y => `<button data-year="${esc(y)}">${esc(y)}</button>`).join('')}
    </div>
    <table class="table">
      <thead>
        <tr><th>Tournament</th><th>Date</th><th>Venue</th></tr>
      </thead>
      <tbody>
        ${items.map((r, ri) => `
        <tr data-year="${esc(r.year)}" data-open="${ri}" tabindex="0" class="res__row">
          <td data-col="tournament">${esc(r.tournament)}</td>
          <td data-col="date">${esc(whenText(r))}</td>
          <td data-col="venue">${esc(r.venue)}${admin ? ` <button class="ent-edit" data-redit="${ri}" aria-label="Edit">\u270e</button><button class="ent-del" data-rdel="${ri}" aria-label="Remove">\u00d7</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  if (window.ResultsAdmin) ResultsAdmin.afterRender();
}

/* ---------- Tournament popup ---------- */
function openResult(ri) {
  const r = (window.resultsView || [])[ri];
  if (!r) return;
  document.getElementById('resModal')?.remove();
  const rows = [['Date', whenText(r)], ['Venue', r.venue], ['Category', r.category], ['Result', r.result]]
    .filter(x => x[1]).map(x => `<div class="mm__row"><dt>${x[0]}</dt><dd>${esc(x[1])}</dd></div>`).join('');
  const links = (r.links || []).map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)} \u2197</a></li>`).join('');
  const photos = (r.photos || []).map(p => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="" loading="lazy"></a>`).join('');
  const el = document.createElement('div');
  el.id = 'resModal'; el.className = 'mm';
  el.innerHTML = `<div class="mm__card" role="dialog" aria-modal="true" aria-label="Tournament details">
    <button class="mm__x" aria-label="Close">\u00d7</button>
    <p class="mm__tour">${esc(r.tournament)}</p>
    <dl class="mm__list">${rows}</dl>
    ${r.notes ? `<p class="res__notes">${esc(r.notes)}</p>` : ''}
    ${links ? `<h4 class="res__h">Media &amp; links</h4><ul class="res__links">${links}</ul>` : ''}
    ${photos ? `<h4 class="res__h">Photographs</h4><div class="res__photos">${photos}</div>` : ''}
  </div>`;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  el.addEventListener('click', ev => { if (ev.target === el || ev.target.classList.contains('mm__x')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
}
document.addEventListener('click', ev => {
  if (ev.target.closest('button, a')) return;
  const tr = ev.target.closest('tr[data-open]');
  if (tr) openResult(Number(tr.dataset.open));
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const tr = ev.target.closest && ev.target.closest('tr[data-open]');
  if (tr) openResult(Number(tr.dataset.open));
});

/* ---------- Store grid ---------- */
async function renderProducts() {
  const roots = document.querySelectorAll('[id^="products-root"]');
  if (!roots.length) return;
  const [d, s] = await Promise.all([load('products'), load('settings')]);

  roots.forEach(root => {
    const limit = parseInt(root.dataset.limit || '0', 10);
    const items = limit ? d.items.slice(0, limit) : d.items;
    root.innerHTML = items.map((p, i) => {
      const msg = encodeURIComponent(`Hi Naveed, I'd like to order: ${p.name}`);
      const href = p.sold_out ? '#' : `https://wa.me/${s.whatsapp}?text=${msg}`;
      const img = p.image
        ? `<img class="product__img" src="${esc(p.image)}" alt="${esc(p.name)}">`
        : `<div class="product__img">${String(i + 1).padStart(2, '0')}</div>`;
      return `
      <a class="product${p.sold_out ? ' product--out' : ''}" href="${href}"
         data-cat="${esc(p.category)}"${p.sold_out ? '' : ' target="_blank" rel="noopener"'}>
        <div style="position:relative">
          ${p.sold_out ? '<span class="product__tag">Sold out</span>' : ''}
          ${img}
        </div>
        <p class="product__name">${esc(p.name)}</p>
        <p class="product__price">PKR ${esc(p.price)}</p>
      </a>`;
    }).join('');
  });
}

/* ---------- Contact details, wherever they appear ---------- */
async function renderSettings() {
  const slots = document.querySelectorAll('[data-wa], [data-email]');
  if (!slots.length) return;
  const s = await load('settings');
  slots.forEach(el => {
    if (el.hasAttribute('data-wa')) el.href = 'https://wa.me/' + s.whatsapp;
    if (el.hasAttribute('data-email')) {
      el.href = 'mailto:' + s.email;
      if (el.dataset.email === 'text') el.textContent = s.email;
    }
  });
}

/* ---------- Run everything, then start the filters ---------- */
(async function () {
  try {
    await Promise.all([
      renderHome(), renderNews(), renderResults(), renderProducts(), renderSettings()
    ]);
  } catch (err) {
    console.error('Content failed to load:', err);
  }
  if (window.initFilters) window.initFilters();
})();
