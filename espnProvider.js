// Prop Tracker v2.4 — ESPN helper (public, unofficial endpoints)
// Works on GitHub Pages because it uses standard HTTPS + CORS-friendly JSON endpoints.

(function(){
  const SPORT_MAP = {
    NBA: { path: "basketball/nba" },
    NFL: { path: "football/nfl" },
    MLB: { path: "baseball/mlb" },
    NHL: { path: "hockey/nhl" },
    EPL: { path: "soccer/eng.1" },
    UFC: { path: "mma/ufc" }
  };

  function withTimeout(promise, ms){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), ms);
    return Promise.resolve()
      .then(()=>promise(ctrl.signal))
      .finally(()=>clearTimeout(t));
  }

  async function fetchJson(url, { timeoutMs=12000 } = {}){
    return withTimeout(async (signal)=>{
      const res = await fetch(url, {
        method:"GET",
        headers:{ "Accept":"application/json" },
        cache:"no-store",
        signal
      });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }, timeoutMs);
  }

  function baseUrlForSport(sport){
    const s = SPORT_MAP[sport] || SPORT_MAP.NBA;
    return `https://site.web.api.espn.com/apis/v2/sports/${s.path}`;
  }

  async function getScoreboard(sport){
    const url = `${baseUrlForSport(sport)}/scoreboard`;
    return await fetchJson(url);
  }

  async function getSummary(sport, eventId){
    const url = `${baseUrlForSport(sport)}/summary?event=${encodeURIComponent(eventId)}`;
    return await fetchJson(url);
  }

  // Normalize scoreboard into simple event objects
  function parseScoreboard(sport, scoreboardJson){
    const events = Array.isArray(scoreboardJson?.events) ? scoreboardJson.events : [];
    return events.map(ev=>{
      const comp = ev?.competitions?.[0];
      const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
      const home = competitors.find(c=>c?.homeAway==="home") || competitors[0] || {};
      const away = competitors.find(c=>c?.homeAway==="away") || competitors[1] || {};
      const status = comp?.status?.type || ev?.status?.type || {};
      return {
        id: ev.id,
        name: ev.name || ev.shortName || "Event",
        date: ev.date,
        state: status.state || "",
        detail: status.detail || "",
        shortDetail: status.shortDetail || "",
        completed: !!status.completed,
        home: {
          name: home?.team?.displayName || home?.team?.shortDisplayName || home?.team?.name || "Home",
          abbr: home?.team?.abbreviation || "",
          score: Number(home?.score ?? 0),
        },
        away: {
          name: away?.team?.displayName || away?.team?.shortDisplayName || away?.team?.name || "Away",
          abbr: away?.team?.abbreviation || "",
          score: Number(away?.score ?? 0),
        }
      };
    });
  }

  // NBA players from summary boxscore
  function parsePlayersFromSummary(summaryJson){
    const players = [];
    const box = summaryJson?.boxscore?.players;
    if(!Array.isArray(box)) return players;
    for(const teamBlock of box){
      const teamName = teamBlock?.team?.abbreviation || teamBlock?.team?.displayName || "";
      const statsCats = Array.isArray(teamBlock?.statistics) ? teamBlock.statistics : [];
      // "athletes" live here
      const athletesGroups = Array.isArray(teamBlock?.statistics) ? [] : [];
      const groups = Array.isArray(teamBlock?.statistics) ? [] : [];

      const athGroups = Array.isArray(teamBlock?.statistics) ? [] : [];
      const ath = Array.isArray(teamBlock?.athletes) ? teamBlock.athletes : null;

      const athleteGroups = Array.isArray(teamBlock?.athletes) ? teamBlock.athletes : [];
      for(const g of athleteGroups){
        const items = Array.isArray(g?.athletes) ? g.athletes : [];
        for(const a of items){
          const name = a?.athlete?.displayName;
          if(!name) continue;
          players.push({ name, team: teamName });
        }
      }
    }
    // De-dupe
    const seen = new Set();
    return players.filter(p=>{
      const k = `${p.name}|${p.team}`;
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // UFC fighters list from scoreboard events (no player stats)
  function parseUfcFighters(scoreboardJson){
    const events = Array.isArray(scoreboardJson?.events) ? scoreboardJson.events : [];
    const fighters = [];
    for(const ev of events){
      const comp = ev?.competitions?.[0];
      const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
      for(const c of competitors){
        const nm = c?.athlete?.displayName || c?.team?.displayName;
        if(nm) fighters.push({ name: nm, team: "UFC" });
      }
    }
    // de-dupe
    const seen = new Set();
    return fighters.filter(f=>{
      const k=f.name;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  window.ESPN = {
    SPORT_MAP,
    fetchJson,
    getScoreboard,
    getSummary,
    parseScoreboard,
    parsePlayersFromSummary,
    parseUfcFighters
  };
})();
