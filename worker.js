/* ============================================================
   worker.js — the small server behind naveedrehman.com

   Everything on this site is a plain file except these addresses:

     /api/draw             draws, one per tournament event (?id= / ?tournament=)
     /api/live             every match running right now
     /api/live?court=1     one court
     /api/schedule         matches of each draw: court, time, referee
     /api/result           a referee reports a match live / finished
     /api/feedback         anyone sends feedback; only the organiser reads it
     /api/verify           checks the referee password, changes nothing

   Reading is open to anyone. Writing needs the admin password in
   an x-admin-password header.

   Anything else is handed straight back to the static files, so
   the rest of the site is untouched.

   Needs, set in the Cloudflare dashboard:
     DRAW_KV              a KV namespace (storage)
     DRAW_ADMIN_PASSWORD  a secret — the master password
     REFEREE_LOGINS       a secret — one password per referee, as JSON:
                          {"Asif Khan":"swift-court-41","Sana Malik":"blue-rally-07"}
                          Optional. Without it, only the master password works.

   The referee's name is stamped onto the match here, on the server,
   so a scoresheet always says who actually refereed it.
   ============================================================ */

const DRAW_PREFIX = "draw:";
const SCHED_PREFIX = "schedule:";
const FEEDBACK_PREFIX = "feedback:";
const LIVE_PREFIX = "live:";

/* A match disappears on its own an hour after the last update, so a
   referee who walks off without stopping does not leave a ghost up. */
const LIVE_TTL_SECONDS = 3600;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
};

const json = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors,
      ...extra,
    },
  });

const fail = (msg, status) => json(JSON.stringify({ error: msg }), status);

/* Court names come from a text box, so keep them to something safe
   and short before they become part of a storage key. */
function cleanCourt(raw) {
  const c = String(raw || "").trim().replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 24);
  return c || null;
}

/* Draw and schedule ids look like "sindh-junior-2026__boys-u13". Anything
   unsafe is dropped before it becomes part of a storage key. */
function cleanId(raw) {
  const id = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
  return id || null;
}

/* Every stored document under a prefix, optionally for one tournament
   (ids start with the tournament id and "__"). */
async function listDocs(env, prefix, tournament) {
  const p = prefix + (tournament ? tournament + "__" : "");
  const list = await env.DRAW_KV.list({ prefix: p, limit: 200 });
  const out = [];
  for (const k of list.keys) {
    const raw = await env.DRAW_KV.get(k.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* skip */ }
  }
  return out;
}

/* The referee list can be written either way:

     Naveed Rehman: karachi-court-11
     Asif Khan: swift-rally-07

   or as JSON:

     {"Naveed Rehman":"karachi-court-11"}

   The plain lines are easier to type without a mistake, so they are
   tried as well. A list that cannot be read at all admits nobody. */
