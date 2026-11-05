# EcoGraph UI redesign: liquid glass controls and an isometric city map

**Status:** Implemented 2026-11-05, with the changes listed in section 13. Not yet tested on the Render deployment.
**Reason:** The teacher asked for a better UI.
**Scope:** `frontend/` only. No API or backend changes are expected.

## 1. Goal

Replace the current flat schematic with two distinct visual worlds:

- **Controls:** macOS-style liquid glass with real refraction and RGB chromatic fringing.
- **Simulation area:** a grass isometric city in the style of base-building strategy games, with stone roads, building clusters, depots, bins and animated trucks.

The two never overlap. **There is no glass on the simulation area.**

All simulation features and data stay as they are. The redesign changes how they are shown, not what they do.

## 2. Decisions

| Topic | Decision |
|---|---|
| Layout | Glass panels sit beside the grass map, on a wallpaper. Nothing covers the map. |
| Chroma | Real refraction with RGB split in Chromium. Other browsers get plain blur. |
| Map view | True isometric 2.5D, with roads on the diamond grid. |
| Renderer | PixiJS replaces Cytoscape. Terrain and roads are baked to a cached ground layer. |
| False crossings | Bridges where roads cross without a real junction. |
| Road zones | Shown by road width and by the buildings around them. |
| Buildings | Each collection point is drawn as a cluster of buildings. No standalone scenery. |
| Art | Original hand-authored SVG, committed to the repo. |
| Status | Bubble above a cluster when it is due or overflowing. Nothing shown otherwise. |
| Playback | All trucks move at once. |
| Camera | Smoothly follows one random truck each day. |
| Manual control | Pause at any time, and follow any truck. |
| Wallpaper | Static macOS-style gradient, with a light and a dark version. |
| Dark mode | Moonlit night map with lit windows. |
| Database tab | Tables on fully see-through glass, replacing the grass area while open. |
| Performance | No low-power mode or fallback. The demo machine has an Intel Arc GPU. |

**Hosting:** Render free tier. The frontend runs on the viewer's own machine, so server resources do not limit rendering. See section 9 for cold starts.

## 3. Screen layout

```
+----------------------------------------------------------------+
| glass title bar: EcoGraph | Map / Database | Fit | Theme | Status |
+--------------+-------------------------------------------------+
| Simulation   |                                                 |
| Trucks       |                                                 |
| City builder |        grass isometric map (no glass)           |
| Due list     |                                                 |
| (glass,      |                                                 |
|  collapsible)+-------------------------------------------------+
|              | glass legend strip                              |
+--------------+-------------------------------------------------+
        macOS gradient wallpaper behind all glass
```

- The grass map is a clean rectangle with rounded corners and a soft shadow.
- These controls move off the map and into glass:
  - Tabs and the "Fit all nodes" button go to the title bar.
  - The legend goes to the strip under the map.
- Information shown *on* the map, such as the hover card, uses a game-style wooden signboard rather than glass.
- The left column scrolls and its sections collapse.
- Target desktop widths are 1280px and above. Phone layout is out of scope.

## 4. Liquid glass

Applies to the title bar, side panels, legend strip, Database sheet, buttons and inputs.

**Refraction (Chromium):**

- Use an inline SVG filter through `backdrop-filter: url(#glass) blur(...)`.
- Each panel gets a displacement map generated on a canvas, so bending is strongest at the rim and zero at the centre. Regenerate it through `ResizeObserver`.
- For RGB split, run three `feDisplacementMap` passes at slightly different scales, isolate one colour channel from each, and recombine them.
- Add a specular highlight along the top rim and a thin bright border.

**Other browsers:** Plain `backdrop-filter: blur()` with the same border and highlight. Detect the browser engine explicitly, because `CSS.supports` may report `url()` backdrop filters as supported where they do not render. Test this first in implementation.

**Readability:**

- Filters apply to the backdrop only, never to text or controls.
- Add a thin tint layer and a subtle text halo as needed.
- All text must meet WCAG AA contrast over the most vivid part of the wallpaper, in both themes.
- Tokens remain CSS variables in `style.css`, under the existing `data-theme` mechanism.

