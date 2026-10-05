# Cluely — Automatic Meeting Detection & Calendar vs Ad-hoc Tagging

Reverse-engineered from `/Applications/Cluely (New).app` (`app.asar` → `/tmp/cluely-extracted/`).
Client-side code only; server-side (`https://api.v2.cluely.com`) inferred from oRPC call shapes.

## TL;DR verdict

| Question | Answer |
|----------|--------|
| Does Cluely detect a running meeting in Chrome / Zoom / Teams desktop apps (process list, window title, active-tab sniffing)? | **No. No such code exists in the client.** No `getActiveWindow`, `CGWindowList`, `NSWorkspace.runningApplications`, `tasklist`, window-title parsing, `getDisplayMedia` sniffing, or Zoom/Teams/Meet URL tab monitoring. Verified by full-text search of `dist-electron/main.js` + all `dist/assets/*.js`. |
| How does it "automatically detect" a meeting? | **Calendar time-window polling.** Google Calendar sync (server-side) → `calendar.listMeetings` polled every 2 min → client-side 20 s interval checks `now ∈ [start − 2 min, end]` → one-shot `calendar.getMeetingOverview` → `meetingNotification` toast with Join button. |
| How is Zoom/Teams/Meet handled? | **As an opaque `meetingLink` string.** Client just `window.open(link, "_blank")`. No per-platform code path. The only platform-specific asset is a Google-Meet SVG icon (`google-meet-DOHyN-Wh.js`, used as a mask image on the Join button). |
| How is a meeting tagged "calendar" vs "normal (ad-hoc)"? | **By presence/absence of `meetingId`.** `sessions.create({ meetingId? })` — called with `{meetingId}` from any calendar surface, called with no arg from "Start Cluely". Analytics mirrors it: `SESSION_CREATED { hasMeeting: !!meetingId }`. Notification objects additionally carry `source: "calendar"`. There is no post-hoc classifier. |

---

## 1. Architecture

```
Google Calendar (OAuth, server-side sync)
        │  calendar.beginGoogleOAuth → deep link /dashboard/calendar-connected
        │  → patchSharedState({showDashboard:true}) + broadcast "dashboard-calendar-connected"
        ▼
oRPC backend: calendar.listMeetings / calendar.getMeetingOverview / calendar.getMeetingOverview(query, not mutation, on dashboard cards)
        │
        ▼
MeetingsQueryProvider (React, renderer)  — meetings-query-provider-D20W3wF_.js
  • listMeetings query, refetchInterval 120s, refetchInBackground
  • 20 s setInterval: filter now ∈ [start−120s, end]
  • per unhandled id: stash in Map, fire getMeetingOverview mutation (retry 3, 10 s delay)
  • onSuccess → shared state meetingNotification { source:"calendar", triggeredAt, meeting:{id,title,startTime,link,overview} }
  • mark all in-window ids handled (handledMeetingNotificationIds, dedup Set)
        │
        ▼
Shared state (use-shared-state-BHKRM0Gs.js, mirrored to main via get/patch-shared-state IPC)
  session | meetingNotification | handledMeetingNotificationIds | lastSessionId | ...
        │
        ├── main.js MeetingNotification window manager:
        │    phase==="app" && meetingNotification!==null → create/show 360×300 alwaysOnTop panel → route /notification
        │    else destroy. Suppressed entirely while session!=null (see §3).
        │
        ├── Notification UI (notification-BMh9d_7I.js): attendee briefs, time label, Join → createSession({meetingId}) + window.open(link)
        │
        ├── Dashboard cards (dashboard-De5xyxQ9.js): first 4 meetings, Join meeting button, prefetch overview on hover
        │
        └── Meeting detail (routes/dashboard/meetings/$meetingId → _meetingId-B83UA0e1.js):
             find meeting in listMeetings cache by id → getMeetingOverview query → createSession({meetingId:id}) + open link
```

---

## 2. Calendar integration (Google only in client)

**OAuth entry** — `dashboard-De5xyxQ9.js` function `G()`:

```ts
// reconnect banner + empty state both use the same mutation
const beginOAuth = o.calendar.beginGoogleOAuth.mutationOptions({ onSuccess: K });
function K(e) { window.open(e.redirectUrl, `_blank`); }   // Google consent in browser

// fired with analytics source tags:
capture(CALENDAR_CONNECT_STARTED, { platform: `google`, source: `dashboard_no_calendar` });
capture(CALENDAR_CONNECT_STARTED, { platform: `google`, source: `dashboard_no_calendar_reconnect` });
```