function parseLogins(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};

  if (text.startsWith("{")) {
    try { return JSON.parse(text); } catch { return null; }
  }

  const people = {};
  for (const line of text.split(/[\n;]/)) {
    const t = line.trim();
    if (!t) continue;
    const at = t.search(/[:=]/);
    if (at < 1) continue;
    const name = t.slice(0, at).trim().replace(/^["']|["']$/g, "");
    const pass = t.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    if (name && pass) people[name] = pass;
  }
  return people;
}

/* Who is this? Returns a name, or null if the password matches nobody. */
function whoIs(request, env) {
  const given = request.headers.get("x-admin-password") || "";
  if (!given) return null;

  if (env.DRAW_ADMIN_PASSWORD && given === env.DRAW_ADMIN_PASSWORD) {
    return "Admin";
  }

  const people = parseLogins(env.REFEREE_LOGINS);
  if (!people) return null;           // unreadable list: let nobody in

  for (const [name, password] of Object.entries(people)) {
    if (typeof password === "string" && password && given === password) return name;
  }

  return null;
}

/* Returns a refusal Response, or null when the caller is allowed through. */
function needsPassword(request, env) {
  if (!env.DRAW_ADMIN_PASSWORD && !env.REFEREE_LOGINS) {
    return fail("No passwords are set up yet.", 503);
  }
  if (!whoIs(request, env)) return fail("Wrong password.", 401);
  return null;
}

/* Only the master password may build draws and assign matches. */
function needsAdmin(request, env) {
  return whoIs(request, env) === "Admin" ? null : fail("Organiser password needed.", 403);
}

/* ---------- Draws: one document per tournament event ----------
   GET  /api/draw?id=<id>            one draw
   GET  /api/draw?tournament=<tid>   {draws:[...]} for that tournament
   GET  /api/draw                    {draws:[...]} everything
   POST /api/draw?id=<id>            organiser only                    */
async function drawRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  const q = new URL(request.url).searchParams;
  const id = cleanId(q.get("id"));

  if (request.method === "GET") {
    if (id) return json((await env.DRAW_KV.get(DRAW_PREFIX + id)) || "null");
    const draws = await listDocs(env, DRAW_PREFIX, cleanId(q.get("tournament")));
    return json(JSON.stringify({ draws }));
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    if (!id) return fail("No draw id given.", 400);
    let doc;
    try { doc = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    doc.id = id;
    await env.DRAW_KV.put(DRAW_PREFIX + id, JSON.stringify(doc));
    return json(JSON.stringify({ ok: true, id }));
  }

  return fail("Method not allowed.", 405);
}

/* ---------- Live matches: one entry per court ---------- */
async function liveRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  const court = cleanCourt(new URL(request.url).searchParams.get("court"));

  /* Every running match on a court (or on all courts). Two referees can
     use the same court label, so each match has its own key:
     live:<court>  or  live:<court>~<match>. */
  async function readAll(onlyCourt) {
    const list = await env.DRAW_KV.list({ prefix: LIVE_PREFIX });
    const out = [];
    for (const k of list.keys) {
      const key = k.name.slice(LIVE_PREFIX.length);
      const c = key.split("~")[0];
      if (onlyCourt && c !== onlyCourt) continue;
      const raw = await env.DRAW_KV.get(k.name);
      if (!raw) continue;
      try {
        const m = JSON.parse(raw);
        m.court = c;
        m.key = key;
        out.push(m);
      } catch { /* skip anything unreadable */ }
    }
    return out;
  }

  if (request.method === "GET") {
    if (court) {
      const all = await readAll(court);
      all.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (b.updated || 0) - (a.updated || 0));
      return json(JSON.stringify(all[0] || null));
    }
    const matches = await readAll(null);
    matches.sort((a, b) =>
      String(a.court).localeCompare(String(b.court), undefined, { numeric: true }) ||
      (a.updated || 0) - (b.updated || 0));
    return json(JSON.stringify({ matches }));
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env);
    if (denied) return denied;
    if (!court) return fail("No court given.", 400);

    let match;
    try { match = JSON.parse(await request.text()); }
    catch { return fail("Invalid JSON.", 400); }

    /* The name comes from the password, not from the page, so nobody
       can publish a match under someone else's name. */
    match.referee = whoIs(request, env);

    const mid = String(match.match_id ? (match.sched_id || "") + "-" + match.match_id : (match.pad_id || "")).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
    const key = court + (mid ? "~" + mid : "");

    /* A finished match left on this court, or an earlier match from the
       same pad, makes way for the new one. */
    for (const m of await readAll(null)) {
      if (m.key === key) continue;
      const samePad = match.pad_id && m.pad_id === match.pad_id;
      const sameMatch = match.match_id && m.match_id === match.match_id && m.sched_id === match.sched_id;
      if (samePad || sameMatch || (!match.done && m.court === court && m.done)) {
        await env.DRAW_KV.delete(LIVE_PREFIX + m.key);
      }
    }

    await env.DRAW_KV.put(LIVE_PREFIX + key, JSON.stringify(match), {
      expirationTtl: LIVE_TTL_SECONDS,
    });
    return json(JSON.stringify({ ok: true, court, referee: match.referee }));
  }

  return fail("Method not allowed.", 405);
}


