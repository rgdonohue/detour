# Detour: UX Brainstorm & Product Direction

## Context

Detour is a Santa Fe walking/driving tour builder. Users click origin, click destination, see a route, then discover and select curated stops along the way — building a multi-stop itinerary with distance/time deltas. Current state: functional map-first UX, 100+ curated POIs, shareable URL state, drive/walk mode toggle, category filtering.

**Business goal:** Impress local Santa Fe tour guides and tourism industry enough that they pay to build iterations. The tool could serve tour guides in training, tourism businesses creating packaged experiences, or end-user visitors exploring the city.

**Current gap:** The app builds a route but doesn't help you *use* it. Once you've selected stops, there's no walking guidance, no stop detail content, no way to save/share the experience as a "tour," and no information architecture for the tourism professional use case.

---

## Part 1: Personas (Cooper-style)

### Persona 1: "Maria" — The Professional Tour Guide

- **Age:** 42, runs a small walking tour company in Santa Fe for 8 years
- **Goal:** Create, refine, and share curated walking routes for clients. Needs to plan ahead of time, not on-the-spot.
- **Context of use:** Laptop at home or office, planning tours for next week's bookings. Occasionally pulls up on phone to show a client the route.
- **Pain points:** Currently uses Google Maps + a Word doc + local knowledge. Wants something that *looks professional* when showing clients. Wants to test "what if I add this gallery" without recalculating everything manually.
- **What she'd pay for:** A tool that makes her look more professional, saves planning time, and lets her share polished itineraries with clients before they arrive.

### Persona 2: "Jake" — The Tourist/Visitor

- **Age:** 34, visiting Santa Fe for a long weekend with partner
- **Goal:** Find an interesting self-guided walking route that hits cultural highlights without getting lost or walking too far.
- **Context of use:** Phone, standing outside their hotel, 10am. Wants something *right now*.
- **Pain points:** Doesn't know the city. Trip advisor/Google Maps gives point-to-point directions, not curated tours. Doesn't want to read a blog post — wants a map that guides them.
- **What he'd pay for:** Probably nothing directly. But he'd use a free tool that a hotel concierge recommends or that shows up in "things to do in Santa Fe" searches.

### Persona 3: "Diana" — The Tourism Bureau / Hotel Concierge

- **Age:** 55, works at a hotel front desk or visitor center
- **Goal:** Hand visitors a *ready-made experience* — "here's a 2-mile walking tour of the arts district."
- **Context of use:** Desktop or tablet at work. Needs to quickly produce something she can print, email, or text to a guest.
- **Pain points:** Currently hands out the same photocopied map (like the pink-arrow one in docs/data) to everyone regardless of interest. No personalization.
- **What she'd pay for:** A subscription or white-label tool her hotel/bureau can brand with pre-built tour templates.

### Persona 4: "Carlos" — The Guide-in-Training

- **Age:** 26, learning to be a Santa Fe walking tour guide
- **Goal:** Learn the city's stories, practice route-building, study which stops pair well together.
- **Context of use:** Phone while walking the routes himself. Laptop when studying.
- **Pain points:** No interactive tool for route study. Has to memorize stop details from books and mentor notes.
- **What he'd pay for:** Access to stop content (history, stories, cultural context) integrated with routes.

---

## Part 2: UX Gaps (Nielsen Norman Heuristics)

### H1: Visibility of System Status
- **Current:** Route distance/time shown. Detour delta shown. Good.
- **Gap:** Once walking, zero feedback. No "you are here," no progress through stops, no ETA to next stop.

### H2: Match Between System and Real World
- **Current:** Map-first is natural. Category labels (Art, History, etc.) are clear.
- **Gap:** Stop descriptions are one-liners. A real walking tour has *stories* — "this is where the 1680 Pueblo Revolt began." The app speaks in coordinates and distances when the user thinks in stories and landmarks.

### H3: User Control and Freedom
- **Current:** Reset button, clear stops, mode toggle. Decent.
- **Gap:** No undo for individual stop removal (you can deselect, but the route recalculates immediately — no "are you sure?"). No way to reorder stops manually.

