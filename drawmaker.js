/* ============================================================
   drawmaker.js — building and publishing a draw

   The arithmetic lives in drawlogic.js and the drawing in
   drawview.js. This file is only the controls.
   ============================================================ */

const PASS_KEY = 'nr-pass';
const NAME_KEY = 'nr-referee';

const $ = id => document.getElementById(id);
let current = null;          // the draw on screen

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

  const tournament = $('dmTournament').value.trim();
  const event = $('dmEvent').value.trim();

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
  current.event = event;
  current.made = Date.now();
  current.madeBy = sessionStorage.getItem(NAME_KEY) || '';

  DrawView.render($('dmPreview'), current);
  ['dmRedraw', 'dmPublish', 'dmPrint'].forEach(id => { $(id).hidden = false; });
  say('Draw made. Check it over, then publish.', 'good');
}

/* ---------- Publishing ---------- */
async function publish() {
  if (!current) return;
  say('Publishing…');
  try {
    const res = await fetch('/api/draw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': sessionStorage.getItem(PASS_KEY) || ''
      },
      body: JSON.stringify(current)
    });
    if (res.status === 401) { say('Your sign-in has expired. Reload and sign in again.', 'bad'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    say('Published. It is now on the public draw page.', 'good');
  } catch (err) {
    say('Could not publish — ' + err.message + '. The draw is still on screen; try again.', 'bad');
  }
}

/* ---------- Login ---------- */
function openMaker() {
  $('dmLogin').hidden = true;
  $('dmMain').hidden = false;
  const name = sessionStorage.getItem(NAME_KEY);
  if (name) { $('dmWho').hidden = false; $('dmWhoName').textContent = name; }
  updateCount();
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

if (sessionStorage.getItem(PASS_KEY)) openMaker();
