/* ============================================================
   tournaments-admin.js — organiser tools on the Tournaments pages:
   add, edit or delete a tournament without leaving the page.
   Changes are kept on the server and shown with the site's own list.
   ============================================================ */
(function () {
  const PASS = 'nr-pass';
  const e = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CATS = ['Boys Under 9', 'Boys Under 11', 'Boys Under 13', 'Boys Under 15', 'Boys Under 17', 'Boys Under 19', 'Men',
    'Girls Under 9', 'Girls Under 11', 'Girls Under 13', 'Girls Under 15', 'Girls Under 17', 'Girls Under 19', 'Women'];
  const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem(PASS) || '' });
  const A = window.TournamentsAdmin = { on: false };

  async function check() {
    if (!sessionStorage.getItem(PASS)) return false;
    try {
      const r = await fetch('/api/verify', { method: 'POST', headers: headers(), body: '{}' });
      return r.ok && (await r.json()).name === 'Admin';
    } catch { return false; }
  }

  const raw = async () => {
    const r = await fetch('/api/tournaments?raw=1', { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not read the saved tournaments.');
    return r.json();
  };
  async function store(items, hidden) {
    const r = await fetch('/api/tournaments', { method: 'POST', headers: headers(), body: JSON.stringify({ items, hidden }) });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Sign in as organiser first.' : 'Could not save.');
  }

  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const refsToText = a => (a || []).map(r => r.name + (r.role ? ' | ' + r.role : '')).join('\n');
  const textToRefs = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('|'); return i > -1 ? { name: x.slice(0, i).trim(), role: x.slice(i + 1).trim() } : { name: x, role: '' };
  });

  function toDataUrl(file) {
    return new Promise((ok, no) => {
      if (/^image\/(png|jpeg|webp)$/.test(file.type) && file.size < 1500000) {
        const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => no(new Error('Could not read that image.')); fr.readAsDataURL(file); return;
      }
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL('image/png'));
      };
      img.onerror = () => no(new Error('Could not read that image.')); img.src = u;
    });
  }

  function openForm(t, existingIds) {
    document.getElementById('tadForm')?.remove();
    const isNew = !t;
    t = t || { status: 'auto', divisions: [], referees: [] };
    const extra = (t.divisions || []).filter(d => !CATS.includes(d)).join(', ');
    const inp = (name, label, val, attrs = '') => `<label class="pad__field"><span>${label}</span><input class="pad__name" name="${name}" value="${e(val || '')}" ${attrs}></label>`;
    const ov = document.createElement('div');
    ov.id = 'tadForm'; ov.className = 'mm';
    ov.innerHTML = `<form class="mm__card tad" style="width:min(720px,100%)">
      <button type="button" class="mm__x" data-close aria-label="Close">×</button>
      <p class="mm__tour">${isNew ? 'Add a tournament' : 'Edit tournament'}</p>
      <div class="res-admin__grid">
        ${inp('name', 'Tournament name', t.name, 'required')}
        ${inp('location', 'City and country', t.location, 'placeholder="Karachi, Pakistan"')}
        ${inp('venue', 'Venue', t.venue)}
        ${inp('venue_address', 'Venue address or map link', t.venue_address)}
        ${inp('start', 'First day', t.start, 'type="date" required')}
        ${inp('end', 'Last day', t.end, 'type="date"')}
        <label class="pad__field"><span>Status</span><select class="pad__name" name="status">${['auto', 'Scheduled', 'Upcoming', 'In play', 'Completed'].map(s => `<option${s === (t.status || 'auto') ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
        ${inp('level', 'Level', t.level, 'placeholder="National, Provincial…"')}
        ${inp('prize_money', 'Prize money', t.prize_money)}
        ${inp('organiser', 'Organiser', t.organiser)}
        ${inp('promoters', 'Promoter', t.promoters)}
        ${inp('contact', 'Contact email', t.contact)}
        ${inp('entry_deadline', 'Entry deadline', t.entry_deadline, 'type="datetime-local"')}
        ${inp('withdrawal_deadline', 'Withdrawal deadline', t.withdrawal_deadline, 'type="datetime-local"')}
      </div>
      <div class="pad__field"><span>Categories</span>
        <div class="tad__cats">${CATS.map(c => `<label><input type="checkbox" name="cat" value="${e(c)}" ${(t.divisions || []).includes(c) ? 'checked' : ''}> ${e(c)}</label>`).join('')}</div>
        ${inp('extra', 'Other categories (comma separated)', extra)}
      </div>
      <label class="pad__field"><span>About (links are made clickable)</span><textarea class="pad__name" name="description" rows="4">${e(t.description || '')}</textarea></label>
      <label class="pad__field"><span>How to enter</span><textarea class="pad__name" name="how_to_enter" rows="3">${e(t.how_to_enter || '')}</textarea></label>
      <label class="pad__field"><span>Referees, one per line: <i>Name | Role</i></span><textarea class="pad__name" name="referees" rows="3">${e(refsToText(t.referees))}</textarea></label>
      <div class="pad__field"><span>Logo</span>
        <input type="hidden" name="logo" value="${e(t.logo || '')}">
        <div class="tad__logo">${t.logo ? `<img src="${e(t.logo)}" alt="" style="max-height:60px">` : ''}</div>
        <input type="file" accept="image/*" data-logo>
      </div>
      <button class="btn btn--solid" type="submit">${isNew ? 'Add tournament' : 'Save changes'}</button>
      <button class="btn btn--ghost" type="button" data-close>Cancel</button>
      <span class="pad__publish-state" id="tadState"></span>
    </form>`;
    document.body.appendChild(ov);
    const form = ov.querySelector('form');
    ov.addEventListener('click', ev => { if (ev.target === ov || ev.target.closest('[data-close]')) ov.remove(); });
    form.querySelector('[data-logo]').addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      const st = form.querySelector('#tadState'); st.textContent = 'Uploading logo…';
      try {
        const r = await fetch('/api/respic', { method: 'POST', headers: headers(), body: JSON.stringify({ data: await toDataUrl(f) }) });
        if (!r.ok) throw new Error('Logo upload failed.');
        const url = (await r.json()).url;
        form.elements.logo.value = url; form.querySelector('.tad__logo').innerHTML = `<img src="${e(url)}" alt="" style="max-height:60px">`; st.textContent = '';
      } catch (err) { st.textContent = err.message; }
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = form.elements, st = form.querySelector('#tadState');
      const out = {
        ...t,
        name: f.name.value.trim(), location: f.location.value, venue: f.venue.value, venue_address: f.venue_address.value,
        start: f.start.value, end: f.end.value || f.start.value, status: f.status.value, level: f.level.value, prize_money: f.prize_money.value,
        organiser: f.organiser.value, promoters: f.promoters.value, contact: f.contact.value,
        entry_deadline: f.entry_deadline.value, withdrawal_deadline: f.withdrawal_deadline.value,
        description: f.description.value, how_to_enter: f.how_to_enter.value, referees: textToRefs(f.referees.value), logo: f.logo.value,
        divisions: [...form.querySelectorAll('[name=cat]:checked')].map(c => c.value)
          .concat(f.extra.value.split(',').map(x => x.trim()).filter(Boolean)),
      };
      delete out.sample;
      if (isNew) {
        let id = slug(out.name) + (out.start ? '-' + out.start.slice(0, 4) : ''), n = 2, base = id;
        while ((existingIds || []).includes(id)) id = base + '-' + n++;
        out.id = id;
      }
      st.textContent = 'Saving…';
      try {
        const cur = await raw();
        const items = cur.items.filter(x => x.id !== out.id).concat(out);
        await store(items, cur.hidden.filter(h => h !== out.id));
        if (isNew) location.href = 'tournament.html?id=' + encodeURIComponent(out.id); else location.reload();
      } catch (err) { st.textContent = err.message; }
    });
  }

  async function remove(t) {
    if (!confirm('Delete "' + t.name + '"? Its entries, draws and matches stop showing on the site.')) return false;
    const cur = await raw();
    await store(cur.items.filter(x => x.id !== t.id), cur.hidden.concat(t.id));
    return true;
  }

  A.add = ids => openForm(null, ids);
  A.edit = t => openForm(t);
  A.remove = remove;
  A.ready = (async () => {
    A.on = await check();
    if (!A.on && location.search.includes('admin')) {
      const box = document.getElementById('tadmin');
      if (box) {
        box.innerHTML = `<form class="res-admin__box" id="tadLogin"><div class="res-admin__grid"><label class="pad__field"><span>Admin password</span><input class="pad__name" type="password" name="pw" required></label></div><button class="btn btn--solid" type="submit">Sign in</button> <span class="pad__publish-state" id="tadLoginState"></span></form>`;
        box.querySelector('form').addEventListener('submit', async ev => {
          ev.preventDefault();
          sessionStorage.setItem(PASS, new FormData(ev.target).get('pw'));
          if (await check()) location.reload(); else { sessionStorage.removeItem(PASS); document.getElementById('tadLoginState').textContent = 'Wrong password.'; }
        });
      }
    }
    return A.on;
  })();
})();