### H5: Error Prevention
- **Gap:** On mobile, fat-finger taps on map could accidentally set origin/destination. No confirmation step. No "did you mean to tap here?" for imprecise placements.

### H6: Recognition Rather Than Recall
- **Current:** Stops listed with names and categories. Good.
- **Gap:** No photos. No visual preview of what you'll see at each stop. A name like "San Miguel Chapel" means nothing to Jake the tourist.

### H7: Flexibility and Efficiency of Use
- **Gap:** No pre-built tour templates for repeat/expert users. Maria the guide rebuilds routes from scratch every time. No "start from this template" shortcut.

### H10: Help and Documentation
- **Gap:** No onboarding. The "click to set origin" prompt exists but there's no tutorial for stop selection, category filtering, or the detour comparison. Jake will figure out origin/destination but may never discover the stop features.

---

## Part 3: Feature Brainstorm — What Happens After Stop Selection?

### 3A. Walk-Along Guidance (Geolocation)

**What:** After building a route, user taps "Start Walking" and the app uses browser geolocation to show their position on the map, track progress, and notify when approaching stops.

**Alternatives:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A1: Passive dot** | Show blue GPS dot on map, nothing else | Simple. Users can follow visually. No notification complexity. | No guidance — user still has to interpret the map. Not much better than Google Maps. |
| **A2: Turn-by-turn-lite** | Show distance/time to next stop, "arriving at San Miguel Chapel" alerts | Feels like a real guided tour. Differentiated from Google Maps. | Requires continuous geolocation (battery drain). Need to handle GPS accuracy issues indoors/downtown. Complex state management. |
| **A3: Breadcrumb mode** | Track user path as they walk, show on map after tour completes | Cool "tour recap" feature. Low real-time complexity. | Doesn't help during the walk. Privacy considerations (storing location history). |
| **A4: No live guidance** | Don't build geolocation. Instead, generate step-by-step text directions exportable to Google Maps. | Zero GPS complexity. Works offline when printed. | Less differentiated. Feels like an export tool, not a tour guide. |

**Recommendation for demo:** A1 (passive dot) is low-effort, high-signal. A2 is the real product but significant work. A4 is the pragmatic MVP if the audience is tour guides (they plan, then walk without the app).

### 3B. Stop Detail Content (The Walking Tour Narrative)

**What:** Each stop has rich content — history, cultural significance, stories, photos, "what to look for when you arrive."

**Alternatives:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **B1: Expand seed CSV** | Add longer descriptions, photo URLs, links to the existing 100+ POI dataset | Cheapest. One-time editorial effort. Ship fast. | Doesn't scale. Static. Hard to keep current. No rich formatting. |
| **B2: CMS / headless database** | Use Supabase, Airtable, or similar to store rich stop content. API fetches on demand. | Structured. Maria/Diana could contribute content. Scalable. | Infrastructure overhead. Auth for editors. Overkill for demo. |
| **B3: LLM-generated on demand** | Use Claude API to generate a 2-paragraph narrative for each stop at request time, grounded in seed data + general knowledge. | Zero editorial cost. Impressive in a demo. Personizable (tone, audience). | Hallucination risk for historical facts. Latency. API cost. Tour guides may distrust AI-generated content. |
| **B4: Link out to Wikipedia/NPS** | Each stop links to its Wikipedia article or relevant official page. | Zero content creation. Authoritative. | Disjointed UX (leaves the app). No control over quality or relevance of linked content. |
| **B5: Hybrid — curated blurbs + LLM enrichment** | Hand-write 2-sentence summaries for top 20 stops. Use LLM to expand on request ("Tell me more"). Link to authoritative sources. | Best of both worlds. Curated core, AI-augmented depth. Fallback to links when uncertain. | Still need some editorial work. Complexity of two content tiers. |