/* ============================================================
   SCHEDULE — the matches of a tournament, made from the draw.

   {drawId, tournament, event, logo, matches:[
     {id, round, p1:{name,club}|null, p2, court, time, referee,
      status:'scheduled'|'live'|'done'|'bye', winner:0|1|'', score:'',
      ref:{ri,mi} (knockout) or {g,n} (group)} ]}

   The organiser sets court, time and referee. Referees report
   when a match goes live and when it finishes; the winner is
   moved into the next round here, and the draw is kept in step.
   ============================================================ */
async function readJSON(env, key) {
  const raw = await env.DRAW_KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function scheduleRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  const q = new URL(request.url).searchParams;
  const id = cleanId(q.get("id"));

  if (request.method === "GET") {
    if (id) return json((await env.DRAW_KV.get(SCHED_PREFIX + id)) || "null");
    const schedules = await listDocs(env, SCHED_PREFIX, cleanId(q.get("tournament")));
    return json(JSON.stringify({ schedules }));
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    if (!id) return fail("No schedule id given.", 400);

    let body;
    try { body = JSON.parse(await request.text()); }
    catch { return fail("Invalid JSON.", 400); }
    if (!body || !Array.isArray(body.matches)) return fail("No matches given.", 400);

    const old = await readJSON(env, SCHED_PREFIX + id);
    let out = body;

    /* Same draw: take only the organiser's fields, so a result a referee
       reported a moment ago is never overwritten by a stale page. */
    if (old && old.drawId && old.drawId === body.drawId) {
      const byId = new Map(body.matches.map(m => [m.id, m]));
      for (const m of old.matches) {
        const n = byId.get(m.id);
        if (!n) continue;
        m.court = String(n.court || "").slice(0, 24);
        m.time = String(n.time || "").slice(0, 32);
        m.referee = String(n.referee || "").slice(0, 60);
      }
      old.tournament = body.tournament;
      old.tournamentId = body.tournamentId;
      old.event = body.event;
      old.logo = body.logo;
      out = old;
    }
    out.id = id;
    out.updated = Date.now();
    await env.DRAW_KV.put(SCHED_PREFIX + id, JSON.stringify(out));
    return json(JSON.stringify(out));
  }

  /* Organiser removes a schedule together with its draw (clearing out old tournaments). */
  if (request.method === "DELETE") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    if (!id) return fail("No schedule id given.", 400);
    await env.DRAW_KV.delete(SCHED_PREFIX + id);
    await env.DRAW_KV.delete(DRAW_PREFIX + id);
    return json(JSON.stringify({ ok: true }));
  }

  return fail("Method not allowed.", 405);
}

/* A referee reports: this match is live / this match is finished. */
async function resultRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  const denied = needsPassword(request, env);
  if (denied) return denied;
  const who = whoIs(request, env);

  let r;
  try { r = JSON.parse(await request.text()); }
  catch { return fail("Invalid JSON.", 400); }

  const sid = cleanId(r.sid);
  const sched = sid && await readJSON(env, SCHED_PREFIX + sid);
  if (!sched) return fail("No schedule is published.", 404);
  const m = sched.matches.find(x => x.id === r.id);
  if (!m) return fail("No such match.", 404);

  if (who !== "Admin" && m.referee && m.referee !== who) {
    return fail("This match is assigned to " + m.referee + ".", 403);
  }

  if (r.status === "live") {
    if (m.status !== "done") m.status = "live";
    if (Number(r.started) > 0 && !m.started) m.started = Number(r.started);
  } else if (r.status === "done" && (r.winner === 0 || r.winner === 1)) {
    m.status = "done";
    m.winner = r.winner;
    m.score = String(r.score || "").slice(0, 80);
    m.finished = Date.now();
    const st = Number(r.started) || m.started || 0, en = Number(r.ended) || m.finished;
    if (st > 0 && en > st && en - st < 12 * 3600 * 1000) { m.started = st; m.duration = en - st; }
    const draw = await readJSON(env, DRAW_PREFIX + sid);
    advance(sched, m, draw);
    if (draw) await env.DRAW_KV.put(DRAW_PREFIX + sid, JSON.stringify(draw));
  } else {
    return fail("Nothing to record.", 400);
  }

  sched.updated = Date.now();
  await env.DRAW_KV.put(SCHED_PREFIX + sid, JSON.stringify(sched));
  return json(JSON.stringify({ ok: true }));
}

