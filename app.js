// Prop Tracker v2.10 — single-file static app (no service worker)
(() => {
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const LS_KEY = "propTracker:v210";

  const SPORT_MARKETS = {
    NBA: ["PTS","REB","AST","PRA"],
    NFL: ["PASS_YDS","RUSH_YDS","REC_YDS","TD"],
    MLB: ["H","HR","RBI","SO"],
    NHL: ["SOG","PTS"],
    EPL: ["SHOTS","SOG","GOALS"],
    UFC: ["KOs","SUBS","SIG_STR"]
  };

// ---------------------------
// Odds API (paid) integration
// ---------------------------

const ODDS_SPORT_KEY = {
  NBA: "basketball_nba",
  NFL: "americanfootball_nfl",
  NHL: "icehockey_nhl",
  MLB: "baseball_mlb",
  EPL: "soccer_epl",
  UFC: "mma_mixed_martial_arts"
};

// Odds API player-prop market keys (paid tier on The Odds API).
// If your account uses different keys, you can type a custom market in the UI.
const ODDS_MARKETS = {
  NBA: [
    ["player_points", "Points"],
    ["player_rebounds", "Rebounds"],
    ["player_assists", "Assists"],
    ["player_threes", "3PT Made"],
    ["player_points_rebounds_assists", "PRA"]
  ],
  NFL: [
    ["player_pass_tds", "Pass TDs"],
    ["player_pass_yds", "Pass Yds"],
    ["player_rush_yds", "Rush Yds"],
    ["player_rec_yds", "Rec Yds"],
    ["player_receptions", "Receptions"]
  ],
  NHL: [
    ["player_points", "Points"],
    ["player_goals", "Goals"],
    ["player_assists", "Assists"],
    ["player_shots_on_goal", "Shots"]
  ],
  MLB: [
    ["batter_hits", "Hits"],
    ["batter_home_runs", "HR"],
    ["batter_rbis", "RBI"],
    ["pitcher_strikeouts", "Ks"]
  ],
  EPL: [
    ["player_goals", "Goals"],
    ["player_assists", "Assists"],
    ["player_shots_on_target", "Shots on Target"]
  ],
  UFC: [
    ["fighter_takedowns", "Takedowns"],
    ["fighter_sig_strikes", "Significant Strikes"]
  ]
};

function getDefaultOddsMarket(sport){
  const list = ODDS_MARKETS[sport] || [];
  return list.length ? list[0][0] : "player_points";
}

function buildOddsMarketOptions(sport, selected){
  const list = ODDS_MARKETS[sport] || [];
  const sel = selected || getDefaultOddsMarket(sport);
  if(!list.length){
    return `<option value="${sel}" selected>${sel}</option>`;
  }
  return list.map(([k,label]) => `<option value="${k}" ${k===sel?"selected":""}>${label}</option>`).join("");
}

async function fetchOddsPropsViaProxy({ sport, market, regions="us", bookmakers="", dateFormat="iso", oddsFormat="american" }){
  if(!state.oddsProxyUrl) throw new Error("Odds proxy not set. Go to Profile and paste your proxy URL.");
  const base = state.oddsProxyUrl.replace(/\/+$/,"");
  // Uses the Worker /props endpoint which aggregates per-event odds (required for player props on The Odds API).
  const url = `${base}/props?sport=${encodeURIComponent(sport)}&market=${encodeURIComponent(market)}&regions=${encodeURIComponent(regions)}&bookmakers=${encodeURIComponent(bookmakers)}&oddsFormat=${encodeURIComponent(oddsFormat)}&dateFormat=${encodeURIComponent(dateFormat)}`;
  const res = await fetch(url, { headers:{ "accept":"application/json" }});
  const json = await res.json().catch(()=>null);
  if(!res.ok){
    const msg = json ? JSON.stringify(json) : `HTTP ${res.status}`;
    throw new Error(`Odds proxy error (${res.status}). ${msg}`);
  }
  if(json && typeof json === "object" && "body" in json) return json.body;
  return json;
}


function pickBookmaker(bookmakers, preferredKey){
  if(!bookmakers || !bookmakers.length) return null;
  if(preferredKey){
    const m = bookmakers.find(b => b.key === preferredKey);
    if(m) return m;
  }
  return bookmakers[0];
}

function renderOddsPropsList(data, preferredBook){
  if(!Array.isArray(data) || !data.length){
    return `<div class="muted">No odds returned. (Either no games today, or this market isn’t available on your Odds API plan.)</div>`;
  }
  return data.map(ev => {
    const when = ev.commence_time ? new Date(ev.commence_time).toLocaleString() : "";
    const bm = pickBookmaker(ev.bookmakers, preferredBook);
    const market = bm?.markets?.[0];
    const outcomes = market?.outcomes || [];
    const rows = outcomes.slice(0, 120).map(o => {
      const side = o.name || "";
      const player = o.description || "";
      const line = (o.point ?? "");
      const price = (o.price ?? "");
      return `<tr><td>${esc(player)}</td><td>${esc(side)}</td><td>${esc(String(line))}</td><td>${esc(String(price))}</td></tr>`;
    }).join("");
    const bmName = bm ? (bm.title || bm.key) : "—";
    return `
      <details class="card" style="margin-top:10px;">
        <summary style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div>
            <div style="font-weight:700;">${esc(ev.away_team || "")} @ ${esc(ev.home_team || "")}</div>
            <div class="muted">${esc(when)} • ${esc(bmName)}</div>
          </div>
          <div class="pill">${esc((market?.key || "").toUpperCase())}</div>
        </summary>
        <div style="overflow:auto; padding-top:10px;">
          <table class="table">
            <thead><tr><th>Player</th><th>Side</th><th>Line</th><th>Price</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4" class="muted">No outcomes found for this market/book.</td></tr>`}</tbody>
          </table>
        </div>
      </details>
    `;
  }).join("");
}

// ---------------------------
// Odds API game-odds (h2h/totals/spreads)
// ---------------------------
async function fetchOddsGamesViaProxy({ sport, markets="h2h,totals,spreads", regions="us", bookmakers="", dateFormat="iso", oddsFormat="american" }){
  if(!state.oddsProxyUrl) throw new Error("Odds proxy not set. Go to Profile and paste your proxy URL.");
  const base = state.oddsProxyUrl.replace(/\/+$/,"");
  const url = `${base}/odds?sport=${encodeURIComponent(sport)}&markets=${encodeURIComponent(markets)}&regions=${encodeURIComponent(regions)}&bookmakers=${encodeURIComponent(bookmakers)}&oddsFormat=${encodeURIComponent(oddsFormat)}&dateFormat=${encodeURIComponent(dateFormat)}`;
  const res = await fetch(url, { headers:{ "accept":"application/json" }});
  const json = await res.json().catch(()=>null);
  if(!res.ok){
    const msg = json ? JSON.stringify(json) : `HTTP ${res.status}`;
    throw new Error(`Odds proxy error (${res.status}). ${msg}`);
  }
  // Worker returns {status, body, rate}. Support direct body too.
  if(json && typeof json === "object" && "body" in json) return json.body;
  return json;
}


function pickMarket(markets, key){
  if(!markets || !markets.length) return null;
  return markets.find(m => m.key === key) || null;
}

function renderOddsGamesList(data, preferredBook){
  if(!Array.isArray(data) || !data.length){
    return `<div class="muted">No game odds returned. (Either no games today, or this market isn’t available on your Odds API plan.)</div>`;
  }
  return data.map(ev => {
    const when = ev.commence_time ? new Date(ev.commence_time).toLocaleString() : "";
    const bm = pickBookmaker(ev.bookmakers, preferredBook);
    const bmName = bm ? (bm.title || bm.key) : "—";

    const h2h = pickMarket(bm?.markets, "h2h");
    const totals = pickMarket(bm?.markets, "totals");
    const spreads = pickMarket(bm?.markets, "spreads");

    const mlRows = (h2h?.outcomes || []).map(o => `<tr><td>${esc(o.name||"")}</td><td>${esc(String(o.price ?? ""))}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">—</td></tr>`;
    const totRows = (totals?.outcomes || []).map(o => `<tr><td>${esc(o.name||"")}</td><td>${esc(String(o.point ?? ""))}</td><td>${esc(String(o.price ?? ""))}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">—</td></tr>`;
    const sprRows = (spreads?.outcomes || []).map(o => `<tr><td>${esc(o.name||"")}</td><td>${esc(String(o.point ?? ""))}</td><td>${esc(String(o.price ?? ""))}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">—</td></tr>`;

    return `
      <details class="card" style="margin-top:10px;">
        <summary style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div>
            <div style="font-weight:700;">${esc(ev.away_team || "")} @ ${esc(ev.home_team || "")}</div>
            <div class="muted">${esc(when)} • ${esc(bmName)}</div>
          </div>
          <div class="pill">ODDS</div>
        </summary>

        <div style="padding-top:10px;">
          <div class="h2" style="font-size:14px; margin:8px 0;">Moneyline</div>
          <div style="overflow:auto;">
            <table class="table">
              <thead><tr><th>Team</th><th>Price</th></tr></thead>
              <tbody>${mlRows}</tbody>
            </table>
          </div>

          <div class="h2" style="font-size:14px; margin:14px 0 8px;">Total</div>
          <div style="overflow:auto;">
            <table class="table">
              <thead><tr><th>Side</th><th>Line</th><th>Price</th></tr></thead>
              <tbody>${totRows}</tbody>
            </table>
          </div>

          <div class="h2" style="font-size:14px; margin:14px 0 8px;">Spread</div>
          <div style="overflow:auto;">
            <table class="table">
              <thead><tr><th>Team</th><th>Spread</th><th>Price</th></tr></thead>
              <tbody>${sprRows}</tbody>
            </table>
          </div>
        </div>
      </details>
    `;
  }).join("");
}




  const DEMO_PLAYERS = {
    NBA: ["Luka Dončić","Nikola Jokić","Jayson Tatum","Shai Gilgeous-Alexander","Giannis Antetokounmpo"],
    NFL: ["Patrick Mahomes","Josh Allen","Christian McCaffrey","Tyreek Hill","Justin Jefferson"],
    MLB: ["Shohei Ohtani","Aaron Judge","Juan Soto","Mookie Betts","Ronald Acuña Jr."],
    NHL: ["Connor McDavid","Auston Matthews","Nathan MacKinnon","David Pastrňák","Cale Makar"],
    EPL: ["Erling Haaland","Mohamed Salah","Bukayo Saka","Kevin De Bruyne","Son Heung-min"],
    UFC: ["Jon Jones","Islam Makhachev","Sean O'Malley","Alex Pereira","Leon Edwards"]
  };

  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const fmtPct = n => `${Math.round(n*100)}%`;
  const nowISO = () => new Date().toISOString();

  const defaultState = () => ({
    sport: "NBA",
    route: "live",
    oddsProxyUrl: "",
    oddsPreferredBook: "fanduel",
    oddsPropsCache: null,
    oddsGamesCache: null,
    oddsMarketBySport: {},
    // For NBA: we can optionally pull players from a specific live game
    selectedEventId: null,
    // tracked players for AI picks
    tracked: [], // {sport,name,market,line,lean}
    aiPicksBySport: {}, // sport -> picks
    lastUpdatedAt: null
  });

  let state = loadState();
  let liveCache = { sport:null, scoreboard:null, events:[], fetchedAt:0 };
  let toastTimer = null;

  function saveState(){
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }
  function loadState(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    }catch(_){ return defaultState(); }
  }

  function toast(msg){
    const t = $(".toast");
    if(!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>t.classList.remove("show"), 1200);
  }

  function setRoute(r){
    state.route = r;
    saveState();
    render();
  }

  function setSport(s){
    state.sport = s;
    state.selectedEventId = null;
    saveState();
    // clear AI picks for new sport so the user sees a refresh
    render();
    refreshLive(true).catch(()=>{});
  }

  async function refreshLive(force=false){
    const sport = state.sport;
    const age = Date.now() - liveCache.fetchedAt;
    if(!force && liveCache.sport===sport && age < 30_000 && liveCache.events.length) return;

    try{
      toast("Refreshing…");
      const sb = await window.ESPN.getScoreboard(sport);
      const events = window.ESPN.parseScoreboard(sport, sb);
      liveCache = { sport, scoreboard: sb, events, fetchedAt: Date.now() };
      state.lastUpdatedAt = nowISO();
      saveState();
      render();
      toast("Updated");
    }catch(err){
      console.warn("refreshLive failed", err);
      toast("Live feed blocked (demo mode)");
      // Keep existing cache; UI will still work
    }
  }

  function trackedForSport(sport){
    return state.tracked.filter(t=>t.sport===sport);
  }

  function addTrackedFromName(name){
    const sport = state.sport;
    const market = SPORT_MARKETS[sport][0] || "PTS";
    state.tracked.push({
      sport,
      name,
      market,
      line: "",
      lean: "MORE"
    });
    saveState();
    render();
    toast("Added");
  }

  function removeTracked(ix){
    state.tracked.splice(ix,1);
    saveState();
    render();
  }

  function updateTracked(ix, patch){
    state.tracked[ix] = { ...state.tracked[ix], ...patch };
    saveState();
  }

  // Simple demo AI pick generator (works even if ESPN blocked)
  function generateAIPicks(){
    const sport = state.sport;
    const tracked = trackedForSport(sport);
    const base = tracked.length ? tracked : DEMO_PLAYERS[sport].slice(0,5).map(n=>({
      sport, name:n, market: SPORT_MARKETS[sport][0] || "PTS", line:"", lean:"MORE"
    }));

    const picks = base.slice(0,6).map((it, i)=>{
      const markets = SPORT_MARKETS[sport] || ["PTS"];
      const mkt = it.market || markets[i % markets.length];
      const lean = it.lean || (Math.random()>.5 ? "MORE" : "LESS");
      const conf = clamp(0.58 + (Math.random()*0.28), 0.55, 0.86);
      const reason = [
        "Role + usage look stable.",
        "Opponent profile matches the market.",
        "Recent form supports the lean."
      ];
      return {
        id: `${sport}-${it.name}-${mkt}-${i}`,
        player: it.name,
        market: mkt,
        line: it.line || "",
        lean,
        confidence: conf,
        reasoning: reason
      };
    });

    state.aiPicksBySport = { ...state.aiPicksBySport, [sport]: picks };
    saveState();
    render();
    toast("AI picks updated");
  }

  function uiTopbar(){
    const sport = state.sport;
    const opts = Object.keys(SPORT_MARKETS).map(s=>`<option value="${s}" ${s===sport?"selected":""}>${s}</option>`).join("");
    return `
      <div class="topbar">
        <div class="inner">
          <div class="brand">
            <div class="badge">PT</div>
            <div>
              <div class="title">Prop Tracker</div>
              <div class="subtitle">Live (ESPN) • Multi‑Sport • v2.10</div>
            </div>
          </div>
          <div class="controls">
            <select id="sportSel" aria-label="Sport">${opts}</select>
            <button id="refreshBtn" class="ghost" title="Refresh">↻</button>
          <button id="profileBtn" class="ghost" title="Profile">⚙️</button>
            </div>
        </div>
      </div>
    `;
  }

  function uiTabs(){
    const r = state.route;
    const tab = (id, label, icon) =>
      `<button class="tab ${r===id?"active":""}" data-route="${id}">${icon}<span>${label}</span></button>`;
    return `
      <div class="tabs">
        <div class="inner">
          ${tab("live","Live Bets","🟦")}
          ${tab("games","Games Today","📅")}
          ${tab("players","Players","🏀")}
          ${tab("ai","AI Picks","🤖")}
        </div>
      </div>
    `;
  }

  
  function uiLive(){
    const sport = state.sport;
    const eventsAll = (liveCache.sport===sport ? liveCache.events : []);
    const events = eventsAll.filter(ev => ev.state === "in" && !ev.completed);
    const updated = state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toLocaleString() : "—";

const oddsBook = state.oddsPreferredBook || "";
const oddsCache = state.oddsGamesCache;
const cacheOk = oddsCache && oddsCache.sport===sport && (Date.now() - oddsCache.fetchedAt) < (10*60*1000) && (!oddsBook || oddsCache.book===oddsBook);
const oddsHtml = cacheOk ? renderOddsGamesList(oddsCache.data, oddsBook) : "";
const oddsCard = `
  <div class="card">
    <div class="hrow">
      <div>
        <div class="h2">Live betting odds</div>
        <div class="small">Moneyline • Total • Spread (via Odds API). Tap Load/Refresh to pull today’s lines.</div>
      </div>
      <div class="row">
        <select id="oddsGameBookSel">
          <option value="">Any book</option>
          <option value="fanduel" ${oddsBook==="fanduel"?"selected":""}>FanDuel</option>
          <option value="draftkings" ${oddsBook==="draftkings"?"selected":""}>DraftKings</option>
          <option value="betmgm" ${oddsBook==="betmgm"?"selected":""}>BetMGM</option>
          <option value="caesars" ${oddsBook==="caesars"?"selected":""}>Caesars</option>
        </select>
        <button class="btn" id="btnLoadGameOdds">${cacheOk ? "Refresh" : "Load"}</button>
      </div>
    </div>

    ${!state.oddsProxyUrl ? `
      <div class="item">
        <div class="name">Odds proxy not set.</div>
        <div class="meta">Tap the gear icon (top right) → paste your proxy URL → Save. Then come back here and tap Load.</div>
      </div>
    ` : (cacheOk ? oddsHtml : `
      <div class="item">
        <div class="name">Nothing loaded yet.</div>
        <div class="meta">Tap Load to pull today’s game odds.</div>
      </div>
    `)}

    <div id="oddsGameError" class="small" style="color:#ffb3b3; margin-top:10px; display:none"></div>
  </div>
`;


    const rows = events.length ? events.map(ev=>{
      const left = `${ev.away.abbr || ev.away.name}`;
      const right = `${ev.home.abbr || ev.home.name}`;
      const score = `${ev.away.score}–${ev.home.score}`;
      const pill = `<span class="pill good">Live</span>`;
      return `
        <div class="item">
          <div class="top">
            <div class="name">${left} vs ${right}</div>
            ${pill}
          </div>
          <div class="meta">${score} • ${ev.detail || ev.name}</div>
          <div class="meta small">Event ID: <span class="pill">${ev.id}</span></div>
          <div class="row" style="margin-top:10px">
            <button class="ghost" data-set-event="${ev.id}">Use for Players</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="item"><div class="name">No live games right now.</div><div class="meta">If games are scheduled later, check Games Today.</div></div>`;

    return `
      ${oddsCard}
      <div class="card">
        <div class="hrow">
          <div>
            <div class="h2">Live Bets</div>
            <div class="small">Live games only • Last updated: ${updated}</div>
          </div>
          <button class="primary" id="refreshLiveBtn">Refresh</button>
        </div>
        <div class="list" style="margin-top:12px">${rows}</div>
      </div>
    `;
  }

function uiGames(){
    const sport = state.sport;
    const events = liveCache.sport===sport ? liveCache.events : [];
    const updated = state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toLocaleString() : "—";

const oddsBook = state.oddsPreferredBook || "";
const oddsCache = state.oddsGamesCache;
const cacheOk = oddsCache && oddsCache.sport===sport && (Date.now() - oddsCache.fetchedAt) < (10*60*1000) && (!oddsBook || oddsCache.book===oddsBook);
const oddsHtml = cacheOk ? renderOddsGamesList(oddsCache.data, oddsBook) : "";
const oddsCard = `
  <div class="card">
    <div class="hrow">
      <div>
        <div class="h2">Live betting odds</div>
        <div class="small">Moneyline • Total • Spread (via Odds API). Tap Load/Refresh to pull today’s lines.</div>
      </div>
      <div class="row">
        <select id="oddsGameBookSel">
          <option value="">Any book</option>
          <option value="fanduel" ${oddsBook==="fanduel"?"selected":""}>FanDuel</option>
          <option value="draftkings" ${oddsBook==="draftkings"?"selected":""}>DraftKings</option>
          <option value="betmgm" ${oddsBook==="betmgm"?"selected":""}>BetMGM</option>
          <option value="caesars" ${oddsBook==="caesars"?"selected":""}>Caesars</option>
        </select>
        <button class="btn" id="btnLoadGameOdds">${cacheOk ? "Refresh" : "Load"}</button>
      </div>
    </div>

    ${!state.oddsProxyUrl ? `
      <div class="item">
        <div class="name">Odds proxy not set.</div>
        <div class="meta">Tap the gear icon (top right) → paste your proxy URL → Save. Then come back here and tap Load.</div>
      </div>
    ` : (cacheOk ? oddsHtml : `
      <div class="item">
        <div class="name">Nothing loaded yet.</div>
        <div class="meta">Tap Load to pull today’s game odds.</div>
      </div>
    `)}

    <div id="oddsGameError" class="small" style="color:#ffb3b3; margin-top:10px; display:none"></div>
  </div>
`;


    const rows = events.length ? events.map(ev=>{
      const left = `${ev.away.abbr || ev.away.name}`;
      const right = `${ev.home.abbr || ev.home.name}`;
      const score = (ev.state === "in") ? `${ev.away.score}–${ev.home.score}` : (ev.completed ? `${ev.away.score}–${ev.home.score}` : "—");
      const pill = ev.completed ? `<span class="pill">Final</span>` :
                   (ev.state==="in" ? `<span class="pill good">Live</span>` :
                    `<span class="pill">${ev.shortDetail || "Scheduled"}</span>`);
      return `
        <div class="item">
          <div class="top">
            <div class="name">${left} vs ${right}</div>
            ${pill}
          </div>
          <div class="meta">${score} • ${ev.detail || ev.name}</div>
          <div class="meta small">Event ID: <span class="pill">${ev.id}</span></div>
          <div class="row" style="margin-top:10px">
            <button class="ghost" data-set-event="${ev.id}">Use for Players</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="item"><div class="name">No events loaded.</div><div class="meta">Click refresh. If ESPN blocks requests on your network, the app still works in demo mode.</div></div>`;

    return `
            ${oddsCard}
            <div class="card">
        <div class="hrow">
          <div>
            <div class="h2">Today's games</div>
            <div class="small">Last updated: ${updated}</div>
          </div>
          <button class="primary" id="refreshLiveBtn">Refresh</button>
        </div>
        <div class="list" style="margin-top:12px">${rows}</div>
      </div>
    `;
  }

  async function uiPlayers(){
    const sport = state.sport;
    const tracked = trackedForSport(sport);

    let helper = "";
    if(sport === "NBA"){
      helper = `<div class="small">Tip: Pick a game in Games Today (Use for Players) to load that game's player list.</div>`;
    } else if(sport === "UFC"){
      helper = `<div class="small">UFC: ESPN doesn't provide live fighter stats the same way. You can still add fighters manually for tracking & AI picks.</div>`;
    } else {
      helper = `<div class="small">For now, player lists are automatic only for NBA. You can add anyone manually for tracking & AI picks.</div>`;
    }

const oddsMarket = (state.oddsMarketBySport && state.oddsMarketBySport[sport]) ? state.oddsMarketBySport[sport] : getDefaultOddsMarket(sport);
const oddsCache = state.oddsPropsCache;
const cacheOk = oddsCache && oddsCache.sport===sport && oddsCache.market===oddsMarket && (Date.now() - oddsCache.fetchedAt) < (15*60*1000);
const oddsHtml = cacheOk ? renderOddsPropsList(oddsCache.data, state.oddsPreferredBook) : "";
const oddsCard = `
  <div class="card">
    <div class="hrow">
      <div>
        <div class="h2">Today’s player props (Odds API)</div>
        <div class="small">Shows upcoming games and prop lines for the selected market. Requires your Odds API key (kept in a proxy).</div>
      </div>
      <div class="row">
        <select id="oddsMarketSel">${buildOddsMarketOptions(sport, oddsMarket)}</select>
        <select id="oddsBookSel">
          <option value="">Any book</option>
          <option value="fanduel" ${state.oddsPreferredBook==="fanduel"?"selected":""}>FanDuel</option>
          <option value="draftkings" ${state.oddsPreferredBook==="draftkings"?"selected":""}>DraftKings</option>
          <option value="betmgm" ${state.oddsPreferredBook==="betmgm"?"selected":""}>BetMGM</option>
          <option value="caesars" ${state.oddsPreferredBook==="caesars"?"selected":""}>Caesars</option>
        </select>
        <button class="btn" id="btnLoadOddsProps">${cacheOk ? "Refresh" : "Load"}</button>
      </div>
    </div>

    ${!state.oddsProxyUrl ? `
      <div class="item">
        <div class="name">Odds proxy not set.</div>
        <div class="meta">Go to Profile and paste your proxy URL (Cloudflare Worker / server endpoint). Then come back here and tap Load.</div>
      </div>
    ` : (cacheOk ? oddsHtml : `
      <div class="item">
        <div class="name">Nothing loaded yet.</div>
        <div class="meta">Tap Load to pull today’s lines.</div>
      </div>
    `)}

    <div id="oddsError" class="small" style="color:#ffb3b3; margin-top:10px; display:none"></div>
  </div>
`;
    const eventId = state.selectedEventId;
    let playerList = [];
    if(sport === "NBA" && eventId){
      try{
        const summary = await window.ESPN.getSummary("NBA", eventId);
        playerList = window.ESPN.parsePlayersFromSummary(summary);
      }catch(err){
        console.warn("NBA summary failed", err);
      }
    }
    if(sport === "UFC" && liveCache.scoreboard && liveCache.sport==="UFC"){
      playerList = window.ESPN.parseUfcFighters(liveCache.scoreboard);
    }

    const listHtml = playerList.length ? `
      <div class="list" style="margin-top:12px">
        ${playerList.slice(0,120).map(p=>`
          <div class="item">
            <div class="top">
              <div class="name">${p.name}</div>
              <button class="ghost" data-add-name="${escapeAttr(p.name)}">Track</button>
            </div>
            <div class="meta">${p.team || ""}</div>
          </div>
        `).join("")}
      </div>
    ` : `<div class="item" style="margin-top:12px"><div class="name">No player list loaded.</div><div class="meta">Add a player manually below.</div></div>`;

    const trackedHtml = tracked.length ? tracked.map((t, iAll)=>{
      const ix = state.tracked.findIndex(x=>x===t);
      const markets = SPORT_MARKETS[sport] || ["PTS"];
      const opts = markets.map(m=>`<option value="${m}" ${t.market===m?"selected":""}>${m}</option>`).join("");
      return `
        <div class="item">
          <div class="top">
            <div class="name">${t.name}</div>
            <button class="ghost" data-remove-track="${ix}">Remove</button>
          </div>
          <div class="row" style="margin-top:10px">
            <select data-track-market="${ix}">${opts}</select>
            <input data-track-line="${ix}" placeholder="Line (optional)" value="${escapeAttr(t.line||"")}" />
            <select data-track-lean="${ix}">
              <option value="MORE" ${t.lean==="MORE"?"selected":""}>MORE</option>
              <option value="LESS" ${t.lean==="LESS"?"selected":""}>LESS</option>
            </select>
          </div>
          <div class="meta small">Used by AI Picks for ${sport}</div>
        </div>
      `;
    }).join("") : `<div class="item"><div class="name">No tracked players yet.</div><div class="meta">Add from the list or manually.</div></div>`;

    return `
      ${oddsCard}
      <div class="card">
        <div class="hrow">
          <div>
            <div class="h2">Players to track</div>
            ${helper}
          </div>
          <div class="pill">${sport}${eventId ? ` • Game ${eventId}` : ""}</div>
        </div>

        ${listHtml}

        <div class="item" style="margin-top:12px">
          <div class="name">Add manually</div>
          <div class="row" style="margin-top:10px">
            <input id="manualName" placeholder="Player / Fighter name" />
            <button class="primary" id="addManualBtn">Add</button>
          </div>
          <div class="meta small">Manual adds are great for UFC, props you imported, or sports without player lists yet.</div>
        </div>

        <div style="margin-top:12px" class="h2">Tracked</div>
        <div class="list">${trackedHtml}</div>
      </div>
    `;
  }

  function uiAI(){
    const sport = state.sport;
    const picks = state.aiPicksBySport[sport] || [];
    const info = trackedForSport(sport).length ? "Based on your tracked list." : "Demo mode (add tracked players to personalize).";

    const rows = picks.length ? picks.map(p=>`
      <div class="item">
        <div class="top">
          <div class="name">${p.player} • ${p.market}${p.line ? ` ${p.line}`:""}</div>
          <span class="pill good">${fmtPct(p.confidence)} confidence</span>
        </div>
        <div class="meta">${sport} • ${p.lean}</div>
        <div class="meta">Reasoning
          <ul class="small" style="margin:6px 0 0 18px; color:var(--muted)">
            ${p.reasoning.map(r=>`<li>${r}</li>`).join("")}
          </ul>
        </div>
      </div>
    `).join("") : `<div class="item"><div class="name">No picks yet.</div><div class="meta">Tap Regenerate.</div></div>`;

    return `
      <div class="card">
        <div class="hrow">
          <div>
            <div class="h2">AI Picks</div>
            <div class="small">${info}</div>
          </div>
          <button class="primary" id="regenBtn">Regenerate</button>
        </div>
        <div class="list" style="margin-top:12px">${rows}</div>
      </div>
    `;
  }

  function uiProfile(){
    const total = state.tracked.length;
    return `
      <div class="card">
        <div class="h2">Profile</div>
        <div class="item">
          <div class="name">Local data</div>
          <div class="meta">${total} tracked entries stored in your browser (this device only).</div>
          <div class="row" style="margin-top:10px">
            <button class="ghost" id="exportBtn">Copy backup JSON</button>
            <button class="ghost" id="importBtn">Paste backup JSON</button>
          </div>
          <div class="row" style="margin-top:10px">
    <button class="primary" id="clearBtn">Clear all local data</button>
  </div>
</div>

<div class="item" style="margin-top:12px">
  <div class="name">Odds API proxy (for today’s prop lines)</div>
  <div class="meta">Paste your proxy URL (recommended: Cloudflare Worker). This keeps your Odds API key off GitHub Pages.</div>
  <div class="row" style="margin-top:10px">
    <input id="oddsProxyInput" placeholder="https://YOUR-WORKER.your-subdomain.workers.dev" value="${escapeAttr(state.oddsProxyUrl||"")}" style="flex:1; min-width:240px" />
    <button class="ghost" id="saveOddsProxyBtn">Save</button>
  </div>
  <div class="small" style="margin-top:6px">After saving, go to Players → Today’s player props → Load.</div>
</div>

<div class="item" style="margin-top:12px">
          <div class="name">GitHub Pages tip</div>
          <div class="meta">This build has <b>no service worker</b>, so you won't get the “stale cached app” problem when you delete/rename repos.</div>
        </div>
      </div>
    `;
  }

  function escapeAttr(s){
    return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  async function render(){
    const app = $("#app");
    app.innerHTML = uiTopbar() + `<div class="main">${await routeView()}</div>` + uiTabs() + `<div class="toast"></div>`;
    bindEvents();
  }

  async function routeView(){
    if(state.route === "live") return uiLive();
    if(state.route === "games") return uiGames();
    if(state.route === "players") return await uiPlayers();
    if(state.route === "ai") return uiAI();
    if(state.route === "profile") return uiProfile();
    return uiLive();
  }

  function bindEvents(){
    $("#sportSel")?.addEventListener("change", (e)=>setSport(e.target.value));
    $("#refreshBtn")?.addEventListener("click", ()=>refreshLive(true));
    $("#profileBtn")?.addEventListener("click", ()=>setRoute("profile"));
    $("#refreshLiveBtn")?.addEventListener("click", ()=>refreshLive(true));

    $$(".tab").forEach(b=>b.addEventListener("click", ()=>setRoute(b.dataset.route)));

    // Live -> set selected event
    $$("[data-set-event]").forEach(b=>b.addEventListener("click", ()=>{
      state.selectedEventId = b.dataset.setEvent;
      saveState();
      setRoute("players");
    }));

    // Add from list
    $$("[data-add-name]").forEach(b=>b.addEventListener("click", ()=>{
      addTrackedFromName(b.dataset.addName);
    }));

// Odds API props controls (Players tab)
$("#oddsMarketSel")?.addEventListener("change", (e)=> {
  state.oddsMarketBySport = state.oddsMarketBySport || {};
  state.oddsMarketBySport[state.sport] = e.target.value;
  state.oddsPropsCache = null;
  saveState();
  render();
});

$("#oddsBookSel")?.addEventListener("change", (e)=> {
  state.oddsPreferredBook = e.target.value || "fanduel";
  saveState();
  render();
});

$("#btnLoadOddsProps")?.addEventListener("click", async ()=> {
  const errEl = $("#oddsError");
  if(errEl){ errEl.style.display="none"; errEl.textContent=""; }
  if(!state.oddsProxyUrl){
    toast("Set your Odds proxy URL in Profile first.");
    return;
  }
  try{
    const market = $("#oddsMarketSel")?.value || getDefaultOddsMarket(state.sport);
    const book = $("#oddsBookSel")?.value || "";
    const sportKey = ODDS_SPORT_KEY[state.sport] || state.sport;
    toast("Loading lines…");
    const data = await fetchOddsPropsViaProxy({ sport: sportKey, market, bookmakers: book });
    state.oddsPropsCache = { sport: state.sport, market, fetchedAt: Date.now(), data };
    saveState();
    render();
    toast("Lines updated.");
  }catch(e){
    if(errEl){
      errEl.textContent = e?.message || String(e);
      errEl.style.display="block";
    }else{
      toast("Odds error: " + (e?.message || String(e)));
    }
  }
});


// Odds API game odds controls (Games Today tab)
$("#oddsGameBookSel")?.addEventListener("change", (e)=> {
  state.oddsPreferredBook = e.target.value || "fanduel";
  state.oddsGamesCache = null;
  saveState();
  render();
});

$("#btnLoadGameOdds")?.addEventListener("click", async ()=> {
  const errEl = $("#oddsGameError");
  if(errEl){ errEl.style.display="none"; errEl.textContent=""; }
  if(!state.oddsProxyUrl){
    toast("Set your Odds proxy URL in Profile first.");
    return;
  }
  try{
    const book = $("#oddsGameBookSel")?.value || "";
    const sportKey = ODDS_SPORT_KEY[state.sport] || state.sport;
    toast("Loading odds…");
    const data = await fetchOddsGamesViaProxy({ sport: sportKey, bookmakers: book });
    state.oddsGamesCache = { sport: state.sport, book, fetchedAt: Date.now(), data };
    saveState();
    render();
    toast("Odds updated.");
  }catch(e){
    if(errEl){
      errEl.textContent = e?.message || String(e);
      errEl.style.display="block";
    }else{
      toast("Odds error: " + (e?.message || String(e)));
    }
  }
});


    $("#addManualBtn")?.addEventListener("click", ()=>{
      const name = $("#manualName").value.trim();
      if(!name) return;
      addTrackedFromName(name);
      $("#manualName").value = "";
    });

    // Tracked edits
    $$("[data-remove-track]").forEach(b=>b.addEventListener("click", ()=>removeTracked(Number(b.dataset.removeTrack))));
    $$("[data-track-market]").forEach(el=>el.addEventListener("change", (e)=>updateTracked(Number(el.dataset.trackMarket), { market: e.target.value })));
    $$("[data-track-lean]").forEach(el=>el.addEventListener("change", (e)=>updateTracked(Number(el.dataset.trackLean), { lean: e.target.value })));
    $$("[data-track-line]").forEach(el=>el.addEventListener("input", (e)=>updateTracked(Number(el.dataset.trackLine), { line: e.target.value })));

    $("#regenBtn")?.addEventListener("click", generateAIPicks);

    $("#clearBtn")?.addEventListener("click", ()=>{
      if(!confirm("Clear all local data for Prop Tracker on this device?")) return;
      localStorage.removeItem(LS_KEY);
      state = defaultState();
      saveState();
      toast("Cleared");
      render();
    });

$("#saveOddsProxyBtn")?.addEventListener("click", ()=> {
  const v = $("#oddsProxyInput")?.value?.trim() || "";
  state.oddsProxyUrl = v;
  state.oddsPropsCache = null;
  saveState();
  toast(v ? "Odds proxy saved." : "Odds proxy cleared.");
  render();
});


    $("#exportBtn")?.addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(JSON.stringify(state));
        toast("Copied");
      }catch(_){
        alert(JSON.stringify(state));
      }
    });

    $("#importBtn")?.addEventListener("click", ()=>{
      const raw = prompt("Paste backup JSON");
      if(!raw) return;
      try{
        const parsed = JSON.parse(raw);
        state = { ...defaultState(), ...parsed };
        saveState();
        toast("Imported");
        render();
      }catch(_){
        alert("That JSON didn't parse.");
      }
    });
  }

  // Boot
  render();
  refreshLive(false).catch(()=>{});
})();