**Database tab:**

- The sheet replaces the grass area while the tab is open, and the Pixi ticker stops.
- Rows are fully see-through as requested. This is the highest readability risk, because the tables are dense.
- Use the text halo and thin row dividers rather than filled rows. Review at real data density on the demo display.

## 5. Isometric map

### 5.1 Layout

Keep the logic that places localities at their real Dehradun positions and pushes them apart (`project`, `separateBubbles`). Then:

1. Snap each locality to a grid footprint large enough for its nodes.
2. Assign each node a grid cell inside its locality, with the junction near the centre. This replaces the sunflower pattern.
3. Project cells to the screen with `sx = (x - y) * TW/2`, `sy = (x + y) * TH/2`, where `TW:TH` is 2:1.

The layout must be deterministic, so the map looks the same after every reload.

### 5.2 Roads

Each `city.json` road becomes a path along the two grid axes.

- **Routing:** Use A* on the grid, one road at a time in a fixed order.
  - Building cells are blocked.
  - Running along another road is heavily penalised, so unrelated roads do not merge and appear connected.
  - Bends carry a small cost.
  - Crossing another road at a right angle is allowed.
- **Bridges:** Where two roads cross and no shared node exists there, draw the later road on a bridge sprite over the earlier one.
- **Truck paths:** Trucks use these same routed paths, so they stay on the visible road.

**Width by zone:**

| Zone | Width | Source |
|---|---|---|
| Arterial | Large | User request |
| Industrial | Medium | Assumed, see section 11 |
| Residential | Narrow | User request |
| Commercial | Narrow | User request |

- All roads share a stone look with a darker kerb.
- Since residential and commercial share a width, the buildings around them tell them apart.
- Road length in km no longer matches screen length. Keep km labels, shown once zoomed in, as they are today.
- Exposure km in hazard results is unaffected, since it comes from the server.

### 5.3 Terrain

- Grass base with light texture variation.
- Each locality is a slightly different ground plot with a low fence and a wooden name sign.
- Zone tint can vary subtly by plot.
- Ground, plots, roads and bridges are baked once into a cached texture. Re-bake when a theme changes or the city changes. Split into chunks if the bake would exceed the GPU's maximum texture size.

### 5.4 Sprites

All are original SVGs in `frontend/assets/sprites/`, rasterised to Pixi textures at high resolution so they stay sharp at maximum zoom. They should evoke the genre without copying any Clash of Clans art, characters or layouts.

| Data | Sprite |
|---|---|
| Home, residential | Cluster of houses |
| Home, commercial | Cluster mixing skyscrapers, vendor stalls and coffee shops |
| Home, industrial | Cluster of factories |
| Hazardous site | Clinic, lab or workshop, chosen from the node's waste description or name, with a hazard marker |
| Depot | Walled truck yard with a gate |
| Bin | Distinct design for each of general, recyclable, compost, medical and chemical |
| Junction | Road intersection tile, with no building |
| Normal truck | Green garbage truck, 4 facing directions |
| Hazard truck | Yellow and black hazard truck, 4 facing directions |
| Crossing | Bridge, in both axis directions |

- Pick cluster contents from a hash of the node ID, so a node looks the same every time.
- Sort sprites by depth (`x + y`) so nearer objects draw over farther ones.
- Night versions add lit windows and darker colours. These can be an overlay rather than a separate full sprite set.

### 5.5 Status

- **Due:** amber bubble above the cluster.
- **Overflowing:** red bubble above the cluster.
- **Otherwise:** nothing shown.
- Fill detail stays in the hover signboard, Due list and Database tab.

### 5.6 Interaction

- Keep drag to pan, wheel to zoom, the current zoom limits and "Fit all nodes".
- Hovering a building cluster shows the same name, locality and kind as today.
- Hit-testing uses the sprite's footprint.
- Clicking a truck follows it (section 6).

## 6. Simulation playback

The bubble timing fix below was replaced by live pickups, see section 13.

**Today:** `simulation-view.js` awaits `GraphView.animateRoute` once per truck, and each call clears the previous truck's route.

**New:** Add `GraphView.animateDay(trucks)`, which resolves once every truck has finished.