**Recommendation for demo:** B1 for the MVP sprint — expand the CSV with 3-4 sentence descriptions for the top 20-30 stops. B5 is the real product direction. B3 is a flashy demo feature ("Ask about this stop") that could impress tourism stakeholders.

### 3C. Saving & Sharing Routes

**What:** User builds a tour, wants to return to it later, share with others, or hand it off.

**Alternatives:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **C1: URL state (current)** | Already built. Full session in query params. | Done. Works now. No backend needed. | URL gets long with many stops. No title, no metadata. Can't browse saved tours. Ugly URL to share. |
| **C2: Short URL / hash lookup** | Generate a short code (e.g., `/t/a3f8k2`), store route params in a lightweight KV store (Redis, Cloudflare KV, or even a JSON file). | Clean shareable URL. No auth required. Can add title/description metadata. | Needs persistence layer. Orphaned entries accumulate. Need cleanup policy. |
| **C3: Named tours with slugs** | Like C2 but routes get human-readable names: `/tours/canyon-road-art-walk`. | Beautiful URLs. SEO-friendly. Professional-looking for Maria. | Requires naming UI. Slug collision handling. More complexity than a hash. |
| **C4: Local storage** | Save tours in browser localStorage. "My Tours" list. | No backend. Instant. Private. | Device-bound. Can't share. Loses data on clear. |
| **C5: Export-only** | Don't save — export to PDF, GPX, or image. User saves the artifact themselves. | No persistence infrastructure. Tangible output. | Can't reload/edit later. Export format limitations. |
| **C6: URL state + optional short-link** | Keep current URL state as foundation. Add a "Share" button that creates a short link via simple backend endpoint. | Incremental over what exists. Best of C1 + C2. No forced migration. | Two code paths for route loading. |

**Recommendation for demo:** C6. The current URL state is already good. Add a "Share this tour" button that hits a `/api/share` endpoint returning a short hash. Store in a flat JSON file or SQLite for the demo. Zero-auth, zero-infrastructure, and impressive.

### 3D. Export Formats

**What:** Get the tour out of the app and into the real world.

**Alternatives:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **D1: Print-friendly view** | CSS print stylesheet. Stripped map + stop list with descriptions. | Near-zero effort. Diana can print it for guests. | Limited control over layout. No map image in print. |
| **D2: PDF generation** | Server-side PDF with map screenshot, itinerary, stop details. | Professional output. Branded. Maria can email to clients. | Needs map screenshot (Puppeteer/Playwright). Server complexity. |
| **D3: GPX export** | Export route as GPX file, importable into Garmin/AllTrails/Google Earth. | Interoperable. Great for serious hikers. | Niche audience. No stop content in GPX. |
| **D4: Email itinerary** | "Email this tour" — sends a formatted email with map image and stop list. | Frictionless sharing. No app needed to view. | Needs email service (SendGrid, Resend). Spam risk. |
| **D5: Image/screenshot** | Generate a shareable image (map + stops overlay) for social media or messaging. | Highly shareable. Visual. | Static — can't interact. Needs server-side rendering. |
| **D6: Google Maps deep link** | "Open in Google Maps" with waypoints pre-filled. | Familiar. Turn-by-turn comes free. | Leaves the app. Limited to ~10 waypoints. Loses all stop content. |

**Recommendation for demo:** D1 (print view) is trivial and immediately useful for Diana. D6 (Google Maps link) is a great "escape hatch" for Jake. D4 (email) is the most impressive for stakeholder demos but has infrastructure cost.

### 3E. Pre-Built Tour Templates

**What:** Instead of building from scratch, choose from curated tours: "Art Walk (1.5 mi, 6 stops)", "Historic Downtown (2 mi, 8 stops)", "Sunset & Scenic (1 mi, 4 stops)."

**This is the killer feature for the tourism industry pitch.** Maria customizes templates. Diana hands them to guests. Jake browses and picks one.