**Deep-link return** — `dist-electron/main.js` (auth deep-link handler):

```ts
if (t.hostname === "dashboard" && t.pathname === "/calendar-connected") {
  Q.patchSharedState({ showDashboard: !0, dashboardFocusCount: get() + 1 }),
  Z.broadcastIpc("dashboard-calendar-connected");
  return;
}
```

**Connection check** — dashboard reads it off the same meetings payload:

```ts
const hasGoogle = n.data?.connections.find(e => e.platform === `google`) != null;
```

**Meeting record shape** (fields observed across provider / dashboard / detail page):

```ts
interface CalendarMeeting {
  id: string;            // backend id, also route param /dashboard/meetings/$meetingId
  title: string;         // fallback "Untitled meeting"
  start_time: string;    // ISO
  end_time: string;      // ISO
  meetingLink: string | null;  // opaque URL: Meet / Zoom / Teams / anything
}
interface MeetingOverview {     // calendar.getMeetingOverview result
  summary?: string;
  attendeeBriefs?: Array<{ email: string; personSearch: { data: { person: {
    first_name: string; photo_url?: string; city?: string; state?: string; }; summary?: string } } }>;
}
```

No `platform`, `provider`, `isCalendar`, or `source` field on the meeting itself — calendar-ness is
implied by "came from `listMeetings`".

---

## 3. The detection loop (full logic, de-minified)

File: `dist/assets/meetings-query-provider-D20W3wF_.js` (entire file is the provider, ~2 KB).
Reformatted without changing semantics (`f`=meetings query, `p`=overview mutation):

```tsx
import { r } from "./orpc-H1j8Gjea.js";          // typed oRPC client
import { i as useQuery } from "./useQuery-FvDAnvtS.js";
import { a as useMutation } from "./useMutation-DsLiFfga.js";
import { i as useSharedState, r as patchShared } from "./use-shared-state-BHKRM0Gs.js";

const MeetingsCtx = createContext(null);

export function MeetingsQueryProvider({ children }) {
  const state = useSharedState();
  const byId = useRef(new Map());                              // id → CalendarMeeting
  const handledRef = useRef(state.handledMeetingNotificationIds);

  // (a) server poll: every 120 s, even in background
  const meetings = useQuery(r.calendar.listMeetings.queryOptions({
    refetchInterval: 120 * 1e3,
    refetchIntervalInBackground: !0,
  }));

  // (b) one-shot overview fetch per newly-due meeting
  const overview = useMutation(r.calendar.getMeetingOverview.mutationOptions({
    onSuccess: (data, vars /* { meetingId } */) => {
      patchShared((s) => {
        if (s.session || s.meetingNotification) return {};      // suppress if busy
        const m = byId.current.get(vars.meetingId);
        return {
          meetingNotification: {
            source: `calendar`,                                // ← the "calendar" tag
            triggeredAt: new Date().toISOString(),
            meeting: {
              id: vars.meetingId,
              title: m?.title ?? ``,
              startTime: m?.start_time ?? null,
              link: m?.meetingLink ?? null,
              overview: data,
            },
          },
        };
      });
    },
    retry: 3,
    retryDelay: 1e4,
  }));

  useEffect(() => { handledRef.current = state.handledMeetingNotificationIds; },
    [state.handledMeetingNotificationIds]);

  // (c) client-side due check: every 20 s
  useEffect(() => {
    if (!meetings.data) return;
    const check = () => {
      const now = Date.now();
      const due = meetings.data.meetings.filter((m) => {
        const start = new Date(m.start_time).getTime();
        const end = new Date(m.end_time).getTime();
        return now >= start - 120 * 1e3 && now <= end;          // 2-min early, until end
      });
      for (const m of due) {
        if (!handledRef.current.includes(m.id)) {
          byId.current.set(m.id, m);
          overview.mutate({ meetingId: m.id });
          break;                                               // one notification at a time
        }
      }
      const ids = due.map((m) => m.id);
      patchShared((s) => ({
        handledMeetingNotificationIds: Array.from(new Set([...s.handledMeetingNotificationIds, ...ids])),
      }));
    };
    check();
    const t = setInterval(check, 20 * 1e3);
    return () => clearInterval(t);
  }, [overview.mutate, meetings.data]);

  return <MeetingsCtx.Provider value={meetings}>{children}</MeetingsCtx.Provider>;
}
```

Key properties for reuse:

