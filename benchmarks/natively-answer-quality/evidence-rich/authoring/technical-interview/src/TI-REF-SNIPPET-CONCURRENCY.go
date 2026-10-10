// Package quota tracks how many export units each tenant has consumed in the
// current window and decides whether another request may proceed.
package quota

import (
	"context"
	"sync"
	"time"
)

// Tracker holds one counter per tenant. The counters are cleared at the end
// of every window by Run.
type Tracker struct {
	mu     sync.RWMutex
	used   map[string]int
	limit  int
	window time.Duration
}

// NewTracker returns a Tracker that admits up to limit units per tenant in
// each window.
func NewTracker(limit int, window time.Duration) *Tracker {
	return &Tracker{
		used:   make(map[string]int),
		limit:  limit,
		window: window,
	}
}

// TryConsume reserves n units for tenant and reports whether the request may
// proceed. It is called from every HTTP handler goroutine.
func (t *Tracker) TryConsume(tenant string, n int) bool {
	if n <= 0 {
		return true
	}

	t.mu.RLock()
	used := t.used[tenant]
	t.mu.RUnlock()

	if used+n > t.limit {
		return false
	}

	t.mu.Lock()
	t.used[tenant] = used + n
	t.mu.Unlock()
	return true
}

// Remaining reports how many units tenant may still consume in this window.
func (t *Tracker) Remaining(tenant string) int {
	t.mu.RLock()
	defer t.mu.RUnlock()

	left := t.limit - t.used[tenant]
	if left < 0 {
		return 0
	}
	return left
}

// Snapshot returns a copy of the counters for the metrics exporter.
func (t *Tracker) Snapshot() map[string]int {
	t.mu.RLock()
	defer t.mu.RUnlock()

	out := make(map[string]int, len(t.used))
	for tenant, used := range t.used {
		out[tenant] = used
	}
	return out
}

// Refund gives n units back to tenant, for a request that failed before it
// did any work.
func (t *Tracker) Refund(tenant string, n int) {
	if n <= 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	left := t.used[tenant] - n
	if left < 0 {
		left = 0
	}
	t.used[tenant] = left
}

// Run clears every counter at the end of each window until ctx is cancelled.
func (t *Tracker) Run(ctx context.Context) {
	ticker := time.NewTicker(t.window)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.mu.Lock()
			t.used = make(map[string]int)
			t.mu.Unlock()
		}
	}
}
