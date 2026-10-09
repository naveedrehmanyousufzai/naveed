/* ============================================================
   drawmaker.js — building and publishing a draw

   The arithmetic lives in drawlogic.js and the drawing in
   drawview.js. This file is only the controls.
   ============================================================ */

const PASS_KEY = 'nr-pass';
const NAME_KEY = 'nr-referee';

const $ = id => document.getElementById(id);
let current = null;          // the draw on screen
let sched = null;            // the matches (court, time, referee) on screen
let referees = [];           // names the organiser can assign
let logo = '';               // tournament logo as a small data URL

/* ---------- Categories and players ---------- */
const CATS = [
  ['BU9', 'Boys Under 9'], ['GU9', 'Girls Under 9'], ['BU11', 'Boys Under 11'], ['GU11', 'Girls Under 11'],
  ['BU13', 'Boys Under 13'], ['GU13', 'Girls Under 13'], ['BU15', 'Boys Under 15'], ['GU15', 'Girls Under 15'],
  ['BU17', 'Boys Under 17'], ['GU17', 'Girls Under 17'], ['BU19', 'Boys Under 19'], ['GU19', 'Girls Under 19'],
  ['MEN', 'Men'], ['WOMEN', 'Women']
];
let entriesAll = [];                 // the tournament's entries
const drafts = {};                   // label -> { current, sched }
let activeDraft = '';

const rankOf = e => (Number(e.rank) > 0 ? Number(e.rank) : 1e9);
const byRank = (a, b) => rankOf(a) - rankOf(b) || String(a.name).localeCompare(b.name);
const ticked = () => CATS.filter(([c]) => $('cat_' + c) && $('cat_' + c).checked).map(c => c[1]);
const mainSlots = () => Number($('dmSize').value) - Number($('dmWild').value);

function renderCats() {
  $('dmCats').innerHTML = CATS.map(([c, label]) => `
    <label class="dm__cat"><input type="checkbox" id="cat_${c}" data-cat="${stamp(label)}"> <span>${c === 'MEN' ? 'Men' : c === 'WOMEN' ? 'Women' : c}</span></label>`).join('');
}

/* A player is in the draw when marked Present (P). WC marks a wild card. */
const isIn = e => e.attendance === 'P';

function seedsFor(label) {
  const size = Number($('dmSize').value);
  const seedCount = size / 2;            // half the draw is seeded: 8 of 16, 16 of 32, 32 of 64
  const m = new Map();
  let n = 0;
  entriesAll.filter(e => e.division === label && isIn(e) && !e.wc && e.rank).sort(byRank)
    .forEach(e => { if (n < seedCount) m.set(e.id, ++n); });
  return m;
}

function renderPlayers() {
  const box = $('dmPlayers');
  const labels = ticked();
  if (!$('dmTournament').value) { box.innerHTML = '<p class="pad__empty">Choose a tournament and tick a category.</p>'; updateCount(); return; }
  if (!labels.length) { box.innerHTML = '<p class="pad__empty">Tick one or more categories above.</p>'; updateCount(); return; }

  box.innerHTML = labels.map(label => {
    const list = entriesAll.filter(e => e.division === label).sort(byRank);
    if (!list.length) return `<div class="dm__pl"><h4 class="dm__round">${stamp(label)}</h4><p class="pad__empty">No entries yet. Add players on the tournament page, Entries tab.</p></div>`;
    const seeds = seedsFor(label);
    const present = list.filter(isIn);
    const wc = present.filter(e => e.wc).length;
    const main = present.length - wc;
    const over = main > mainSlots();
    return `<div class="dm__pl" data-label="${stamp(label)}">
      <h4 class="dm__round">${stamp(label)} <small>present ${present.length} · main ${main}/${mainSlots()} · wild cards ${wc}/${$('dmWild').value}</small></h4>
      ${over ? '<p class="pad__publish-state pad__publish-state--bad">Too many present for this draw size. Mark some Absent, or choose a bigger draw.</p>' : ''}
      <table class="table plain-table"><thead><tr><th>Seed</th><th>Name</th><th>Rank</th><th>Association</th><th>P</th><th>A</th><th>WC</th></tr></thead><tbody>
      ${list.map(e => `<tr${e.attendance === 'A' ? ' class="dm__absent"' : ''}>
        <td>${seeds.get(e.id) || '–'}</td><td>${stamp(e.name)}</td><td>${e.rank || '–'}</td><td>${stamp(e.club)}</td>
        <td><input type="checkbox" data-p="${stamp(e.id)}" ${e.attendance === 'P' ? 'checked' : ''} aria-label="Present"></td>
        <td><input type="checkbox" data-a="${stamp(e.id)}" ${e.attendance === 'A' ? 'checked' : ''} aria-label="Absent"></td>
        <td><input type="checkbox" data-wc="${stamp(e.id)}" ${e.wc ? 'checked' : ''} ${isIn(e) ? '' : 'disabled'} aria-label="Wild card"></td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');
  updateCount();
}

let saveTimer = null;
function saveAttendance() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await post('/api/entries', { tournament: $('dmTournament').value, entries: entriesAll.filter(e => !String(e.id).startsWith('cms')) });
    } catch (err) { say('Could not save attendance — ' + err.message, 'bad'); }
  }, 600);
}

