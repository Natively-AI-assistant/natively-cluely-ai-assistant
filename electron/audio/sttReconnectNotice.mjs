// electron/audio/sttReconnectNotice.mjs
//
// When "Transcription Reconnecting" is worth saying (2026-11-09).
//
// main.ts sent `reconnecting` on the FIRST retryable error of a channel, and
// the streaming providers raise one for every dropped socket (NativelyProSTT
// emits `error` on each WebSocket error, ahead of its own warn-after-5-attempts
// signal). A socket that drops and is back a second later flashed a yellow
// banner over a live call. The notice now waits: it is shown only when the
// channel has not recovered within `delayMs`, or at once when the provider
// says the outage is sustained (NativelyProSTT 'persistent-reconnect').
// Anything that settles the channel first (a reconnect, a final transcript, a
// stand-in taking over, a failure, a teardown) cancels the pending show.
//
// One instance per STT channel (main.ts builds one per provider instance).
// Pure apart from the injected timer, so the tests drive it with a fake clock.

/** How long a retryable error waits before it is shown as "reconnecting". */
export const STT_RECONNECT_NOTICE_DELAY_MS = 5_000;

export class SttReconnectNotice {
  /**
   * @param {{
   *   show: (payload: any) => boolean | void,   sends the notice; return false to decline (nothing shown)
   *   delayMs?: number,
   *   setTimer?: (fn: () => void, ms: number) => any,
   *   clearTimer?: (handle: any) => void,
   * }} opts
   */
  constructor(opts) {
    this._show = opts.show;
    this._delayMs = opts.delayMs ?? STT_RECONNECT_NOTICE_DELAY_MS;
    this._setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this._clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
    this._timer = null;
    this._latest = null;
    this.showing = false;
  }

  /** True while a show is scheduled and has not fired or been cancelled. */
  get pending() {
    return this._timer !== null;
  }

  /**
   * A retryable error. Already showing: the notice is refreshed at once (the
   * attempt count moved). Otherwise it is shown only if nothing settles the
   * channel within the delay; later errors in the wait only update what it says.
   */
  retrying(payload) {
    this._latest = payload;
    if (this.showing) {
      this._emit(payload);
      return;
    }
    if (this._timer !== null) return;
    this._timer = this._setTimer(() => {
      this._timer = null;
      const latest = this._latest;
      this._latest = null;
      if (latest) this._emit(latest);
    }, this._delayMs);
  }

  /** The provider says the outage is sustained: shown now, whatever the wait. */
  persistent(payload) {
    this._cancelTimer();
    this._latest = null;
    this._emit(payload);
  }

  /**
   * The channel recovered, failed, or was handed over or torn down: a pending
   * show is cancelled. Returns whether the notice had been shown, so the caller
   * knows a recovery has to be announced.
   */
  settle() {
    this._cancelTimer();
    this._latest = null;
    const was = this.showing;
    this.showing = false;
    return was;
  }

  _emit(payload) {
    if (this._show(payload) === false) return;
    this.showing = true;
  }

  _cancelTimer() {
    if (this._timer !== null) {
      this._clearTimer(this._timer);
      this._timer = null;
    }
  }
}