- Two-tier polling: slow server sync (120 s) + fast local due-check (20 s). No websocket/push.
- Lead time is a constant `120*1e3` (2 min) baked into the filter, not server-driven.
- `break` after first unhandled meeting → notifications are serial; a second overlapping meeting waits until the first toast/session clears.
- Guard `if (s.session || s.meetingNotification) return {}` → **never interrupts an active session**; the due meeting is still added to `handledMeetingNotificationIds`, so it will NOT re-fire after the session ends (accepted miss, not a queue).
- `handledMeetingNotificationIds` lives in persisted shared state (survives reload), mirrored into a ref for the interval closure.

---

## 4. Notification object, window lifecycle, and Join

**Shared-state fields** (`dist-electron/main.js`, initial state + reset):

```ts
session: null,
meetingNotification: null,
handledMeetingNotificationIds: [],
lastSessionId: null,
// on phase change away from "app": session, meetingNotification,
// handledMeetingNotificationIds, lastSessionId all reset to above
```

**Window manager** (`main.js`, `MeetingNotification.update`):

```ts
function update(state) {
  if (!(phase(state) === "app" && state.meetingNotification !== null)) {
    win?.destroy(); win = null; return;
  }
  win ||= create();                       // 360×300, alwaysOnTop, frameless panel
  win.setContentProtection(undetectability(state));
}
// create(): BrowserWindow({ width:360, height:300, alwaysOnTop:!0, frame:!1,
//   skipTaskbar:!0, type:"panel", title:"Upcoming Meeting", ... }) → route "/notification"
```

**Notification UI** (`dist/assets/notification-BMh9d_7I.js`, function `D()`):

```tsx
const t = useSharedState().meetingNotification;   // null → render null
const { createSession, isCreatingSession } = useCreateSession();
if (!t) return null;

const title = t.meeting.title || `Untitled meeting`;
const timeLabel = A(t.meeting.startTime, t.triggeredAt);  // "h:mm a" via date-fns format
const platformIcon = te(t.meeting.link);                  // icon resolver (Meet SVG)
const attendee = briefs.find(b => b.email === selectedEmail);

// JOIN — the whole "start this calendar meeting" action:
const join = async () => {
  await createSession({ meetingId: t.meeting.id });  // ← calendar tag carried as meetingId
  t.meeting.link && window.open(t.meeting.link, `_blank`);
};
const dismiss = () => patchShared({ meetingNotification: null });
```

So "Join" = create backend session bound to the calendar id, then hand the URL to the OS browser.
Cluely does not join inside itself and does not verify the meeting actually started.

---

## 5. Dashboard meeting cards (same tagging)

`dist/assets/dashboard-De5xyxQ9.js`, function `W()`:

```tsx
const h = shared.session !== null || isCreatingSession;   // Join disabled while busy
const g = (meetings.data?.meetings ?? []).slice(0, 4);    // first 4 only
const _ = g[0] ?? null, v = g.slice(1);

// hero card pre-loads overview as a QUERY (dashboard also uses mutation elsewhere)
const S = useQuery(o.calendar.getMeetingOverview.queryOptions({ input: _ ? { meetingId: _.id } : skip }));

const join = async (e: { meetingId?: string; meetingLink?: string }) => {
  if (h) return;
  e.meetingId ? setJoiningId(e.meetingId) : setGenericJoining(true);
  try {
    await createSession(e.meetingId ? { meetingId: e.meetingId } : void 0);  // ← tag point
    e.meetingLink && window.open(e.meetingLink, `_blank`);                    // opaque URL
  } finally { setJoiningId(null); setGenericJoining(false); }
};

// hover prefetch for instant detail page:
const prefetch = (id) => { if (!seen.has(id)) { seen.add(id);
  queryClient.prefetchQuery(o.calendar.getMeetingOverview.queryOptions({ input: { meetingId: id } })); } };
```

Notes: `join()` with no `meetingId` is the ad-hoc path (same function the hero "Start Cluely"
button uses). `window.open(..., "_blank")` for every platform — no `meet.google.com` / `zoom.us` /
`teams.microsoft.com` branching anywhere in the bundle.

---

## 6. Meeting detail page (`/dashboard/meetings/$meetingId`)

`dist/assets/_meetingId-B83UA0e1.js`, function `D()`:

```tsx
const { meetingId } = useParams();
const { name, startTime } = useSearch();
const meetings = useMeetingsQuery();                       // listMeetings cache
const S = meetings.data?.meetings.find(e => e.id === meetingId);  // ← calendar lookup
const overview = useQuery(r.calendar.getMeetingOverview.queryOptions({ input: { meetingId } }));
const summary = overview.data?.summary?.trim() || ``;
const briefs = overview.data?.attendeeBriefs ?? [];
const canJoin = shared.session === null && !isCreating && !!S;

const join = async () => {
  if (!S || !canJoin) return;
  await createSession({ meetingId: S.id });
  S.meetingLink && window.open(S.meetingLink, `_blank`);
};
```

If the id is not in the calendar cache (`S == null`), the page still renders name/startTime from
route search params but Join is disabled (`!!S`) — i.e. detail pages are calendar-only.

---

## 7. Calendar vs ad-hoc: the complete tagging logic

There is **no classifier**. The distinction is structural, decided at `createSession` call time:

```ts
// dist/assets/use-create-session-B6Qv7nb9.js (full file, reformatted)
function useCreateSession() {
  const posthog = usePosthog(), flags = useFeatureFlags();
  const create = useMutation(n.sessions.create.mutationOptions({
    onError: (e) => { if (isForbidden(e) && e.data?.outOfFreeSessions) {
      window.ipcRenderer.send(`open-dashboard-billing`, void 0);
      posthog.capture(BILLING_NAVIGATED_TO_PAYWALL, { reason: `out_of_free_sessions` });
    }},
  }));
  const join = async (e?: { meetingId?: string }) => {
    if (useSharedState.get().session || create.isPending) return;   // single-session guard
    const t = await create.mutateAsync({ hasPro: flags.pro, meetingId: e?.meetingId });
    const now = new Date().toISOString();
    patchShared({
      showDashboard: !1, showChat: !0, chatWindowIsExpanded: !1,
      session: { id: t.id, chatAgentName: t.chatAgentName,
                 audioInputLanguage: t.audioInputLanguage,
                 transcript: [], createdOrResumedAt: now, isResumed: !1 },
      lastSessionId: t.id,
    });
    window.ipcRenderer.send(`open-dashboard-session`,
      { sessionId: t.id, createdAt: now, openDashboard: !1 });       // main.js navigates dashboard
    posthog.capture(SESSION_CREATED, { hasMeeting: !!e?.meetingId }); // ← analytics tag
  };
  return { createSession: join, isCreatingSession: create.isPending };
}
```

| Surface | Call | Tag outcome |
|---------|------|-------------|
| Notification toast Join | `createSession({meetingId})` | calendar-bound (`hasMeeting:true`) |
| Dashboard meeting card Join | `createSession({meetingId})` | calendar-bound |
| Meeting detail page Join | `createSession({meetingId})` | calendar-bound |
| Hero "Start Cluely" button | `createSession()` / `createSession(void 0)` | ad-hoc (`hasMeeting:false`) |
| `sessions.create` payload | `{ hasPro, meetingId? }` | backend binds session→meeting only when id present |

Downstream, calendar-bound sessions get title/attendees/overview via `getMeetingOverview`;
ad-hoc sessions have none of that (empty transcript, no meeting context). Session history
(`sessions.list`, `sessions.get`, `sessions.waitFor`) is keyed by session id either way.

---

## 8. "Viewed screen" (what screen capture is actually for)

Not meeting detection — it feeds the vision LLM once a session is running.
`dist-electron/main.js`, `electron/domains/screenshot.ts`:

```ts
let MAX = 1920, inflight = null;
export const capture = () => inflight ??= (async () => {
  try {
    patchShared({ isCapturingScreenshot: !0 });
    return await retry({ times: 3, delay: 500 }, doCapture);
  } finally { patchShared({ isCapturingScreenshot: !1 }); inflight = null; }
})();

async function doCapture() {
  const chatWin = Chat.getWindow();
  const display = chatWin ? screen.getDisplayMatching(chatWin.getBounds()) : screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: fit(display.bounds) });
  const src = sources.find(s => s.display_id === display.id.toString()) ?? sources[0];
  if (!src) throw Error(`Unable to capture screenshot: no display source found for display ${display.id}`);
  if (src.thumbnail.isEmpty()) throw Error("Unable to capture screenshot: thumbnail is empty");
  return { data: src.thumbnail.toPNG(), contentType: "image/png" };
}
// IPC: handle("capture-screenshot", () => capture())
// permission probe: await desktopCapturer.getSources({ types:["screen"] }) → true/false
```