$('dmPlayers').addEventListener('change', e => {
  const t = e.target;
  const id = t.dataset.p || t.dataset.a || t.dataset.wc;
  const p = entriesAll.find(x => x.id === id);
  if (!p) return;
  if (t.dataset.p) p.attendance = t.checked ? 'P' : '';
  if (t.dataset.a) p.attendance = t.checked ? 'A' : '';
  if (t.dataset.wc) p.wc = t.checked;
  if (p.attendance !== 'P') p.wc = false;
  renderPlayers();
  saveAttendance();
});
$('dmCats').addEventListener('change', renderPlayers);
['dmSize', 'dmWild'].forEach(id => $(id).addEventListener('change', renderPlayers));

function say(msg, kind) {
  const el = $('dmState');
  el.textContent = msg || '';
  el.className = 'pad__publish-state' + (kind ? ' pad__publish-state--' + kind : '');
}

function updateCount() {
  const labels = ticked();
  if (!labels.length) { $('dmCount').textContent = ''; return; }
  const n = labels.reduce((t, l) => t + entriesAll.filter(e => e.division === l && isIn(e)).length, 0);
  $('dmCount').textContent = `${labels.length} categor${labels.length === 1 ? 'y' : 'ies'}, ${n} players present — ` +
    ($('dmFormat').value === 'groups' ? `${$('dmGroups').value} groups each` : `${$('dmSize').value}-player draws`);
}

/* Present players for one category, seeded by rank, wild cards unseeded. */
function playersFor(label) {
  const seeds = seedsFor(label);
  return entriesAll.filter(e => e.division === label && isIn(e)).sort(byRank).map(e => {
    const out = { name: e.name, club: e.club || '', country: e.country || '' };
    if (seeds.has(e.id)) out.seed = seeds.get(e.id);
    if (e.wc) out.wildcard = true;
    return out;
  });
}

/* ---------- An empty bracket, filled in by hand ---------- */
function blankDraws() {
  const tournament = tName();
  const tournamentId = $('dmTournament').value;
  if (!tournamentId) { say('Choose the tournament first.', 'bad'); return; }
  const labels = ticked();
  if (!labels.length) { say('Tick the category this bracket is for.', 'bad'); return; }
  const size = Number($('dmSize').value);
  const made = {};
  for (const label of labels) {
    const draw = DrawLogic.blankKnockout(size);
    draw.tournament = tournament; draw.tournamentId = tournamentId; draw.event = label;
    draw.made = Date.now(); draw.madeBy = sessionStorage.getItem(NAME_KEY) || '';
    made[label] = { current: draw, sched: { drawId: String(draw.made), tournamentId, tournament, event: label, logo, matches: DrawLogic.matchesFromDraw(draw) } };
  }
  Object.keys(drafts).forEach(k => delete drafts[k]);
  Object.assign(drafts, made);
  showDraft(labels[0]);
  ['dmRedraw', 'dmPublish', 'dmPrint', 'dmPaperWrap'].forEach(id => { $(id).hidden = false; });
  $('dmRedraw').hidden = true;      // "draw again" makes no sense for an empty bracket
  say('Empty bracket ready. Click any place to type a player in, then set courts and times below.', 'good');
}

