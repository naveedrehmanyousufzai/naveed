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
  if (!names.includes(divPick.entries)) divPick.entries = names[0] || '';
  const cur = divPick.entries;
  const shown = names.filter(n => n === cur);

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
      <hr class="rule">
      <h3 class="tsec__h">Import from a Word file</h3>
      <p class="pad__publish-note">Use a table with the columns <b>Category, Rank, Name, Association, Country</b>. Excel files saved as CSV work too.
      <a href="entries-template.docx" download>Download the template</a>.</p>
      <input class="pad__name" type="file" id="entFile" accept=".docx,.csv,.txt">
      <div id="entPreview"></div>
    </div>` : `<form id="entLogin" class="ent-admin">
      <h3 class="tsec__h">Organiser sign-in</h3>
      <div class="ent-admin__grid"><label class="pad__field"><span>Admin password</span><input class="pad__name" type="password" name="pw" autocomplete="current-password" required></label></div>
      <button class="btn btn--solid" type="submit">Sign in to add players</button>
      <span class="pad__publish-state" id="entLoginState"></span>
    </form>`;

  box.innerHTML = `${admin}
    ${list.length ? `<p class="pad__intro">${list.length} player${list.length === 1 ? '' : 's'} entered, highest national rank first.</p>${divChips('entries', names, true)}` : '<p class="pad__empty">No entries have been published yet.</p>'}
    ${shown.map(n => {
      const rows = list.filter(e => e.division === n).sort((a, b) => rankKey(a) - rankKey(b) || String(a.name).localeCompare(b.name));
      return `<h3 class="tsec__h">${esc(n)} <small>${rows.length}</small></h3>
      <table class="table plain-table"><thead><tr><th>Rank</th><th>Player</th><th>Association</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(e => `<tr><td>${esc(e.rank || '–')}</td><td>${esc(e.name)}${e.country ? ' <small>' + esc(e.country) + '</small>' : ''}</td><td>${esc(e.club || '')}</td>${isAdmin ? `<td>${e.cms ? '' : `<button class="ent-del" data-del="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">×</button>`}</td>` : ''}</tr>`).join('')}
      </tbody></table>`;
    }).join('')}`;
}

document.addEventListener('submit', async e => {
  if (e.target.id === 'entLogin') {
    e.preventDefault();
    const pw = new FormData(e.target).get('pw');
    const st = document.getElementById('entLoginState');
    st.textContent = 'Checking…';
    sessionStorage.setItem('nr-pass', pw);
    await checkAdmin();
    if (!isAdmin) { sessionStorage.removeItem('nr-pass'); st.textContent = 'Wrong password, or not the organiser password.'; return; }
    show();
    return;
  }
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
   IMPORT — read a Word table (or CSV) and list the players found
   ============================================================ */
function normCategory(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[._]/g, ' ');
  if (!t || t.length > 40) return null;
  if (/^(open )?(men|mens|men's|male)\b/.test(t) && !/under|u\d/.test(t)) return 'Men';
  if (/^(open )?(women|womens|women's|ladies|female)\b/.test(t) && !/under|u\d/.test(t)) return 'Women';
  const m = t.match(/\b(boys?|girls?|b|g)\s*-?\s*(?:u|under|u-)?\s*-?\s*(9|11|13|15|17|19)\b/);
  if (m) return (m[1][0] === 'b' ? 'Boys' : 'Girls') + ' Under ' + m[2];
  const m2 = t.match(/\bunder\s*(9|11|13|15|17|19)\s*(boys?|girls?)\b/);
  if (m2) return (m2[2][0] === 'b' ? 'Boys' : 'Girls') + ' Under ' + m2[1];
  return null;
}

function parseCsv(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => {
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if ((ch === ',' || ch === '\t' || ch === ';') && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim()); return out;
  });
}

/* A Word document -> [{ heading } | { row: [cells] }] in reading order */
async function readDocx(file) {
  if (!window.JSZip) {
    await new Promise((ok, no) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      sc.onload = ok; sc.onerror = () => no(new Error('Could not load the file reader. Check your connection.'));
      document.head.appendChild(sc);
    });
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const textOf = el => Array.from(el.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join('').trim();
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const items = [];
  for (const node of body.children) {
    if (node.localName === 'p') {
      const t = textOf(node); if (t) items.push({ heading: t });
    } else if (node.localName === 'tbl') {
      for (const tr of node.getElementsByTagNameNS(W, 'tr')) {
        items.push({ row: Array.from(tr.getElementsByTagNameNS(W, 'tc')).map(textOf) });
      }
    }
  }
  return items;
}

function extractPlayers(items) {
  const out = [];
  let cat = null, cols = null;
  const num = v => /^\d{1,4}$/.test(String(v).trim());
  for (const it of items) {
    if (it.heading !== undefined) { const c = normCategory(it.heading); if (c) cat = c; continue; }
    const row = it.row.map(c => c.trim());
    if (!row.some(Boolean)) continue;
    const low = row.map(c => c.toLowerCase());
    if (low.some(c => /^(name|player|player name)$/.test(c))) {          // header row
      const find = re => low.findIndex(c => re.test(c));
      cols = { name: find(/^(name|player|player name)$/), rank: find(/rank|seed|^#$|^no\.?$/),
        club: find(/associat|club|dept|department|academy|team/), cat: find(/categ|division|event/),
        country: find(/countr|nation/) };
      continue;
    }
    if (!cols) {                                                          // no header: guess rank, name, association
      const r0 = num(row[0]);
      cols = r0 ? { rank: 0, name: 1, club: 2, cat: -1, country: 3 } : { rank: -1, name: 0, club: 1, cat: -1, country: 2 };
      cols.guessed = true;
    }
    const name = row[cols.name]; if (!name || /^\d+$/.test(name)) continue;
    const rowCat = cols.cat >= 0 ? normCategory(row[cols.cat]) : null;
    if (!rowCat && row.length === 1) { const c = normCategory(name); if (c) { cat = c; continue; } }
    out.push({
      name, club: cols.club >= 0 ? row[cols.club] || '' : '',
      rank: cols.rank >= 0 && num(row[cols.rank]) ? Number(row[cols.rank]) : null,
      country: cols.country >= 0 ? row[cols.country] || '' : '',
      division: rowCat || cat || '', include: true
    });
  }
  return out;
}

let importRows = [];
function renderImport() {
  const box = document.getElementById('entPreview');
  if (!importRows.length) { box.innerHTML = ''; return; }
  const missing = importRows.filter(r => r.include && !r.division).length;
  box.innerHTML = `<p class="pad__intro">${importRows.length} players found. Check the category of each, then import.</p>
    <table class="table plain-table"><thead><tr><th>Add</th><th>Rank</th><th>Name</th><th>Association</th><th>Category</th></tr></thead><tbody>
    ${importRows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" data-f="include" ${r.include ? 'checked' : ''}></td>
      <td>${esc(r.rank || '–')}</td><td>${esc(r.name)}</td><td>${esc(r.club)}</td>
      <td><select class="pad__name" data-i="${i}" data-f="division"><option value="">— choose —</option>${ENTRY_CATS.map(c => `<option${c === r.division ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table>
    <button class="btn btn--solid" id="entImport" ${missing ? 'disabled' : ''}>Import ${importRows.filter(r => r.include).length} players</button>
    <span class="pad__publish-state" id="entImpState">${missing ? missing + ' still need a category.' : ''}</span>`;
}

document.addEventListener('change', async e => {
  if (e.target.id === 'entFile') {
    const f = e.target.files[0]; if (!f) return;
    const box = document.getElementById('entPreview');
    box.innerHTML = '<p class="pad__empty">Reading…</p>';
    try {
      const items = /\.docx$/i.test(f.name)
        ? await readDocx(f)
        : parseCsv(await f.text()).map(row => ({ row }));
      importRows = extractPlayers(items);
      if (!importRows.length) box.innerHTML = '<p class="pad__empty">No players found. Use the template: a table with Category, Rank, Name, Association, Country.</p>';
      else renderImport();
    } catch (err) { box.innerHTML = '<p class="pad__empty">Could not read the file: ' + esc(err.message) + '</p>'; }
    return;
  }
  const i = e.target.dataset && e.target.dataset.i;
  if (i !== undefined && e.target.closest('#entPreview')) {
    importRows[Number(i)][e.target.dataset.f] = e.target.dataset.f === 'include' ? e.target.checked : e.target.value;
    renderImport();
  }
});

document.addEventListener('click', async e => {
  if (e.target.id !== 'entImport') return;
  const st = document.getElementById('entImpState');
  const add = importRows.filter(r => r.include && r.division);
  const before = entryList.slice();
  let added = 0;
  for (const r of add) {
    const dup = entryList.some(x => x.division === r.division && x.name.toLowerCase() === r.name.toLowerCase());
    if (dup) continue;
    entryList.push({ id: Math.random().toString(36).slice(2, 10), name: r.name, club: r.club, country: r.country, division: r.division, rank: r.rank });
    added++;
  }
  st.textContent = 'Saving…';
  try { await saveEntries(); importRows = []; show(); }
  catch (err) { entryList = before; st.textContent = err.message; }
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
