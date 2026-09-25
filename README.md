# Nightfall Bunker

Co-op, round-based zombie survival in the browser. Board the windows, buy your
guns off the walls, clear the debris, gamble at the box — and survive the night.
One to four players.

**Play:** https://zombies.alirezaafshan.com

- Three.js, no downloaded assets: every texture, model, chalk drawing and
  sound is generated in code at load time.
- Multiplayer lobbies run on Cloudflare Durable Objects. Before a match starts,
  every player measures their latency to each Cloudflare region and the match
  is created in the region with the lowest worst-case ping.
- Solo play runs the same authoritative simulation inside the page.

## Controls

WASD move · Shift sprint · Space jump · C crouch · Mouse aim/fire · Right mouse
aim down sights · R reload · F buy / rebuild / revive (hold) · V knife ·
G grenade · 1/2/wheel switch · Tab scores · Enter chat · M mute

## Development

```bash
npm install
npm run dev        # http://localhost:5173 (solo works without a server)
npm start          # origin server on :8080 for local multiplayer
npm test
npm run build && npm run smoke
```

See `AGENTS.md` for architecture, netcode and deployment notes.

A fan-made homage to classic round-based zombie modes; not affiliated with any
game publisher.