/* Rebuild the matches after a place changed, keeping court, time and referee. */
function refreshMatches() {
  const old = new Map((sched.matches || []).map(m => [m.id, m]));
  current.byes = current.slots.filter(s => !s.open && !s.player).length;
  current.made = Date.now(); sched.drawId = String(current.made);
  sched.matches = DrawLogic.matchesFromDraw(current).map(m => {
    const o = old.get(m.id);
    if (o) { m.court = o.court || ''; m.time = o.time || ''; m.referee = o.referee || ''; }
    return m;
  });
  DrawView.render($('dmPreview'), current, sched);
  renderMatches();
}

function openSlotEditor(i) {
  if (!current || !current.slots) return;
  const s = current.slots[i], p = s.player || {};
  document.getElementById('dmSlotEd')?.remove();
  const ov = document.createElement('div');
  ov.id = 'dmSlotEd'; ov.className = 'mm no-print';
  ov.innerHTML = `<form class="mm__card">
    <button type="button" class="mm__x" data-close aria-label="Close">\u00d7</button>
    <p class="mm__tour">Place ${i + 1}${s.spot ? ' (seed spot ' + s.spot + ')' : ''}</p>
    <label class="pad__field"><span>Player name</span><input class="pad__name" name="name" value="${stamp(p.name || '')}" required></label>
    <label class="pad__field"><span>Association / club</span><input class="pad__name" name="club" value="${stamp(p.club || '')}"></label>
    <label class="pad__field"><span>Country (optional)</span><input class="pad__name" name="country" value="${stamp(p.country || '')}"></label>
    <label class="pad__field"><span>Seed (leave empty if unseeded)</span><input class="pad__name" name="seed" type="number" min="1" value="${stamp(s.seed || '')}"></label>
    <button class="btn btn--solid" type="submit">Save</button>
    <button class="btn btn--ghost" type="button" data-act="bye">Mark as bye</button>
    <button class="btn btn--ghost" type="button" data-act="clear">Clear</button>
  </form>`;
  document.body.appendChild(ov);
  const apply = fn => { fn(); ov.remove(); refreshMatches(); };
  ov.addEventListener('click', ev => {
    if (ev.target === ov || ev.target.closest('[data-close]')) ov.remove();
    const act = ev.target.dataset && ev.target.dataset.act;
    if (act === 'bye') apply(() => { s.player = null; s.seed = null; s.open = false; });
    if (act === 'clear') apply(() => { s.player = null; s.seed = null; s.open = true; });
  });
  ov.querySelector('form').addEventListener('submit', ev => {
    ev.preventDefault();
    const f = ev.target.elements;
    apply(() => {
      s.player = { name: f.name.value.trim(), club: f.club.value.trim(), country: f.country.value.trim() };
      s.seed = Number(f.seed.value) > 0 ? Number(f.seed.value) : null;
      if (s.seed) s.player.seed = s.seed;
      s.open = false;
    });
  });
  ov.querySelector('[name=name]').focus();
}
$('dmPreview').addEventListener('click', ev => {
  const slot = ev.target.closest('[data-slot]');
  if (slot && current && current.slots) { ev.stopPropagation(); openSlotEditor(Number(slot.dataset.slot)); }
}, true);
$('dmBlank').addEventListener('click', blankDraws);

