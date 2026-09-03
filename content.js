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

/* ---------- Results table + year filter ---------- */
async function renderResults() {
  const root = document.getElementById('results-root');
  if (!root) return;
  const d = await load('results');

  const years = [...new Set(d.items.map(r => r.year))].sort().reverse();

  root.innerHTML = `
    <div class="years">
      <button class="is-active" data-year="all">All years</button>
      ${years.map(y => `<button data-year="${esc(y)}">${esc(y)}</button>`).join('')}
    </div>
    <table class="table">
      <thead>
        <tr><th>Year</th><th>Tournament</th><th>Venue</th><th>Result</th></tr>
      </thead>
      <tbody>
        ${d.items.map(r => `
        <tr data-year="${esc(r.year)}">
          <td data-col="year">${esc(r.year)}</td>
          <td data-col="tournament">${esc(r.tournament)}</td>
          <td data-col="venue">${esc(r.venue)}</td>
          <td data-col="result"${r.win ? ' class="win"' : ''}>${esc(r.result)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

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
