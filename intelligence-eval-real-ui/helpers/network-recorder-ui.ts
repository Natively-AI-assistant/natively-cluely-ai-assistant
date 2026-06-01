// intelligence-eval-real-ui/helpers/network-recorder-ui.ts
// Records real network activity for the live API call during a UI test, via
// Playwright page request/response events. The Natively chat call is made from
// the MAIN process (Node fetch), not the renderer, so renderer-page events may
// not see it; we therefore ALSO capture provider/timing evidence from the main
// process where possible. Request bodies are never persisted raw — redacted.

import type { Page } from 'playwright-core';
import { redactPrivate } from './secret-redactor.ts';

export interface NetEvent {
  url: string; method: string; status?: number; startMs: number; firstByteMs?: number;
  requestId?: string; provider?: string;
}

export class NetworkRecorder {
  events: NetEvent[] = [];
  private origin = Number(process.hrtime.bigint());
  private now() { return (Number(process.hrtime.bigint()) - this.origin) / 1e6; }

  attach(win: Page) {
    win.on('request', (req) => {
      const url = req.url();
      if (/natively\.software|\/v1\/chat|api\./.test(url)) {
        this.events.push({ url: redactPrivate(url), method: req.method(), startMs: this.now() });
      }
    });
    win.on('response', (res) => {
      const url = res.url();
      const ev = this.events.find(e => e.url === redactPrivate(url) && e.status == null);
      if (ev) {
        ev.status = res.status();
        ev.firstByteMs = this.now();
        ev.requestId = res.headers()['x-request-id'] || res.headers()['cf-ray'] || '';
      }
    });
  }

  /** First /v1/chat-ish call's timing, if the renderer observed it. */
  firstChat(): NetEvent | undefined {
    return this.events.find(e => /\/v1\/chat|chat/.test(e.url));
  }
  toJSON() { return this.events.map(e => ({ ...e, url: redactPrivate(e.url) })); }
}
