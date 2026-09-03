## Voxaria Dashboard Plan (Phase 1 Implementation)

### 1) Build the full desktop app shell and visual system
- Create a polished **dark premium theme** using black/grey surfaces with **green accent states** (buttons, online indicators, active controls).
- Apply glassmorphism styling, soft shadows, subtle borders, and consistent 12px-radius cards.
- Set up a professional dashboard layout with:
  - Fixed **left sidebar** (Dashboard, Queue, Settings, Server Selector)
  - Top bar with integrated search
  - Main card grid for operational widgets
  - Fixed bottom **Powerful Player** dock
- Optimize specifically for **website/desktop usage** (no mobile-first redesign).

### 2) Implement the core dashboard components exactly to your spec
- **Integrated Search Bar**
  - Wide search input with placeholder:
    - “Search YouTube, Spotify, or paste a link...”
  - YouTube + Spotify visual indicators inside the field
  - Attached Search button with premium hover/active behavior

- **Queue + Session History (side-by-side cards)**
  - Queue list with album art, title, artist, duration, requester avatar
  - Session history list with dimmed visual treatment for completed tracks
  - Scrollable lists with row hover states and clean separators

- **Server & Shard Status Card**
  - Active shard, ping, uptime
  - Animated green “Online and Ready” pulse indicator

- **Audio Cache Management Card**
  - “Audio Cache Status” display with size metric and progress visualization
  - Prominent warning-style **Clean Audio Cache** button with glow hover

- **System Settings Card**
  - Toggle list including **Enable Session Restore** switch

- **Powerful Player (bottom docked bar)**
  - Left: current artwork + track metadata
  - Center: Previous / Play-Pause / Next / Stop controls + timeline/progress
  - Right: volume slider + Clear Queue + Leave voice controls
  - Smooth interaction states for all controls

### 3) Wire all read + control interactions through a temporary API adapter
- Create a clean frontend adapter/service layer that centralizes every endpoint mapping so you can plug your backend quickly.
- Wire **live reads** for:
  - Player now-playing
  - Queue
  - Session history
  - Shard/status
  - Cache metrics
  - Settings state
- Wire **control actions** for:
  - Search/play requests
  - Previous/Play-Pause/Next/Stop
  - Clear queue
  - Clean audio cache
  - Leave/disconnect
  - Session restore toggle
- Include clear placeholder endpoint definitions and payload/response contracts in one place for fast handoff.

### 4) UX polish and reliability pass
- Add loading, empty, and error states for every data card/action.
- Add optimistic visual feedback where useful (button pressed states, pending indicators).
- Keep interactions smooth and readable in dark theme (night/gaming comfort).
- Ensure fixed regions (sidebar/player) and content scrolling behave predictably on desktop.

### 5) Prepare for your backend phase handoff (Antigravity)
- Deliver a backend-ready frontend with explicit adapter method names aligned to your key engineering functions:
  - Sharded architecture status surfaces
  - Session restore enable/disable
  - Clean audio cache trigger
  - FFmpeg engine status surface (if endpoint provided)
  - Discord command action wiring (/play, /queue, /leave equivalents)
- Document exactly where Antigravity should connect each endpoint, so no UI rewrite is needed.

---

## Technical details (implementation-facing)
- Use existing React + TypeScript + Tailwind + shadcn/ui structure.
- Replace placeholder Index page with componentized dashboard sections.
- Keep API logic isolated in a dedicated service/adapter module with typed request/response interfaces and action methods.
- Use query/mutation patterns for live fetch + control actions and standardized toast/error feedback.
- Keep design tokens in the current CSS variable system and apply green-accent variants consistently across cards, statuses, and controls.