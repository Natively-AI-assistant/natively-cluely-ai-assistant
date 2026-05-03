// Mobile client served by PhoneMirrorService.
// Inlined here so it travels with the asar bundle without extra build steps.
// Edit the template below; whitespace is preserved as written.

export const PHONE_MIRROR_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#050706" />
    <meta name="referrer" content="no-referrer" />
    <title>Natively Mirror</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #05070a;
        --panel: #0c1117;
        --panel-2: #111821;
        --line: rgba(120, 200, 255, 0.18);
        --line-soft: rgba(255, 255, 255, 0.07);
        --text: #f1f6fb;
        --muted: #7b8896;
        --accent: #6cf0d6;
        --accent-2: #55a6ff;
        --danger: #ff5d6c;
        --bar-h: 84px;
      }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        background:
          radial-gradient(1200px 600px at 18% -10%, rgba(85,166,255,0.10), transparent 70%),
          radial-gradient(900px 600px at 110% 110%, rgba(108,240,214,0.08), transparent 70%),
          linear-gradient(180deg, #05070a 0%, #070a0f 100%);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      button { border: 0; color: inherit; font: inherit; cursor: pointer; }
      .app {
        display: grid;
        grid-template-rows: auto 1fr auto;
        min-height: 100dvh;
        padding: env(safe-area-inset-top) 14px env(safe-area-inset-bottom);
      }
      .topbar {
        position: sticky; top: 0; z-index: 5;
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 18px 4px 14px;
        background: linear-gradient(180deg, rgba(5,7,10,0.96), rgba(5,7,10,0.72) 78%, transparent);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      }
      h1 { margin: 0; font-size: 18px; line-height: 1.05; font-weight: 700; letter-spacing: 0.2px; }
      .subtitle { margin-top: 5px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
      .status {
        display: inline-flex; align-items: center; gap: 8px;
        flex: 0 0 auto; min-height: 32px; padding: 0 11px;
        border: 1px solid var(--line-soft); border-radius: 999px;
        background: rgba(11,15,21,0.76); color: var(--muted); font-size: 12px;
      }
      .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--danger); }
      .status.connected { color: var(--text); }
      .status.connected .dot { background: var(--accent); animation: pulse 1.8s ease-in-out infinite; }
      .feed {
        display: flex; flex-direction: column; gap: 12px; min-height: 0;
        overflow-y: auto; padding: 12px 0 calc(var(--bar-h) + 20px);
        scroll-behavior: smooth; overscroll-behavior: contain;
      }
      .empty {
        display: grid; place-items: center; min-height: 58dvh;
        color: var(--muted); text-align: center; font-size: 14px; line-height: 1.55; padding: 0 16px;
      }
      .card {
        position: relative; padding: 14px 14px 16px;
        border: 1px solid var(--line-soft); border-radius: 10px;
        background: linear-gradient(180deg, rgba(17,24,33,0.92), rgba(11,16,22,0.96)), var(--panel);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        animation: rise 240ms cubic-bezier(0.16,1,0.3,1) both;
      }
      .card.live { border-color: var(--line); box-shadow: 0 0 0 1px rgba(108,240,214,0.10), inset 0 1px 0 rgba(255,255,255,0.05); }
      .card.user {
        background: linear-gradient(180deg, rgba(20,28,40,0.92), rgba(15,21,30,0.96));
        border-color: rgba(85,166,255,0.16);
      }
      .meta {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-bottom: 8px; color: var(--muted); font-size: 11px;
        font-variant-numeric: tabular-nums; text-transform: uppercase; letter-spacing: 0.6px;
      }
      .role { display: inline-flex; align-items: center; gap: 6px; }
      .role .pip { width: 6px; height: 6px; border-radius: 999px; background: var(--accent); }
      .role.user .pip { background: var(--accent-2); }
      .badge {
        display: none; padding: 3px 7px;
        border: 1px solid rgba(108,240,214,0.32); border-radius: 999px;
        color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
      }
      .card.live .badge { display: inline-block; }
      .content { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15.5px; line-height: 1.55; }
      .content .caret {
        display: inline-block; width: 7px; height: 1em; vertical-align: -2px; margin-left: 2px;
        background: var(--accent); border-radius: 2px;
        animation: blink 1s steps(2, end) infinite;
      }
      .actions {
        position: fixed; left: 14px; right: 14px;
        bottom: calc(14px + env(safe-area-inset-bottom));
        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px;
        min-height: 56px; padding: 8px;
        border: 1px solid var(--line-soft); border-radius: 12px;
        background: rgba(8,12,17,0.86);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        box-shadow: 0 16px 42px rgba(0,0,0,0.45);
      }
      .action {
        min-width: 0; min-height: 42px; border-radius: 8px;
        background: var(--panel-2); color: var(--text);
        font-size: 13px; font-weight: 600; letter-spacing: 0.2px;
        transition: transform 160ms cubic-bezier(0.16,1,0.3,1), background 160ms;
      }
      .action:active { transform: scale(0.98) translateY(1px); }
      .action.primary { background: linear-gradient(180deg, var(--accent), #4dd9bd); color: #00261d; }
      .toast {
        position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 70px);
        transform: translateX(-50%);
        padding: 8px 12px; border-radius: 999px;
        background: rgba(8,12,17,0.92); color: var(--text);
        border: 1px solid var(--line-soft);
        font-size: 12px; opacity: 0; pointer-events: none;
        transition: opacity 160ms ease;
      }
      .toast.show { opacity: 1; }
      @keyframes pulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(108,240,214,0.36); }
        50% { box-shadow: 0 0 0 7px rgba(108,240,214,0); }
      }
      @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes blink { 50% { opacity: 0; } }
    </style>
  </head>
  <body>
    <main class="app">
      <header class="topbar">
        <div class="title">
          <h1>Natively Mirror</h1>
          <div class="subtitle" id="subtitle">Connecting</div>
        </div>
        <div class="status" id="status">
          <span class="dot" aria-hidden="true"></span>
          <span id="statusText">Offline</span>
        </div>
      </header>

      <section class="feed" id="feed" aria-live="polite">
        <div class="empty" id="empty">
          Waiting for the next response from your desktop.
        </div>
      </section>

      <nav class="actions" aria-label="Actions">
        <button class="action" id="clearButton" type="button">Clear</button>
        <button class="action primary" id="copyButton" type="button">Copy</button>
        <button class="action" id="scrollButton" type="button">Bottom</button>
      </nav>

      <div class="toast" id="toast" role="status"></div>
    </main>

    <script>
      (function () {
        const feed = document.getElementById('feed');
        const empty = document.getElementById('empty');
        const status = document.getElementById('status');
        const statusText = document.getElementById('statusText');
        const subtitle = document.getElementById('subtitle');
        const toast = document.getElementById('toast');

        const params = new URLSearchParams(window.location.search);
        const token = params.get('t') || '';

        const messages = [];           // {id, role, content, createdAt}
        let live = null;               // { streamId, content, createdAt }
        let socket = null;
        let reconnectTimer = null;
        let reconnectDelay = 800;
        let wakeLock = null;

        function showToast(text) {
          toast.textContent = text;
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 1100);
        }

        function setConnected(isConnected) {
          status.classList.toggle('connected', isConnected);
          statusText.textContent = isConnected ? 'Connected' : 'Offline';
          subtitle.textContent = isConnected ? 'Live mirror active' : 'Reconnecting';
        }

        function fmtTime(value) {
          const d = value ? new Date(value) : new Date();
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function near(scrollEl, px) {
          return scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop < px;
        }

        function scrollToLatest(force) {
          if (force || near(feed, 80)) {
            feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
          }
        }

        function buildCard(m, opts) {
          const card = document.createElement('article');
          card.className = 'card' + (m.role === 'user' ? ' user' : '') + (opts && opts.live ? ' live' : '');
          card.dataset.id = m.id || '';
          const meta = document.createElement('div');
          meta.className = 'meta';
          const role = document.createElement('span');
          role.className = 'role' + (m.role === 'user' ? ' user' : '');
          const pip = document.createElement('span'); pip.className = 'pip';
          const roleLabel = document.createElement('span');
          roleLabel.textContent = m.role === 'user' ? 'You' : 'Assistant';
          role.append(pip, roleLabel);
          const right = document.createElement('span');
          right.textContent = fmtTime(m.createdAt);
          const badge = document.createElement('span');
          badge.className = 'badge'; badge.textContent = 'Live';
          meta.append(role, badge, right);
          const content = document.createElement('div');
          content.className = 'content';
          content.textContent = m.content || '';
          if (opts && opts.live) {
            const caret = document.createElement('span');
            caret.className = 'caret';
            content.appendChild(caret);
          }
          card.append(meta, content);
          return card;
        }

        function render() {
          empty.style.display = (messages.length === 0 && !live) ? 'grid' : 'none';
          feed.querySelectorAll('.card').forEach((c) => c.remove());
          for (const m of messages) feed.appendChild(buildCard(m));
          if (live) feed.appendChild(buildCard({ id: 'live:' + live.streamId, role: 'assistant', content: live.content, createdAt: live.createdAt }, { live: true }));
          scrollToLatest();
        }

        function appendLiveToken(streamId, token) {
          if (!live || live.streamId !== streamId) {
            live = { streamId, content: '', createdAt: new Date().toISOString() };
          }
          live.content += token;
          // Fast path: avoid full re-render when only the live card changes.
          let card = feed.querySelector('.card.live');
          if (!card) { render(); return; }
          const content = card.querySelector('.content');
          // Strip caret, append, re-add caret.
          const caret = content.querySelector('.caret');
          if (caret) caret.remove();
          content.appendChild(document.createTextNode(token));
          const c = document.createElement('span'); c.className = 'caret';
          content.appendChild(c);
          empty.style.display = 'none';
          scrollToLatest();
        }

        function finalizeLive(streamId, content, createdAt) {
          if (live && live.streamId === streamId) {
            messages.push({ id: 'a:' + streamId, role: 'assistant', content: content || live.content, createdAt: createdAt || live.createdAt });
            live = null;
            render();
          } else if (content) {
            messages.push({ id: 'a:' + streamId, role: 'assistant', content, createdAt: createdAt || new Date().toISOString() });
            render();
          }
        }

        function handleEvent(ev) {
          if (!ev || typeof ev !== 'object') return;
          if (ev.type === 'history' && Array.isArray(ev.messages)) {
            messages.length = 0;
            for (const m of ev.messages) messages.push(m);
            live = null;
            render();
            return;
          }
          if (ev.type === 'user') {
            messages.push({ id: ev.id, role: 'user', content: ev.content, createdAt: ev.createdAt });
            render();
            return;
          }
          if (ev.type === 'token') {
            appendLiveToken(String(ev.streamId), String(ev.token || ''));
            return;
          }
          if (ev.type === 'done') {
            finalizeLive(String(ev.streamId), ev.content, ev.createdAt);
            return;
          }
          if (ev.type === 'error') {
            if (live && live.streamId === String(ev.streamId)) {
              live.content += '\\n\\n[error: ' + (ev.message || 'stream failed') + ']';
              render();
              live = null;
            }
            showToast('Stream error');
            return;
          }
          if (ev.type === 'status') {
            // server-pushed status, ignored visually beyond connection state
            return;
          }
        }

        function connect() {
          clearTimeout(reconnectTimer);
          const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const url = proto + '//' + window.location.host + '/ws?t=' + encodeURIComponent(token);
          try { socket = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }

          socket.addEventListener('open', () => {
            setConnected(true);
            reconnectDelay = 800;
          });
          socket.addEventListener('close', (ev) => {
            setConnected(false);
            if (ev.code === 4401) { subtitle.textContent = 'Pairing token rejected'; return; }
            scheduleReconnect();
          });
          socket.addEventListener('error', () => {
            try { socket && socket.close(); } catch (e) {}
          });
          socket.addEventListener('message', (event) => {
            let payload;
            try { payload = JSON.parse(event.data); } catch (e) { return; }
            handleEvent(payload);
          });
        }

        function scheduleReconnect() {
          clearTimeout(reconnectTimer);
          const wait = Math.min(reconnectDelay, 8000);
          reconnectTimer = setTimeout(connect, wait);
          reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
        }

        async function requestWakeLock() {
          if (!('wakeLock' in navigator)) return;
          try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
          } catch (e) { wakeLock = null; }
        }

        document.getElementById('clearButton').addEventListener('click', () => {
          messages.length = 0; live = null; render();
        });
        document.getElementById('copyButton').addEventListener('click', async () => {
          const parts = messages.map((m) => (m.role === 'user' ? 'You: ' : '') + m.content);
          if (live && live.content) parts.push(live.content);
          const text = parts.join('\\n\\n');
          if (!text) return;
          try {
            if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(text);
            } else {
              const ta = document.createElement('textarea');
              ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
              document.body.appendChild(ta); ta.select();
              document.execCommand('copy'); document.body.removeChild(ta);
            }
            showToast('Copied');
          } catch (e) { showToast('Copy blocked'); }
        });
        document.getElementById('scrollButton').addEventListener('click', () => scrollToLatest(true));

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') requestWakeLock();
        });

        if (!token) {
          subtitle.textContent = 'Missing pairing token';
          status.classList.remove('connected');
          return;
        }

        requestWakeLock();
        connect();
      })();
    </script>
  </body>
</html>
`;
