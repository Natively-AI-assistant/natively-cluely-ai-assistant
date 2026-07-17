const BOTTOM_THRESHOLD = 8;
const SCROLL_ITEM_SELECTOR = "[data-scroll-item-id]";
const MAX_ANCHOR_ENTRIES = 8;

export function captureScrollAnchor(container) {
  if (!container) return null;

  const containerRect = container.getBoundingClientRect();
  const nodes = Array.from(container.querySelectorAll(SCROLL_ITEM_SELECTOR));
  const firstVisibleIndex = Math.max(
    nodes.findIndex(
      (node) => node.getBoundingClientRect().bottom > containerRect.top,
    ),
    0,
  );
  const entries = [];

  for (const node of nodes.slice(firstVisibleIndex)) {
    const id = node.dataset.scrollItemId;
    if (!id) continue;

    entries.push({
      id,
      offset: node.getBoundingClientRect().top - containerRect.top,
    });

    if (entries.length === MAX_ANCHOR_ENTRIES) break;
  }

  return {
    entries,
    wasAtBottom:
      container.scrollHeight - container.scrollTop - container.clientHeight <=
      BOTTOM_THRESHOLD,
  };
}

export function restoreScrollAnchor(container, snapshot) {
  if (!container || !snapshot) return;

  if (snapshot.wasAtBottom) {
    container.scrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    return;
  }

  const nodes = Array.from(container.querySelectorAll(SCROLL_ITEM_SELECTOR));

  for (const entry of snapshot.entries) {
    const node = nodes.find(
      (candidate) => candidate.dataset.scrollItemId === entry.id,
    );
    if (!node) continue;

    const delta =
      node.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      entry.offset;
    container.scrollTop += delta;
    return;
  }
}