/* ---------- Making the draws ---------- */
function generate() {
  const tournament = tName();
  const tournamentId = $('dmTournament').value;
  if (!tournamentId) { say('Choose the tournament first.', 'bad'); return; }
  const labels = ticked();
  if (!labels.length) { say('Tick at least one category.', 'bad'); return; }

  const made = {};
  for (const label of labels) {
    const entries = playersFor(label);
    if (entries.length < 2) { say(`${label}: mark at least two players Present.`, 'bad'); return; }
    let draw;
    try {
      draw = $('dmFormat').value === 'groups'
        ? DrawLogic.buildGroups(entries, Number($('dmGroups').value))
        : DrawLogic.buildKnockout(entries, { size: Number($('dmSize').value) });
    } catch (err) { say(`${label}: ${err.message}`, 'bad'); return; }
    draw.tournament = tournament; draw.tournamentId = tournamentId; draw.event = label;
    draw.made = Date.now(); draw.madeBy = sessionStorage.getItem(NAME_KEY) || '';
    made[label] = {
      current: draw,
      sched: { drawId: String(draw.made), tournamentId, tournament, event: label, logo,
               matches: DrawLogic.matchesFromDraw(draw) }
    };
  }
  Object.keys(drafts).forEach(k => delete drafts[k]);
  Object.assign(drafts, made);
  showDraft(labels[0]);
  ['dmRedraw', 'dmPublish', 'dmPrint', 'dmPaperWrap'].forEach(id => { $(id).hidden = false; });
  say(`${labels.length} draw${labels.length === 1 ? '' : 's'} made. Set courts, times and referees below, then publish.`, 'good');
}

function renderTabs() {
  const keys = Object.keys(drafts);
  const box = $('dmTabs');
  box.hidden = keys.length < 2;
  box.innerHTML = keys.map(k => `<button class="pad__chip${k === activeDraft ? ' pad__chip--on' : ''}" data-draft="${stamp(k)}">${stamp(k)}</button>`).join('');
}
$('dmTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-draft]');
  if (b) showDraft(b.dataset.draft);
});

function showDraft(k) {
  activeDraft = k;
  current = drafts[k].current;
  sched = drafts[k].sched;
  if (current) DrawView.render($('dmPreview'), current, sched); else $('dmPreview').innerHTML = '';
  renderTabs();
  renderMatches();
}

/* The tournament dropdown is filled from content/tournaments.json. */
let tournaments = [];
const tName = () => {
  const o = $('dmTournament').selectedOptions[0];
  return o && o.value ? o.textContent : '';
};
const slugOf = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* One draw per tournament and division */
const sidOf = (tid, event) => tid + '__' + slugOf(event);

/* ---------- The match list ---------- */
const stamp = t => String(t ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const who = p => p ? stamp(p.name) : '<span class="dm__tbd">to be decided</span>';

function renderMatches() {
  const box = $('dmSchedule');
  if (!sched || !sched.matches.length) { box.hidden = true; return; }
  box.hidden = false;

  const opts = sel => ['<option value="">— unassigned —</option>']
    .concat(referees.map(n =>
      `<option value="${stamp(n)}"${n === sel ? ' selected' : ''}>${stamp(n)}</option>`))
    .concat(sel && !referees.includes(sel)
      ? [`<option value="${stamp(sel)}" selected>${stamp(sel)}</option>`] : [])
    .join('');

  let round = null, html = '';
  sched.matches.forEach((m, i) => {
    if (m.round !== round) {
      if (round !== null) html += '</tbody></table>';
      round = m.round;
      html += `<h4 class="dm__round">${stamp(round)}</h4>
        <table class="table dm__table"><thead><tr>
          <th>#</th><th>Match</th><th>Court</th><th>Time</th><th>Referee</th><th></th>
        </tr></thead><tbody>`;
    }
    const bye = m.status === 'bye';
    html += `<tr data-i="${i}"${bye ? ' class="dm__bye"' : ''}>
      <td>${m.no}</td>
      <td>${who(m.p1)} <span class="dm__vs">v</span> ${bye ? 'bye' : who(m.p2)}</td>
      <td><input class="pad__name dm__court" data-f="court" value="${stamp(m.court)}" ${bye ? 'disabled' : ''}></td>
      <td><input class="pad__name" type="datetime-local" data-f="time" value="${stamp(m.time)}" ${bye ? 'disabled' : ''}></td>
      <td><select class="pad__name" data-f="referee" ${bye ? 'disabled' : ''}>${opts(m.referee)}</select></td>
      <td class="dm__status">${m.status === 'done' ? stamp(m.score || 'done') : m.status === 'live' ? 'live' : ''}</td>
    </tr>`;
  });
  box.querySelector('#dmMatches').innerHTML = html + '</tbody></table>';
}

/* Keep what the organiser types in the match list. */
$('dmMatches').addEventListener('input', e => {
  const row = e.target.closest('tr[data-i]');
  if (!row || !sched) return;
  sched.matches[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
  if (current) DrawView.render($('dmPreview'), current, sched);
});

function schedSay(msg, kind) {
  const el = $('dmSchedState');
  el.textContent = msg || '';
  el.className = 'pad__publish-state' + (kind ? ' pad__publish-state--' + kind : '');
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': sessionStorage.getItem(PASS_KEY) || ''
    },
    body: JSON.stringify(body)
  });
  if (res.status === 401 || res.status === 403) throw new Error('Your sign-in has expired. Reload and sign in again.');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function saveSchedule() {
  sched.tournamentId = $('dmTournament').value || sched.tournamentId;
  sched.tournament = tName() || sched.tournament;
  sched.logo = logo;
  if (!sched.tournamentId || !sched.event) throw new Error('Choose the tournament and a category first.');
  const saved = await post('/api/schedule?id=' + encodeURIComponent(sidOf(sched.tournamentId, sched.event)), sched);
  if (drafts[activeDraft]) drafts[activeDraft].sched = saved;
  sched = saved;                 // keeps any result a referee just reported
  renderMatches();
}