**Alternatives:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **E1: Hardcoded templates** | Define 3-5 tours in code/data. Landing page lists them. Click to load. | Ship fast. Curated quality. Perfect for demo. | Doesn't scale. No user-created tours. |
| **E2: Template + customize** | Start from template, then add/remove stops. Fork model. | Best UX — guided start, personal finish. Maria's dream. | More complex state management. "Based on Art Walk, modified" needs tracking. |
| **E3: Community templates** | Users can publish tours for others. Like a tour marketplace. | Network effects. Content scales itself. | Moderation. Quality control. Way too much for demo. |

**Recommendation for demo:** E1. Three to five hand-crafted tours. A "Browse Tours" entry point alongside the current click-to-start flow. This is the single most impressive thing you can show to a tourism stakeholder.

---

## Part 4: Mobile-Specific UX Considerations

### The "Standing on a Street Corner" Problem
Jake is on his phone. He doesn't want to:
- Place two precise taps on a map (fat fingers, glare, moving targets)
- Read a sidebar panel (too much text on a 375px screen)
- Understand what "service area rings" mean

**Mobile-first alternatives to the current 2-click flow:**

| Option | Description | Rationale |
|--------|-------------|-----------|
| **"Use my location" button** | One tap to set origin = current GPS position | Eliminates the most awkward mobile interaction (precise map tap). Cooper's "perpetual intermediate" — don't make them learn click-to-set on a 5-inch screen. |
| **Search/autocomplete for destination** | Type "Canyon Road" instead of tapping the map | NNG: Recognition over recall. Most mobile users expect a search box, not a map-click interaction. |
| **Pre-built tour cards on mobile** | Landing screen shows 3-5 tour cards with photo, distance, time, stop count. Tap to start. | Eliminates the cold-start problem entirely. Jake doesn't know where to set origin or destination. Give him a curated starting point. |
| **Bottom sheet (not sidebar)** | Replace sidebar with a draggable bottom sheet (like Google Maps, Apple Maps) | The 45vh sidebar is close but not quite right. A draggable sheet with snap points (peek/half/full) is the mobile map convention now. |

---

## Part 5: Business Model / Stakeholder Pitch Angles

### Who pays and why?

| Stakeholder | What they'd buy | Price sensitivity | Demo hook |
|-------------|-----------------|-------------------|-----------|
| **Tour guide companies** | Branded tour builder + shareable links for their clients | Medium ($50-200/mo) | "Look, your Art Walk tour with your branding, shareable by link" |
| **Hotels / concierge desks** | Widget or white-label with pre-built tours for their guests | Higher ($200-500/mo) | "Your guests scan a QR code at the front desk and get a personalized walking tour" |
| **Tourism bureau / CVB** | City-wide platform with all official tours, analytics on what tourists visit | Highest (contract) | "See which neighborhoods tourists actually walk through. Promote undervisited areas." |
| **Visitors (end users)** | Nothing (free tier). Maybe premium LLM-narrated audio tour. | Very low | "Free walking tour of Santa Fe — better than a blog post, not as expensive as a guide" |

### The Demo Strategy
For a stakeholder demo, you want to show:
1. **Speed to value** — "I built this 6-stop Art Walk in 30 seconds" (templates + click-to-add)
2. **Shareable output** — "Here's the link I'd text to a guest" (short URL)
3. **Professional output** — "Here's what I'd print for a VIP client" (print view or PDF)
4. **Mobile experience** — "And here's what the guest sees on their phone" (browse tours + GPS dot)
5. **Differentiation** — "This isn't Google Maps. It's a curated, story-rich, route-aware tour builder."

---

## Part 6: Prioritized Roadmap Options

### Option A: "Tour Templates" Demo Sprint
**Focus:** Pre-built tours + share link + print view. Targets Maria and Diana.

1. Define 3-5 curated tour data objects (stops, route, name, description, estimated time)
2. "Browse Tours" landing/entry alongside current map
3. "Share this tour" short-link generation (lightweight backend)
4. Print-friendly CSS view
5. Expand stop descriptions for template stops (3-4 sentences each)

**Effort:** Medium. **Impact:** High for stakeholder pitch. **Risk:** Low.