Whole-display PNG (downscaled to ≤1920px), 3 attempts × 500 ms, in-flight dedup.
Also used as the `setDisplayMediaRequestHandler` source (`video: sources[0], audio: "loopback"`)
for the chat window's audio/screen pipeline — again, capture-everything, not app-specific.

---

## 9. What Cluely does NOT do (verified absences)

- No enumeration of running apps / windows / tabs (no `NSWorkspace`, `CGWindowList`,
  `getAllWindows` beyond its own, `active-win`-style native module, `tasklist`/`ps`).
- No Chrome-tab URL reading, no extension, no `meet.google.com` / `zoom.us` / Teams matching.
- No mic/audio-activity trigger for detection (voice-activity flags exist but only gate UI).
- No geofencing, Bluetooth, or calendar-attachment parsing client-side.
- Failure mode: a meeting with no calendar event (or calendar unlinked) is invisible —
  user must press Start manually. Overlapping second meeting is skipped once marked handled.

---

## 10. Reusable reimplementation (TypeScript sketch)

```ts
// --- types ---
interface Meeting { id: string; title: string; start_time: string; end_time: string; meetingLink: string | null; }
const LEAD_MS = 120_000, SERVER_POLL_MS = 120_000, DUE_CHECK_MS = 20_000;

// --- due-check (port of §3) ---
async function checkDue(meetings: Meeting[], handled: Set<string>, ctx: { session: unknown; toast: unknown },
  onDue: (m: Meeting) => Promise<void>) {
  const now = Date.now();
  const due = meetings.filter(m => {
    const s = new Date(m.start_time).getTime(), e = new Date(m.end_time).getTime();
    return now >= s - LEAD_MS && now <= e;
  });
  for (const m of due) {
    if (!handled.has(m.id)) { await onDue(m); break; }   // serial, one at a time
  }
  due.forEach(m => handled.add(m.id));                    // mark even if suppressed
}
export function startMeetingWatcher(getMeetings: () => Promise<Meeting[]>, onDue: (m: Meeting) => Promise<void>) {
  const handled = new Set<string>();
  let cache: Meeting[] = [];
  const sync = async () => { try { cache = await getMeetings(); } catch {} };
  const tick = () => checkDue(cache, handled, { session: null, toast: null }, onDue).catch(() => {});
  sync(); tick();
  const t1 = setInterval(sync, SERVER_POLL_MS), t2 = setInterval(tick, DUE_CHECK_MS);
  return () => { clearInterval(t1); clearInterval(t2); };
}

// --- tagging (port of §7) ---
type SessionInput = { meetingId?: string };
async function createSession(input?: SessionInput) {
  const session = await api.sessions.create({ meetingId: input?.meetingId }); // omit when ad-hoc
  analytics.capture("SESSION_CREATED", { hasMeeting: !!input?.meetingId });
  if (input?.meetingId) { const m = await api.calendar.getMeetingOverview({ meetingId: input.meetingId }); attachContext(session, m); }
  return session;
}
async function joinMeeting(m: Meeting) { await createSession({ meetingId: m.id }); if (m.meetingLink) openExternal(m.meetingLink); }
async function startAdHoc() { await createSession(); }   // "Start Cluely" path
```

Adaptation notes for Natively: keep your local-first session model, but adopt the two-tier
poll (slow sync + fast due-check), the persisted `handledIds` set, the serial-notification
`break`, the busy guard (`session || toast → skip`), and the `meetingId?`-optional session
input as the single calendar/ad-hoc tag.

---

## Source file reference

| Area | File |
|------|------|
| Detection loop + `source:"calendar"` tag | `dist/assets/meetings-query-provider-D20W3wF_.js` |
| Toast UI + Join (`createSession({meetingId})` + `window.open(link)`) | `dist/assets/notification-BMh9d_7I.js` |
| Toast window lifecycle (phase-gated 360×300 panel, `/notification`) | `dist-electron/main.js` (`MeetingNotification.update`, shared-state reset) |
| Dashboard cards + `beginGoogleOAuth` + `window.open(meetingLink)` | `dist/assets/dashboard-De5xyxQ9.js` (`W()`, `G()`, `K()`) |
| Meeting detail (`find(id)` + overview + Join) | `dist/assets/_meetingId-B83UA0e1.js` (`D()`) |
| Session creation + `hasMeeting: !!meetingId` analytics | `dist/assets/use-create-session-B6Qv7nb9.js` |
| Session end (manual) + `SESSION_ENDED` analytics | `dist/assets/use-end-session-Do2WbMPW.js` |
| Session heartbeat (60 s) + ambient agent | `dist/assets/chat-DTEwz_GH.js` (`Gt()`, `Kt()`) |
| Session history, resume, reanalyze, follow-up email | `dist/assets/_sessionId-CYOrTI-q.js`, `dist/assets/dashboard-session-history-Dsv-iZvq.js` |
| Shared state (`session`, `meetingNotification`, `handledMeetingNotificationIds`) | `dist-electron/main.js` (state init), `dist/assets/use-shared-state-BHKRM0Gs.js` |
| Screen capture (`desktopCapturer`, 1920px, retry 3×500ms) | `dist-electron/main.js` (`electron/domains/screenshot.ts`, `capture-screenshot` IPC) |
| Calendar-connected deep link | `dist-electron/main.js` (`/dashboard/calendar-connected`) |
| Post-session polling (`sessions.waitFor`) | `dist/assets/use-poll-session-CDZjfSRK.js` |
| Meet icon only (no platform logic) | `dist/assets/google-meet-DOHyN-Wh.js` |

