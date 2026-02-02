# Odds API Proxy Setup (recommended)

Your Prop Tracker is hosted on GitHub Pages (static). If you put your paid **The Odds API** key directly in the front-end (`app.js`), anyone can view it and steal it.

So we use a tiny **proxy** (serverless) that keeps the key secret, and the app calls that proxy.

## Option A (Recommended): Cloudflare Worker

1) In Cloudflare, go to **Workers & Pages** → **Create application** → **Create Worker**.

2) Name it something like `odds-proxy` and create it.

3) Open the Worker editor and replace the default code with the contents of `odds-proxy-worker.js` (included in this build).

4) Add your key as a secret:
   - Worker → **Settings** → **Variables** → **Add variable**
   - Type: **Secret**
   - Name: `ODDS_API_KEY`
   - Value: (your key from The Odds API)

5) Click **Deploy**.

6) Copy your Worker URL. It will look like:
   - `https://odds-proxy.<your-subdomain>.workers.dev`

7) In the Prop Tracker app:
   - Go to **Profile**
   - Paste the Worker URL into **Odds API proxy**
   - Click **Save**

8) Go to **Players** tab:
   - Choose a market (Points, Rebounds, PRA, etc.)
   - Click **Load** to see today’s upcoming games and prop lines.

## Option B: Any server you control

You can run a tiny endpoint on your own domain (Ionos, etc.) that forwards requests to The Odds API and returns JSON with CORS enabled.

The front-end expects:

- `GET <your-proxy>/props?sport=<sport_key>&market=<market_key>&bookmakers=fanduel`

Return the raw JSON you get from The Odds API.

## Notes

- Not every market is available for every sport/book.
- If you see “No odds returned”, it usually means:
  - No games today, or
  - The market key isn’t enabled on your Odds API plan, or
  - The chosen bookmaker doesn’t offer that market.