/* Put the winner into the next round, and mirror it onto the draw. */
function advance(sched, m, draw) {
  const sameDraw = draw && draw.made && String(draw.made) === String(sched.drawId);

  if (m.ref && m.ref.g !== undefined) {                 // group match
    if (sameDraw) {
      const dm = draw.groups?.[m.ref.g]?.matches?.[m.ref.n];
      if (dm) {
        dm.score = m.score;
        dm.winner = m.winner === 0 ? "1" : "2";
        dm.status = "Final";
      }
    }
    return;
  }
  if (!m.ref) return;

  const { ri, mi } = m.ref;
  const winner = m.winner === 0 ? m.p1 : m.p2;

  if (sameDraw) {
    const dm = draw.rounds?.[ri]?.matches?.[mi];
    if (dm) {
      dm.score = m.score;
      dm.winner = m.winner === 0 ? "1" : "2";
      dm.status = "Final";
    }
  }

  const next = sched.matches.find(x => x.ref && x.ref.ri === ri + 1 && x.ref.mi === Math.floor(mi / 2));
  if (!next) return;
  const slot = mi % 2 === 0 ? "p1" : "p2";
  next[slot] = winner ? { name: winner.name, club: winner.club || "", country: winner.country || "" } : null;
  if (sameDraw) {
    const nd = draw.rounds?.[ri + 1]?.matches?.[Math.floor(mi / 2)];
    if (nd) nd[mi % 2 === 0 ? "p1" : "p2"] = winner ? winner.name : "";
  }
}

/* ---------- Feedback: anyone may send, only the organiser may read ---------- */

/* ---------- Entries: the players entered in a tournament ----------
   GET  /api/entries?tournament=<tid>   public, {entries:[...]}
   POST /api/entries                     organiser only, {tournament, entries:[...]} replaces the list */
const ENTRIES_PREFIX = "entries:";
async function entriesRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
  const q = new URL(request.url).searchParams;

  if (request.method === "GET") {
    const tid = cleanId(q.get("tournament"));
    if (!tid) return fail("Which tournament?", 400);
    const raw = await env.DRAW_KV.get(ENTRIES_PREFIX + tid);
    return json(JSON.stringify({ entries: raw ? (JSON.parse(raw).entries || []) : [] }));
  }

  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    let b;
    try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    const tid = cleanId(b.tournament);
    if (!tid || !Array.isArray(b.entries)) return fail("Tournament and entries are needed.", 400);
    const s = (v, n) => String(v || "").trim().slice(0, n);
    const entries = b.entries.slice(0, 600).map(e => {
      const rank = parseInt(e.rank, 10);
      return {
        id: s(e.id, 30) || Math.random().toString(36).slice(2, 10),
        name: s(e.name, 80),
        club: s(e.club, 80),
        country: s(e.country, 40),
        division: s(e.division, 40),
        rank: Number.isFinite(rank) && rank > 0 ? rank : null,
        attendance: e.attendance === "P" || e.attendance === "A" ? e.attendance : "",
        wc: !!e.wc,
      };
    }).filter(e => e.name);
    await env.DRAW_KV.put(ENTRIES_PREFIX + tid, JSON.stringify({ entries, updated: Date.now() }));
    return json(JSON.stringify({ ok: true, entries }));
  }
  return fail("Method not allowed.", 405);
}