- All trucks leave together, each with a coloured trail. Hazard trails are red and dashed, matching today's route colours.
- A route's duration is proportional to its `cost`. The longest route that day sets the day's length, kept roughly to 6 to 12 seconds. Tune this during implementation.
- Trucks face their direction of travel.

**Camera:**

- At the start of each day, choose one truck at random and smoothly follow it, zoomed in.
- At the end of the day, stay in place until the next day begins.
- Dragging or zooming manually stops following until the next day or until a truck is chosen.

**Pause and follow:**

- Add a Pause/Resume button to the Simulation panel, next to Stop.
- Pausing freezes trucks and trails, and stops the next day from starting. The map can still be panned and zoomed.
- Add a **Trucks** section listing that day's trucks with kind, load, stops and km. Clicking one follows it, as does clicking a truck on the map. Both work when paused or running.
- A chosen truck keeps focus until that day ends. The next day goes back to random unless the same truck is chosen again.
- Stop keeps its current behaviour: it ends playback and clears routes.

**Bubble timing fix (required):**

`POST /advance` returns after the server has already collected the day's waste, and `refreshViews()` then runs *before* animation starts. Left as is, bubbles would vanish before any truck arrives. The fix:

1. During a day, stop `ScheduleView`'s polling and its `markDue` call from changing the map.
2. Text panels can update straight away.
3. As a truck reaches a stop in its `homes` list, including en-route collections, remove that stop's bubble.
4. When the day's animation ends, apply the latest schedule to the map and restart polling.

## 7. Code changes

| File | Change |
|---|---|
| `frontend/index.html` | New structure, Pixi script at a pinned exact version replacing Cytoscape, SVG filter definitions, Pause and Trucks UI. |
| `frontend/css/style.css` | Rewritten for wallpaper, glass and layout. |
| `frontend/js/graph-view.js` | Rewritten on Pixi. May split into `iso-layout.js`, `road-router.js` and `map-renderer.js`. |
| `frontend/js/glass.js` (new) | Displacement map generation and browser engine detection. |
| `frontend/js/simulation-view.js` | Concurrent playback, pause, truck list, bubble timing. |
| `frontend/js/schedule-view.js` | Allow map updates to be held during a day. |
| `frontend/js/theme.js` | Trigger the map re-bake with the night palette. |
| `frontend/js/database-view.js` | Styling, plus pausing the Pixi ticker when hidden. |
| `frontend/assets/sprites/` (new) | SVG art. |
| `README.md`, `CLAUDE.md` | Replace Cytoscape references, describe the new map. |

**Keep these `GraphView` methods working:** `init`, `addElements`, `rebuild`, `fitAll`, `nodePositions`, `clearRoute`, `markDue`, `resize`, `applyTheme`. `animateRoute` is replaced by `animateDay`.

**Constraints:**

- No build step and plain JS, as now. The Dockerfile already copies all of `frontend/`, and the server already serves `.svg` correctly.
- No backend changes are expected. If any prove necessary, raise them first.
- Keep rendering DOM text with `textContent`, as the current views do.

## 8. City builder

- New nodes go in the nearest free cells within their locality, growing its footprint if it is full.
- Adding nodes re-runs layout and road routing and re-bakes the ground.
- The builder can add up to 100 nodes at a time, so routing has to stay quick at that size. Test the largest case, and show a brief "Rebuilding map" state if it takes noticeable time.
- Reset rebuilds the original city.

## 9. Render free tier

- The free service sleeps when idle and takes a while to wake, so the first load can be slow. Show a branded loading screen with "Waking the server…" instead of a blank page, and retry `GET /graph` until it responds.
- Static assets come from the same sleeping server, so the first HTML request also waits on the wake-up. Render's own wake-up page may appear first, and the app cannot change that. Open the site a few minutes before a demo.
- Simulation state is in memory, so waking from sleep resets it to day 0. This already happens today.

## 10. Acceptance criteria