/* ---------- Publishing ---------- */
async function publish() {
  const keys = Object.keys(drafts).filter(k => drafts[k].current);
  if (!keys.length) return;
  say('Publishing…');
  const keep = activeDraft;
  try {
    for (const k of keys) {
      showDraft(k);
      await post('/api/draw?id=' + encodeURIComponent(sidOf(current.tournamentId, current.event)), current);
      await saveSchedule();
    }
    showDraft(keep);
    say(`Published ${keys.length} draw${keys.length === 1 ? '' : 's'}. The draws and matches are live on the site.`, 'good');
    schedSay('Saved.', 'good');
  } catch (err) {
    say('Could not publish — ' + err.message + ' The draw is still on screen; try again.', 'bad');
  }
}

$('dmSaveSched').addEventListener('click', async () => {
  schedSay('Saving…');
  try { await saveSchedule(); schedSay('Saved. Referees will see their matches.', 'good'); }
  catch (err) { schedSay(err.message, 'bad'); }
});

/* ---------- Logo: shrunk in the browser so it stays small ---------- */
$('dmLogo').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const max = 360;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    logo = c.toDataURL('image/png');
    $('dmLogoPreview').src = logo;
    $('dmLogoPreview').hidden = false;
    Object.values(drafts).forEach(d => { d.sched.logo = logo; });
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

/* Fill the tournament list, and the "open a published draw" list for the
   tournament chosen. */
async function loadTournaments() {
  try {
    const res = await fetch('/api/tournaments', { cache: 'no-store' }).then(r => r.ok ? r : fetch('content/tournaments.json'));
    tournaments = (await res.json()).tournaments || [];
  } catch { tournaments = []; }
  const sel = $('dmTournament');
  const keep = sel.value;
  sel.innerHTML = '<option value="">Choose a tournament…</option>' +
    tournaments.map(t => `<option value="${stamp(t.id)}">${stamp(t.name)}</option>`).join('');
  sel.value = keep;
}

let publishedHere = [];
async function loadPublished() {
  const tid = $('dmTournament').value;
  const open = $('dmOpen');
  open.innerHTML = '<option value="">— none —</option>';
  publishedHere = [];
  if (!tid) return;
  try {
    const res = await fetch('/api/schedule?tournament=' + encodeURIComponent(tid), { cache: 'no-store' });
    publishedHere = res.ok ? (await res.json()).schedules || [] : [];
  } catch { /* nothing published yet */ }
  $('dmDelAll').hidden = !publishedHere.length;
  $('dmDelOne').hidden = true;
  open.innerHTML = '<option value="">— none —</option>' +
    publishedHere.map((s, i) => `<option value="${i}">${stamp(s.event || 'Draw')}</option>`).join('');
}