/* ---------- Career results added from the site ----------
   GET  /api/results            public, {items:[...]}
   POST /api/results            organiser only, {items:[...]} replaces the list */
async function resultsRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);

  if (request.method === "GET") {
    const raw = await env.DRAW_KV.get("career:results");
    return json(JSON.stringify({ items: raw ? (JSON.parse(raw).items || []) : [] }));
  }
  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    let b;
    try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    if (!Array.isArray(b.items)) return fail("No items given.", 400);
    const s = (v, n) => String(v || "").trim().slice(0, n);
    const items = b.items.slice(0, 1000).map(r => ({
      id: s(r.id, 30) || Math.random().toString(36).slice(2, 10),
      year: s(r.year, 4),
      tournament: s(r.tournament, 140),
      dates: s(r.dates, 40),
      category: s(r.category, 40),
      venue: s(r.venue, 100),
      result: s(r.result, 80),
      win: !!r.win,
      replaces: s(r.replaces, 200),
      hidden: !!r.hidden,
      notes: s(r.notes, 3000),
      links: (Array.isArray(r.links) ? r.links : []).slice(0, 12).map(l => ({ label: s(l.label, 80), url: s(l.url, 400) })).filter(l => /^https?:\/\//i.test(l.url)),
      photos: (Array.isArray(r.photos) ? r.photos : []).slice(0, 24).map(p => s(p, 200)).filter(p => /^(\/api\/respic\?id=[a-z0-9]+|https?:\/\/)/i.test(p)),
    })).filter(r => r.tournament);
    await env.DRAW_KV.put("career:results", JSON.stringify({ items, updated: Date.now() }));
    return json(JSON.stringify({ ok: true, items }));
  }
  return fail("Method not allowed.", 405);
}

/* Tournament photos: POST {data:"data:image/jpeg;base64,..."} (organiser) -> {url}; GET ?id= */
async function respicRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
  if (request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id") || "";
    const raw = /^[a-z0-9]{6,20}$/.test(id) ? await env.DRAW_KV.get("respic:" + id) : null;
    if (!raw) return new Response("Not found", { status: 404 });
    const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return new Response("Not found", { status: 404 });
    const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    return new Response(bin, { headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable" } });
  }
  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    let b;
    try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    const data = String(b.data || "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) return fail("Not an image.", 400);
    if (data.length > 2200000) return fail("Photo is too large.", 413);
    const id = Math.random().toString(36).slice(2, 12);
    await env.DRAW_KV.put("respic:" + id, data);
    return json(JSON.stringify({ ok: true, url: "/api/respic?id=" + id }));
  }
  return fail("Method not allowed.", 405);
}

/* ---------- Rankings imported from a file or Google Sheet ----------
   GET  /api/rankings   public, {players:[{category,rank,name,club,points}]}
   POST /api/rankings   organiser only, {players:[...]} replaces the imported list
   POST /api/sheet      organiser only, {url} -> the Google Sheet (shared "anyone with the link") as CSV text */
async function rankingsRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
  if (request.method === "GET") {
    const raw = await env.DRAW_KV.get("rankings:imported");
    const d = raw ? JSON.parse(raw) : {};
    return json(JSON.stringify({ players: d.players || [], manualCats: d.manualCats || [], hideFile: !!d.hideFile }));
  }
  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    let b;
    try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    if (!Array.isArray(b.players)) return fail("No players given.", 400);
    const s = (v, n) => String(v ?? "").trim().slice(0, n);
    const players = b.players.slice(0, 3000).map(p => ({
      category: s(p.category, 40), rank: s(p.rank, 6), name: s(p.name, 100), club: s(p.club, 100), points: s(p.points, 12),
    })).filter(p => p.category && p.name);
    /* categories edited by hand keep winning over the ones worked out from results */
    const oldRaw = await env.DRAW_KV.get("rankings:imported");
    const oldCats = oldRaw ? (JSON.parse(oldRaw).manualCats || []) : [];
    const manualCats = (Array.isArray(b.manualCats) ? b.manualCats : oldCats).map(c => s(c, 40)).filter(Boolean).slice(0, 100);
    const hideFile = typeof b.hideFile === "boolean" ? b.hideFile : (oldRaw ? !!JSON.parse(oldRaw).hideFile : false);
    await env.DRAW_KV.put("rankings:imported", JSON.stringify({ players, manualCats, hideFile, updated: Date.now() }));
    return json(JSON.stringify({ ok: true, count: players.length }));
  }
  return fail("Method not allowed.", 405);
}