1. No glass or `backdrop-filter` element overlaps the map rectangle.
2. In Chromium, panel edges visibly bend the wallpaper with colour fringing. Firefox and Safari show clean blur with no visual breakage.
3. All 51 nodes of the default city appear with the correct sprite type, and all 69 roads are drawn.
4. Every road crossing without a shared node shows a bridge. Unrelated roads do not run along the same cells.
5. Arterial roads are visibly wider than residential and commercial roads.
6. On a played day, all trucks move at once and stay on roads, and the camera follows one truck.
7. Pause freezes playback and Resume continues it. Any truck can be followed from the list or the map.
8. A due bubble stays until its truck arrives, then disappears.
9. Hazard trucks still follow the server's route, and exposure km still appears.
10. Priority/FIFO, fleet settings, city builder add and reset, Database search and filters, and the history log all work as before.
11. Light and dark themes both look finished, and switching keeps truck and camera positions.
12. Playback is smooth on the Intel Arc demo machine at the default city size.
13. The hosted Render build works from a cold start.
14. Existing server test binaries still pass, unchanged.

## 11. Open items

Defaults were chosen for these because the interview did not settle them. Each is easy to change.

- **Industrial road width:** Assumed medium, since only arterial, residential and commercial were specified.
- **Product name:** The page says "EcoRouting Engine" and the repo says "EcoGraph". The spec assumes the title changes to **EcoGraph**.
- **Report and PPT:** Screenshots in the academic deliverables are not updated by this work. Treat that as a separate task if needed.

## 12. Suggested build order

1. **Glass shell:** wallpaper, layout and refraction on the current map. This proves the riskiest visual early.
2. **Isometric static map:** layout, router, bridges, baked ground, and placeholder sprites.
3. **Real art:** SVG sprite set, status bubbles and night mode.
4. **Playback:** concurrent trucks, camera, pause and follow, and bubble timing.
5. **Remaining views:** Database glass, builder re-bake, and the loading screen.
6. **Verification:** run the acceptance criteria locally, then on Render, then update the docs.

## 13. Changes requested during implementation

These replace the matching decisions above.

- **Themes:** The light and dark toggle is gone. The map runs a day and night cycle instead: morning when the trucks leave, evening when the last one finishes, then a short night before the next day. The clock only runs while a day is playing, and holds still when paused or idle.
- **Page background:** A photo of Switzerland replaces the gradient. The sunny Oeschinensee photo shows by day and the Milky Way over the Matterhorn by night, both from Wikimedia Commons under CC BY-SA 4.0 and credited on the page.
- **Database view:** Always shows the Milky Way photo, sharp with no blur.
- **All glass:** The top bar, side cards and legend are always black glass, at every time of day.
- **Truck speed:** A constant speed instead of a fixed day length, with a slider from 0.25x to about 5.7x. A long route now takes about a minute at 1x.
- **City size:** 19 more collection points, H25 to H43, for 70 nodes in total. The default fleet went from 3 to 5 normal trucks to carry the extra waste.
- **Live pickups (backend change):** A played day no longer applies its pickups all at once. The server waits for `POST /simulate/arrive` as each truck reaches a location, and `POST /simulate/settle` finishes anything left. The map, Database, Due list and tooltips therefore always show the same state, and the Database updates during a day, with trucks still driving while that tab is open. The day summary table shows overflow at the start of the day and a live "Still overflowing" count.
- **Zone colours:** Road edges, locality borders and locality signs carry a zone colour: amber arterial, purple industrial, sky blue commercial, pink residential.
- **Fill bars:** The 10 fullest homes show a fill bar and percentage on the map, in the Database colours.
- **Disposal sites:** They only receive waste, so they have no fill level, status, due date or bubble anywhere.
- **One collection rule (backend change):** The Priority and FIFO choice is gone. All trucks go to the most full homes first until capacity runs out, and a clash goes to the most due. Hazard trucks take one home per truck per day. Due homes that get no truck are listed as waiting, most due first.
- **Trips and return:** Normal trucks run several trips a day within a km limit and end at the depot, with that drive counted. Capacity now applies per trip. Hazard trucks are unchanged.
- **Build details:** The bake lowers its resolution on very large cities rather than splitting into chunks. Bridges are painted into the ground rather than drawn as separate sprites.