### Option B: "Walk With Me" Mobile Sprint
**Focus:** Geolocation + bottom sheet + search. Targets Jake.

1. "Use my location" button for origin
2. Geocoder/search for destination
3. Passive GPS dot during walk
4. Bottom sheet replacing sidebar on mobile
5. "Next stop: 0.2 mi" indicator

**Effort:** High. **Impact:** High for end-user. **Risk:** Medium (GPS reliability downtown, battery).

### Option C: "Rich Stops" Content Sprint
**Focus:** Stop detail pages + narrative content. Targets Carlos and Jake.

1. Expand CSV seed with longer descriptions, categories, and photo references
2. Stop detail expansion (tap stop → see full description, photo, links)
3. Optional: "Tell me more" LLM-generated narratives
4. Walking tour "audio guide" feel without actual audio

**Effort:** Medium (mostly editorial). **Impact:** Medium. **Risk:** Low but content-heavy.

### Option D: "Full Stack" — Combination Approach
Cherry-pick the highest-impact item from each sprint:
1. 3-5 pre-built tour templates (from A)
2. "Use my location" button (from B)
3. Expanded stop descriptions for template stops (from C)
4. "Share this tour" short link (from A)

**Effort:** Medium-high. **Impact:** Very high — covers all personas. **Risk:** Scope creep.

---

## Part 7: Data & Persistence Architecture

### The Database Question

For the demo/MVP phase, **you don't need a traditional database.**

| Need | Solution | Why not a DB? |
|------|----------|---------------|
| Stop content | Expanded CSV or JSON file in repo | 100-200 stops is tiny. Editorial workflow = edit file, commit, deploy. |
| Tour templates | JSON file defining each template (name, stops[], description) | 3-5 templates is literally a config file. |
| Shared tour links | SQLite file or JSON append-log on server | Sub-1000 links doesn't need Postgres. SQLite is zero-config. |
| User-saved tours | localStorage (device-only) or the URL itself | No accounts = no user table = no DB. |
| Analytics (who visits what) | Server logs + Plausible/Umami (privacy-first analytics) | Don't build analytics infra. Use a hosted tool. |

**When you'd actually need a database:** If tour guides want to create and manage their own tours (CRUD), if you add user accounts, if you want a tour marketplace. That's post-demo.

### URL-Based Sharing (MVP)

The current URL state already encodes origin, destination, category, mode, and detour flag. To make it a "saved tour":

```
Current:  ?origin=-105.93,35.68&destination=-105.94,35.69&category=art&mode=walk
Add:      &stops=-105.93,35.68,-105.94,35.69,-105.95,35.70&name=Art%20Walk
Short:    /t/a3f8k2  →  resolves to full URL
```

The short-link approach:
1. POST `/api/share` with full route state → returns `{ id: "a3f8k2" }`
2. GET `/t/a3f8k2` → server looks up stored state → redirects to full URL
3. Storage: SQLite table with `id, state_json, created_at`
4. No auth. No accounts. Ephemeral by design (expire after 90 days if you want).

---

## Agreed Direction: One Codebase, Multiple Product Surfaces

**Decision:** Don't branch the codebase for different product directions. Instead:

1. **Tag the current state** as `v0.1-routing-core` — clean baseline to reference
2. **Build features additively on main** — templates, geolocation, rich content, share links all layer on without conflict
3. **Different entry points, not different apps** — route/URL-gated surfaces:
   - `/tours/build` — Maria's planning/editing flow
   - `/tours/:slug` — Jake's pre-built tour with "Start Walking"
   - `/tours` — Diana's gallery of tours to share/print
4. **API is the foundation** — FastAPI backend already clean and independent; multiple frontends or modes share it
5. **Extract only if proven** — if a direction warrants a genuinely different product (e.g., B2B dashboard with analytics), extract then, not before

**Next steps:** Pick the first feature to build additively. Tour templates (Option A) is the strongest starting point — it creates the `/tours` surface that all other features hang off of.