/* ---------- Ranking points: finishing positions of each event, plus the points
   settings. The rankings page works the tables out from this.
   GET  /api/rankpoints   public
   POST /api/rankpoints   organiser, {config, tlevels, events} ---------- */
async function rankpointsRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
  if (request.method === "GET") {
    return json((await env.DRAW_KV.get("rankings:points")) || "{}");
  }
  if (request.method === "POST") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    const text = await request.text();
    if (text.length > 1500000) return fail("Too much data.", 413);
    let b;
    try { b = JSON.parse(text); } catch { return fail("Invalid JSON.", 400); }
    if (!b || !Array.isArray(b.events)) return fail("No events given.", 400);
    b.updated = Date.now();
    await env.DRAW_KV.put("rankings:points", JSON.stringify(b));
    return json(JSON.stringify({ ok: true, events: b.events.length }));
  }
  return fail("Method not allowed.", 405);
}

/* ---------- Scoresheets: finished matches, kept on the server so the organiser
   can open them from any device.
   POST   /api/scoresheets        any signed-in referee, the full record
   GET    /api/scoresheets        organiser, the list (summaries)
   GET    /api/scoresheets?id=x   organiser, one full record
   DELETE /api/scoresheets?id=x   organiser ---------- */
async function scoresheetsRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
  const url = new URL(request.url);
  const cid = s => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);

  if (request.method === "POST") {
    const denied = needsPassword(request, env);
    if (denied) return denied;
    const text = await request.text();
    if (text.length > 600000) return fail("That scoresheet is too large.", 413);
    let r;
    try { r = JSON.parse(text); } catch { return fail("Invalid JSON.", 400); }
    const id = cid(r.id);
    if (!id) return fail("No id.", 400);
    const p = r.players || [];
    const meta = {
      id,
      a: String((p[0] && p[0].name) || "").slice(0, 60), b: String((p[1] && p[1].name) || "").slice(0, 60),
      t: String(r.tournament || "").slice(0, 80), r: String(r.round || "").slice(0, 60),
      gw: (r.games_won || [0, 0]).slice(0, 2), f: Number(r.finished) || 0,
      ref: String(r.referee || "").slice(0, 40),
    };
    await env.DRAW_KV.put("sheet:" + id, text, { metadata: meta });
    return json(JSON.stringify({ ok: true, id }));
  }

  const denied = needsPassword(request, env) || needsAdmin(request, env);
  if (denied) return denied;

  if (request.method === "GET") {
    const id = cid(url.searchParams.get("id"));
    if (id) {
      const raw = await env.DRAW_KV.get("sheet:" + id);
      return raw ? json(raw) : fail("Not found.", 404);
    }
    const out = [];
    let cursor;
    do {
      const l = await env.DRAW_KV.list({ prefix: "sheet:", cursor });
      for (const k of l.keys) if (k.metadata) out.push(k.metadata);
      cursor = l.list_complete ? undefined : l.cursor;
    } while (cursor && out.length < 2000);
    out.sort((a, b) => (b.f || 0) - (a.f || 0));
    return json(JSON.stringify({ sheets: out }));
  }

  if (request.method === "DELETE") {
    const id = cid(url.searchParams.get("id"));
    if (!id) return fail("No id.", 400);
    await env.DRAW_KV.delete("sheet:" + id);
    return json(JSON.stringify({ ok: true }));
  }
  return fail("Method not allowed.", 405);
}