---

## 11. Re-verification on fresh install (v2.0.198, 2026-10-03)

Reinstalled app re-extracted to `/tmp/cluely-fresh/` — **byte-identical** to the original
extraction (`main.js` md5 `c3508dbe…`, all 913 assets unchanged, key files same hash).
The conclusions above stand. Additional sweep findings (new vs the first pass):

### 11.1 No native detection capability (confirmed at binary level)

- `app.asar.unpacked/node_modules/` contains exactly one package:
  `electron-app-universal-protocol-client` (deep-link handling). **No
  `active-win`, `node-window-manager`, or any window/process-enumeration native module.**
- Packaged `dependencies` are only: Electron updater/log/protocol/fs/yaml/record plumbing.
  Nothing that could observe other apps.
- Full IPC surface (22 handlers, enumerated from `main.js`): the only meeting-adjacent
  handlers are `capture-screenshot` and `open-dashboard-session`. No `get-active-window`,
  `list-processes`, or calendar-sync handler — calendar sync is purely server-side via oRPC.

### 11.2 Full backend procedure inventory (oRPC, client-observed)

- Calendar: `listMeetings`, `getMeetingOverview`, `beginGoogleOAuth`, `disconnect`
  (Google-only; `connections.find(e => e.platform === "google")`; Clerk `ProviderIcon`
  hits are sign-in buttons, not calendar providers — no Outlook/iCal/CalDAV code).
- Sessions: `create`, `get`, `list`, `update`, `end`, `endAllOngoing`, `resume`,
  `reanalyze`, `push`, `sendHeartbeat`, `waitFor`, `getRemainingFreeSessions`,
  `getFollowUpEmail`, `createAmbientChatAgent`.

### 11.3 Session lifecycle: start is calendar-assisted, end is manual

- **No auto-end.** Nothing watches for the calendar event's `end_time` or for the
  meeting app closing. `use-end-session-Do2WbMPW.js` (full logic):
  ```ts
  const end = async () => {
    const { session } = getSharedState();
    if (!session || pending) return;
    await sessions.end.mutateAsync({ id: session.id,
      transcript: session.transcript.filter(m => m.status === `ready`) });
    patchShared({ showDashboard: true, dashboardFocusCount: +1,
      chatWindowIsExpanded: false, session: null });
    capture(SESSION_ENDED, { wasResumed: session.isResumed,
      transcriptLength: session.transcript.length,
      durationMs: Date.now() - new Date(session.createdOrResumedAt).getTime() });
  };
  ```
  `sessions.endAllOngoing` is called from route setup (startup/sign-out cleanup), not from detection.
- **Heartbeat keeps the session alive**: `chat-DTEwz_GH.js` `Gt()` —
  `setInterval(() => sendHeartbeat.mutate({ id: sessionId }), 60_000)` while a session is active.
- **Ambient mode is separate**: `sessions.createAmbientChatAgent` query
  (`{ isMobile: false }`, no refetch on focus/reconnect) renders the same chat component
  with a fresh agent when `isAmbientEnabled` — not tied to any meeting.

### 11.4 Per-message capture flags (chat pipeline)

`chat-DTEwz_GH.js` message metadata confirms the "viewed screen" design from the summary:
```ts
metadata: { userDisplayText, screenUse, hasPartialAudio, smartMode,
            includesTranscriptUpToCreatedAt }
```
`screenUse` is a per-message boolean — screenshots are attached selectively per turn,
not streamed. No message carries window-title, app-name, or URL fields.
