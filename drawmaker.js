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

/* ---------- Reading the entry list ----------
   One player per line: "Name, Club, Seed". Club and seed optional,
   so "Faisal Jamil" and "Faisal Jamil, , 5" both work. */
function parseEntries(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const bits = line.split(',').map(b => b.trim());
      const seed = parseInt(bits[2], 10);
      return {
        name: bits[0],
        club: bits[1] || '',
        seed: Number.isFinite(seed) && seed >= 1 ? seed : undefined
      };
    })
    .filter(e => e.name);
}

function say(msg, kind) {
  const el = $('dmState');
  el.textContent = msg || '';
  el.className = 'pad__publish-state' + (kind ? ' pad__publish-state--' + kind : '');
}

function updateCount() {
  const entries = parseEntries($('dmEntries').value);
  const seeds = entries.filter(e => e.seed).length;
  if (!entries.length) { $('dmCount').textContent = 'No entries yet.'; return; }

  if ($('dmFormat').value === 'groups') {
    const g = Number($('dmGroups').value);
    const per = Math.floor(entries.length / g);
    const odd = entries.length % g;
    $('dmCount').textContent =
      `${entries.length} entries, ${seeds} seeded — ${g} groups of ` +
      (odd ? `${per} or ${per + 1}` : per);
  } else {
    const chosen = $('dmSize').value;
    const size = chosen === 'auto' ? DrawLogic.drawSizeFor(entries.length) : Number(chosen);
    const byes = size - entries.length;
    $('dmCount').textContent =
      `${entries.length} entries, ${seeds} seeded — ${size}-player draw` +
      (byes > 0 ? `, ${byes} bye${byes === 1 ? '' : 's'}` : '') +
      (byes < 0 ? ' — too many for this size' : '');
  }
}

/* ---------- Making the draw ---------- */
function generate() {
  const entries = parseEntries($('dmEntries').value);
  if (entries.length < 2) { say('Add at least two players.', 'bad'); return; }

  const tournament = tName();
  const tournamentId = $('dmTournament').value;
  const event = $('dmEvent').value.trim();
  if (!tournamentId) { say('Choose the tournament first.', 'bad'); return; }
  if (!event) { say('Type the division, for example Boys Under 13.', 'bad'); return; }

  try {
    if ($('dmFormat').value === 'groups') {
      current = DrawLogic.buildGroups(entries, Number($('dmGroups').value));
    } else {
      const chosen = $('dmSize').value;
      current = DrawLogic.buildKnockout(entries, {
        size: chosen === 'auto' ? undefined : Number(chosen)
      });
    }
  } catch (err) {
    say(err.message, 'bad');
    return;
  }

  current.tournament = tournament;
  current.tournamentId = tournamentId;
  current.event = event;
  current.made = Date.now();
  current.madeBy = sessionStorage.getItem(NAME_KEY) || '';

  DrawView.render($('dmPreview'), current);
  ['dmRedraw', 'dmPublish', 'dmPrint'].forEach(id => { $(id).hidden = false; });

  sched = {
    drawId: String(current.made),
    tournamentId, tournament, event, logo,
    matches: DrawLogic.matchesFromDraw(current)
  };
  renderMatches();
  say('Draw made. Set courts, times and referees below, then publish.', 'good');
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
  sched.event = $('dmEvent').value.trim() || sched.event;
  sched.logo = logo;
  if (!sched.tournamentId || !sched.event) throw new Error('Choose the tournament and type the division first.');
  const saved = await post('/api/schedule?id=' + encodeURIComponent(sidOf(sched.tournamentId, sched.event)), sched);
  sched = saved;                 // keeps any result a referee just reported
  renderMatches();
}

/* ---------- Publishing ---------- */
async function publish() {
  if (!current) return;
  say('Publishing…');
  try {
    sched.tournamentId = current.tournamentId;
    sched.event = current.event;
    await post('/api/draw?id=' + encodeURIComponent(sidOf(current.tournamentId, current.event)), current);
    await saveSchedule();
    say('Published. The draw and the matches are live on the site.', 'good');
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
    if (sched) sched.logo = logo;
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

/* Fill the tournament list, and the "open a published draw" list for the
   tournament chosen. */
async function loadTournaments() {
  try {
    const res = await fetch('content/tournaments.json');
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
  open.innerHTML = '<option value="">— none —</option>' +
    publishedHere.map((s, i) => `<option value="${i}">${stamp(s.event || 'Draw')}</option>`).join('');
}

function openPublished(i) {
  const s = publishedHere[Number(i)];
  if (!s) return;
  sched = s;
  current = null;
  logo = s.logo || '';
  $('dmEvent').value = s.event || '';
  $('dmLogoPreview').src = logo; $('dmLogoPreview').hidden = !logo;
  ['dmRedraw', 'dmPublish', 'dmPrint'].forEach(id => { $(id).hidden = true; });
  $('dmPreview').innerHTML = '';
  renderMatches();
  say('Opened the published draw. Change courts, times and referees below.', 'good');
}

$('dmTournament').addEventListener('change', loadPublished);
$('dmOpen').addEventListener('change', e => openPublished(e.target.value));

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
  updateCount();
  loadTournaments().then(loadPublished);
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
  $('dmSizeField').hidden = groups;
  updateCount();
});

['dmEntries', 'dmSize', 'dmGroups'].forEach(id =>
  $(id).addEventListener('input', updateCount));
$('dmGroups').addEventListener('change', updateCount);
$('dmSize').addEventListener('change', updateCount);

$('dmGenerate').addEventListener('click', generate);
$('dmRedraw').addEventListener('click', generate);   // a fresh random draw
$('dmPublish').addEventListener('click', publish);
$('dmPrint').addEventListener('click', () => window.print());

/* Already signed in this session: check again, which also fetches the referee names. */
if (sessionStorage.getItem(PASS_KEY)) signIn(sessionStorage.getItem(PASS_KEY));