async function sheetRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  const denied = needsPassword(request, env) || needsAdmin(request, env);
  if (denied) return denied;
  let b;
  try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
  const m = String(b.url || "").match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) return fail("That is not a Google Sheets link.", 400);
  const gid = (String(b.url).match(/[#&?]gid=(\d+)/) || [])[1];
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? "&gid=" + gid : ""}`, { redirect: "follow" });
  const text = await res.text();
  if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) return fail("Could not read the sheet. Share it as \"Anyone with the link can view\".", 400);
  return json(JSON.stringify({ csv: text.slice(0, 2000000) }));
}

/* ---------- Tournaments: the site's file, plus what the organiser changed on the page ----------
   GET  /api/tournaments        public, the merged list {tournaments:[...]}
   GET  /api/tournaments?raw=1  {items:[...], hidden:[ids]}  (what is stored here)
   POST /api/tournaments        organiser only, {items, hidden} replaces what is stored here
   An item with the id of a tournament in the file replaces it; a hidden id removes it. */
async function tournamentsRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const stored = async () => {
    if (!env.DRAW_KV) return { items: [], hidden: [] };
    const raw = await env.DRAW_KV.get("tournaments:edits");
    const d = raw ? JSON.parse(raw) : {};
    return { items: d.items || [], hidden: d.hidden || [] };
  };
  if (request.method === "GET") {
    const st = await stored();
    if (new URL(request.url).searchParams.get("raw")) return json(JSON.stringify(st));
    let file = [];
    try {
      const res = await env.ASSETS.fetch(new Request(new URL("/content/tournaments.json", request.url)));
      if (res.ok) file = (await res.json()).tournaments || [];
    } catch { /* the stored ones alone */ }
    const over = new Map(st.items.map(t => [t.id, t]));
    const merged = file.filter(t => !st.hidden.includes(t.id)).map(t => over.get(t.id) || t);
    const fileIds = new Set(file.map(t => t.id));
    st.items.forEach(t => { if (!fileIds.has(t.id) && !st.hidden.includes(t.id)) merged.push(t); });
    return json(JSON.stringify({ tournaments: merged }));
  }
  if (request.method === "POST") {
    if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    let b;
    try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    if (!Array.isArray(b.items)) return fail("No tournaments given.", 400);
    const s = (v, n) => String(v ?? "").trim().slice(0, n);
    const items = b.items.slice(0, 200).map(t => ({
      id: cleanId(t.id), name: s(t.name, 160), location: s(t.location, 100), venue: s(t.venue, 140), venue_address: s(t.venue_address, 300),
      start: s(t.start, 10), end: s(t.end, 10), status: s(t.status, 20) || "auto", prize_money: s(t.prize_money, 60), level: s(t.level, 60),
      organiser: s(t.organiser, 200), promoters: s(t.promoters, 200), contact: s(t.contact, 120),
      entry_deadline: s(t.entry_deadline, 16), withdrawal_deadline: s(t.withdrawal_deadline, 16),
      description: s(t.description, 5000), how_to_enter: s(t.how_to_enter, 3000),
      divisions: (Array.isArray(t.divisions) ? t.divisions : []).slice(0, 30).map(d => s(d, 60)).filter(Boolean),
      referees: (Array.isArray(t.referees) ? t.referees : []).slice(0, 60).map(r => ({ name: s(r.name, 80), role: s(r.role, 60) })).filter(r => r.name),
      entries: (Array.isArray(t.entries) ? t.entries : []).slice(0, 500).map(e => ({ name: s(e.name, 100), club: s(e.club, 100), country: s(e.country, 60), division: s(e.division, 60), rank: s(e.rank, 6), seed: s(e.seed, 6) })).filter(e => e.name),
      logo: /^(\/api\/respic\?id=[a-z0-9]+|https?:\/\/|images\/|\/images\/)/i.test(s(t.logo, 300)) ? s(t.logo, 300) : "",
    })).filter(t => t.id && t.name);
    const hidden = (Array.isArray(b.hidden) ? b.hidden : []).slice(0, 200).map(cleanId).filter(Boolean);
    await env.DRAW_KV.put("tournaments:edits", JSON.stringify({ items, hidden, updated: Date.now() }));
    return json(JSON.stringify({ ok: true, items, hidden }));
  }
  return fail("Method not allowed.", 405);
}

async function feedbackRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.DRAW_KV) return fail("Storage is not connected yet.", 503);
  const q = new URL(request.url).searchParams;

  if (request.method === "POST") {
    let b;
    try { b = JSON.parse(await request.text()); } catch { return fail("Invalid JSON.", 400); }
    if (b.website) return json(JSON.stringify({ ok: true }));      // a bot filled the hidden field
    const tid = cleanId(b.tournament);
    const message = String(b.message || "").trim().slice(0, 2000);
    if (!tid || message.length < 3) return fail("Please write a message.", 400);
    const entry = {
      tournament: tid,
      name: String(b.name || "").trim().slice(0, 80),
      contact: String(b.contact || "").trim().slice(0, 120),
      kind: String(b.kind || "").trim().slice(0, 30),
      message,
      at: Date.now(),
    };
    const key = FEEDBACK_PREFIX + tid + ":" + String(entry.at).padStart(14, "0") + Math.random().toString(36).slice(2, 6);
    await env.DRAW_KV.put(key, JSON.stringify(entry));
    return json(JSON.stringify({ ok: true }));
  }

  if (request.method === "GET") {
    const denied = needsPassword(request, env) || needsAdmin(request, env);
    if (denied) return denied;
    const tid = cleanId(q.get("tournament"));
    const list = await env.DRAW_KV.list({ prefix: FEEDBACK_PREFIX + (tid ? tid + ":" : ""), limit: 200 });
    const items = [];
    for (const k of list.keys) {
      const raw = await env.DRAW_KV.get(k.name);
      if (raw) { try { items.push(JSON.parse(raw)); } catch { /* skip */ } }
    }
    items.sort((a, b) => b.at - a.at);
    return json(JSON.stringify({ items }));
  }

  return fail("Method not allowed.", 405);
}

/* ---------- Check a password without changing anything ---------- */
function verifyRoute(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  const denied = needsPassword(request, env);
  if (denied) return denied;
  const name = whoIs(request, env);
  const out = { ok: true, name };
  /* The organiser needs the referee names to assign matches. */
  if (name === "Admin") {
    const people = parseLogins(env.REFEREE_LOGINS) || {};
    out.referees = Object.keys(people);
  }
  return json(JSON.stringify(out));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (path === "/api/verify") return verifyRoute(request, env);
    if (path === "/api/draw")   return drawRoute(request, env);
    if (path === "/api/live")   return liveRoute(request, env);
    if (path === "/api/schedule") return scheduleRoute(request, env);
    if (path === "/api/result") return resultRoute(request, env);
    if (path === "/api/feedback") return feedbackRoute(request, env);
    if (path === "/api/entries") return entriesRoute(request, env);
    if (path === "/api/results") return resultsRoute(request, env);
    if (path === "/api/tournaments") return tournamentsRoute(request, env);
    if (path === "/api/rankings") return rankingsRoute(request, env);
    if (path === "/api/rankpoints") return rankpointsRoute(request, env);
    if (path === "/api/sheet") return sheetRoute(request, env);
    if (path === "/api/scoresheets") return scoresheetsRoute(request, env);
    if (path === "/api/respic") return respicRoute(request, env);

    /* Not an API address — serve the ordinary file for it. */
    return env.ASSETS.fetch(request);
  },
};