function openPublished(i) {
  const s = publishedHere[Number(i)];
  if (!s) return;
  logo = s.logo || '';
  $('dmLogoPreview').src = logo; $('dmLogoPreview').hidden = !logo;
  Object.keys(drafts).forEach(k => delete drafts[k]);
  drafts[s.event || 'Draw'] = { current: null, sched: s };
  ['dmRedraw', 'dmPublish', 'dmPrint', 'dmPaperWrap'].forEach(id => { $(id).hidden = true; });
  showDraft(s.event || 'Draw');
  say('Opened the published draw. Change courts, times and referees below.', 'good');
}

async function loadEntries() {
  const tid = $('dmTournament').value;
  entriesAll = [];
  if (tid) {
    try {
      const res = await fetch('/api/entries?tournament=' + encodeURIComponent(tid), { cache: 'no-store' });
      entriesAll = res.ok ? (await res.json()).entries || [] : [];
    } catch { /* none yet */ }
    const t = tournaments.find(x => x.id === tid);
    if (t && Array.isArray(t.entries)) {
      t.entries.forEach((e, i) => { if (e.name && e.division) entriesAll.push({ id: 'cms' + i, name: e.name, club: e.club || '', country: e.country || '', division: e.division, rank: e.rank || e.seed || null }); });
    }
  }
  renderPlayers();
}
$('dmTournament').addEventListener('change', () => { loadPublished(); loadEntries(); });
$('dmOpen').addEventListener('change', e => { openPublished(e.target.value); $('dmDelOne').hidden = e.target.value === ''; });

async function deletePublished(list, what) {
  if (!list.length) return;
  if (!confirm('Delete ' + what + '? The draw, its matches, courts, times and results are removed from the site. This cannot be undone.')) return;
  try {
    for (const s of list) {
      const res = await fetch('/api/schedule?id=' + encodeURIComponent(s.id), {
        method: 'DELETE', headers: { 'x-admin-password': sessionStorage.getItem(PASS_KEY) || '' }
      });
      if (res.status === 401 || res.status === 403) throw new Error('Sign in as the organiser first.');
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }
    Object.keys(drafts).forEach(k => delete drafts[k]);
    $('dmOpen').value = '';
    await loadPublished();
    location.reload();
  } catch (err) { say('Could not delete — ' + err.message, 'bad'); }
}
$('dmDelOne').addEventListener('click', () => {
  const s = publishedHere[Number($('dmOpen').value)];
  if (s) deletePublished([s], 'the published draw "' + (s.event || 'Draw') + '"');
});
$('dmDelAll').addEventListener('click', () =>
  deletePublished(publishedHere.slice(), 'ALL ' + publishedHere.length + ' published draw(s) of this tournament'));

