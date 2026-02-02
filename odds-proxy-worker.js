// Cloudflare Worker proxy for The Odds API (v4)
// Keeps your API key off GitHub Pages. Supports:
//   GET /health
//   GET /events?sport=basketball_nba
//   GET /odds?sport=basketball_nba&markets=h2h,spreads,totals&regions=us&bookmakers=fanduel&oddsFormat=american&dateFormat=iso
//   GET /event_odds?sport=basketball_nba&eventId=<ID>&markets=player_points&regions=us&bookmakers=fanduel&oddsFormat=american&dateFormat=iso
//
// Required secret/var in Worker: ODDS_API_KEY

const BASE = "https://api.the-odds-api.com/v4";

function jsonResponse(obj, status=200, extraHeaders={}){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"GET,OPTIONS",
      "access-control-allow-headers":"*",
      ...extraHeaders
    }
  });
}

function okText(text, status=200){
  return new Response(text, {
    status,
    headers: {
      "content-type":"text/plain; charset=utf-8",
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"GET,OPTIONS",
      "access-control-allow-headers":"*"
    }
  });
}

async function callOddsApi(path, params, env){
  const key = env.ODDS_API_KEY || env.ODDS_API_KEY || env.ODDS_API || env.ODDS_KEY || env.ODDS_API_TOKEN;
  if(!key) return { error: "Missing ODDS_API_KEY in Worker Variables/Secrets." , status: 500 };

  const url = new URL(BASE + path);
  for (const [k,v] of Object.entries(params || {})){
    if(v !== undefined && v !== null && String(v).length){
      url.searchParams.set(k, v);
    }
  }
  url.searchParams.set("apiKey", key);

  const res = await fetch(url.toString(), { headers: { "accept":"application/json" } });
  const txt = await res.text();
  let body = null;
  try{ body = JSON.parse(txt); }catch(_){ body = txt; }

  if(!res.ok){
    return { error: "Odds API error", status: res.status, body, rate: {
      "x-requests-remaining": res.headers.get("x-requests-remaining"),
      "x-requests-used": res.headers.get("x-requests-used"),
      "x-requests-last": res.headers.get("x-requests-last")
    }};
  }
  return { status: res.status, body, rate: {
    "x-requests-remaining": res.headers.get("x-requests-remaining"),
    "x-requests-used": res.headers.get("x-requests-used"),
    "x-requests-last": res.headers.get("x-requests-last")
  }};
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/,"") || "/";
    if(request.method === "OPTIONS"){
      return new Response("", {
        status: 204,
        headers: {
          "access-control-allow-origin":"*",
          "access-control-allow-methods":"GET,OPTIONS",
          "access-control-allow-headers":"*"
        }
      });
    }

    if(path === "/" || path === "/health"){
      return okText("ok");
    }

    // Common query params
    const sport = url.searchParams.get("sport") || "";
    const regions = url.searchParams.get("regions") || "us";
    const bookmakers = url.searchParams.get("bookmakers") || "";
    const oddsFormat = url.searchParams.get("oddsFormat") || "american";
    const dateFormat = url.searchParams.get("dateFormat") || "iso";
    const markets = url.searchParams.get("markets") || "";

    try{
      if(path === "/events"){
        if(!sport) return jsonResponse({ error:"Missing sport" }, 400);
        const r = await callOddsApi(`/sports/${encodeURIComponent(sport)}/events`, { dateFormat }, env);
        return jsonResponse(r, r.status || 200);
      }

      if(path === "/odds"){
        if(!sport) return jsonResponse({ error:"Missing sport" }, 400);
        const mkts = markets || "h2h,spreads,totals";
        const r = await callOddsApi(`/sports/${encodeURIComponent(sport)}/odds/`, {
          regions, markets: mkts, bookmakers, oddsFormat, dateFormat
        }, env);
        return jsonResponse(r, r.status || 200);
      }

      if(path === "/event_odds"){
        if(!sport) return jsonResponse({ error:"Missing sport" }, 400);
        const eventId = url.searchParams.get("eventId") || "";
        if(!eventId) return jsonResponse({ error:"Missing eventId" }, 400);
        if(!markets) return jsonResponse({ error:"Missing markets" }, 400);
        const r = await callOddsApi(`/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds`, {
          regions, markets, bookmakers, oddsFormat, dateFormat
        }, env);
        return jsonResponse(r, r.status || 200);
      }

      // Back-compat: /props?sport=...&market=player_points -> uses event_odds across today's events (limited)
      if(path === "/props"){
        if(!sport) return jsonResponse({ error:"Missing sport" }, 400);
        const market = url.searchParams.get("market") || markets;
        if(!market) return jsonResponse({ error:"Missing market" }, 400);

        // 1) fetch events for the sport
        const ev = await callOddsApi(`/sports/${encodeURIComponent(sport)}/events`, { dateFormat }, env);
        if(ev.error) return jsonResponse(ev, ev.status || 500);

        const events = Array.isArray(ev.body) ? ev.body : [];
        const limited = events.slice(0, 20); // protect rate limits
        const out = [];
        for (const e of limited){
          const id = e.id || e.event_id || e.key;
          if(!id) continue;
          const r = await callOddsApi(`/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(id)}/odds`, {
            regions, markets: market, bookmakers, oddsFormat, dateFormat
          }, env);
          if(r && !r.error){
            // The event endpoint returns an object; normalize to the app's array style
            out.push(r.body);
          }
        }
        return jsonResponse({ status: 200, body: out, rate: ev.rate });
      }

      return jsonResponse({ error:"Not found" }, 404);
    }catch(err){
      return jsonResponse({ error:"Worker exception", message: String(err?.message || err) }, 500);
    }
  }
};