$('dmFeedback').addEventListener('click', async () => {
  const box = $('dmFeedbackList');
  const tid = $('dmTournament').value;
  if (!tid) { box.innerHTML = '<p class="pad__empty">Choose a tournament first.</p>'; return; }
  try {
    const res = await fetch('/api/feedback?tournament=' + encodeURIComponent(tid), {
      headers: { 'x-admin-password': sessionStorage.getItem(PASS_KEY) || '' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = (await res.json()).items || [];
    box.innerHTML = items.length ? items.map(f => `
      <div class="fbitem"><p class="fbitem__meta">${stamp(f.kind)} · ${stamp(f.name || 'anonymous')}${f.contact ? ' · ' + stamp(f.contact) : ''} · ${stamp(new Date(f.at).toLocaleString())}</p>
      <p>${stamp(f.message)}</p></div>`).join('') : '<p class="pad__empty">No feedback yet.</p>';
  } catch (err) { box.innerHTML = '<p class="pad__empty">Could not load feedback: ' + stamp(err.message) + '</p>'; }
});

/* ---------- Login ---------- */
function openMaker() {
  $('dmLogin').hidden = true;
  $('dmMain').hidden = false;
  const name = sessionStorage.getItem(NAME_KEY);
  if (name) { $('dmWho').hidden = false; $('dmWhoName').textContent = name; }
  renderCats();
  loadTournaments().then(() => { loadPublished(); loadEntries(); });
}

async function signIn(pw) {
  const msg = $('dmLoginMsg');
  msg.textContent = 'Checking…';
  msg.className = 'ref-login__msg';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: '{}'
    });
    if (res.status === 401) {
      msg.textContent = 'Wrong password.';
      msg.className = 'ref-login__msg ref-login__msg--bad';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json().catch(() => ({}));
    if (body.name !== 'Admin') {
      msg.textContent = 'This page needs the organiser (admin) password, not a referee password.';
      msg.className = 'ref-login__msg ref-login__msg--bad';
      return;
    }
    referees = body.referees || [];
    sessionStorage.setItem(PASS_KEY, pw);
    sessionStorage.setItem(NAME_KEY, body.name || 'Organiser');
    openMaker();
  } catch {
    msg.textContent = 'Could not reach the server. You can still build a draw to print, ' +
                      'but it cannot be published.';
    msg.className = 'ref-login__msg ref-login__msg--bad';
    openMaker();
    $('dmPublish').hidden = true;
  }
}

/* ---------- Wiring ---------- */
$('dmLoginForm').addEventListener('submit', e => {
  e.preventDefault();
  const pw = $('dmPass').value;
  if (pw) signIn(pw);
});

$('dmFormat').addEventListener('change', () => {
  const groups = $('dmFormat').value === 'groups';
  $('dmGroupsField').hidden = !groups;
  updateCount();
});

$('dmGroups').addEventListener('change', updateCount);

$('dmGenerate').addEventListener('click', generate);
$('dmRedraw').addEventListener('click', generate);   // a fresh random draw
$('dmPublish').addEventListener('click', publish);
$('dmPrint').addEventListener('click', () => window.print());

/* ---------- Print: the whole draw on ONE page ----------
   Just before printing, work out the paper (A4 or Legal), pick portrait or landscape,
   and shrink the bracket so everything fits on a single sheet. */
const PAPER = { a4: [210, 297], legal: [216, 356] };
const MARGIN_MM = 8;
const MM_PX = 96 / 25.4;
function fitStyle() {
  const box = $('dmPreview');
  const br = box && box.querySelector('.bracket, .groups');
  if (!box || !br || !box.offsetParent) return null;
  const hint = box.querySelector('.bracket__hint');
  const W = Math.max(br.scrollWidth, box.scrollWidth);
  const H = box.scrollHeight - (hint ? hint.offsetHeight + 30 : 0);
  const [pw, ph] = PAPER[$('dmPaper').value] || PAPER.a4;
  const best = [['portrait', pw, ph], ['landscape', ph, pw]].map(([o, w, h]) => {
    const s = Math.min(((w - 2 * MARGIN_MM) * MM_PX) / W, ((h - 2 * MARGIN_MM) * MM_PX) / H);
    return { o, s };
  }).sort((a, b) => b.s - a.s)[0];
  const scale = Math.min(best.s * 0.95, 1.4);
  const st = document.createElement('style');
  st.id = 'dmFitStyle';
  st.textContent = `@media print {
    @page { size: ${$('dmPaper').value === 'legal' ? 'legal' : 'A4'} ${best.o}; margin: ${MARGIN_MM}mm; }
    html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; }
    #dmMain { padding: 0 !important; margin: 0 !important; max-width: none !important; width: auto !important; }
    #dmPreview { zoom: ${scale.toFixed(4)}; width: ${Math.ceil(W)}px; break-inside: avoid; page-break-inside: avoid; }
    #dmPreview .bracket, #dmPreview .groups { overflow: visible !important; padding-bottom: 0 !important; }
    #dmPreview .bracket__hint { display: none !important; }
  }`;
  return st;
}
window.addEventListener('beforeprint', () => {
  const old = document.getElementById('dmFitStyle'); if (old) old.remove();
  const st = fitStyle(); if (st) document.head.appendChild(st);
});
window.addEventListener('afterprint', () => { const old = document.getElementById('dmFitStyle'); if (old) old.remove(); });
window.dmFitStyle = fitStyle;

/* Already signed in this session: check again, which also fetches the referee names. */
if (sessionStorage.getItem(PASS_KEY)) signIn(sessionStorage.getItem(PASS_KEY));
