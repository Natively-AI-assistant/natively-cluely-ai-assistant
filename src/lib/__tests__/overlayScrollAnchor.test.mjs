import assert from "node:assert/strict";
import test from "node:test";

import {
  captureScrollAnchor,
  restoreScrollAnchor,
} from "../overlayScrollAnchor.mjs";

function createNode(id, initialTop, height = 24) {
  let top = initialTop;

  return {
    dataset: { scrollItemId: id },
    getBoundingClientRect() {
      return { bottom: top + height, top };
    },
    setTop(nextTop) {
      top = nextTop;
    },
  };
}

function createContainer({
  clientHeight,
  initialNodes,
  scrollHeight,
  scrollTop,
  top = 0,
}) {
  let nodes = initialNodes;

  return {
    clientHeight,
    getBoundingClientRect() {
      return { bottom: top + clientHeight, top };
    },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-scroll-item-id]");
      return nodes;
    },
    scrollHeight,
    scrollTop,
    setNodes(nextNodes) {
      nodes = nextNodes;
    },
  };
}

test("captures the first visible item and restores its offset after reflow", () => {
  const above = createNode("above", 60, 30);
  const anchor = createNode("anchor", 120);
  const later = createNode("later", 160);
  const container = createContainer({
    clientHeight: 300,
    initialNodes: [above, anchor, later],
    scrollHeight: 800,
    scrollTop: 120,
    top: 100,
  });

  assert.equal(captureScrollAnchor(null), null);
  const snapshot = captureScrollAnchor(container);

  assert.deepEqual(snapshot, {
    entries: [
      { id: "anchor", offset: 20 },
      { id: "later", offset: 60 },
    ],
    wasAtBottom: false,
  });

  anchor.setTop(160);
  later.setTop(200);
  restoreScrollAnchor(container, snapshot);

  assert.equal(container.scrollTop, 160);
});

test("falls forward to the next captured item when the leading anchor is pruned", () => {
  const anchor = createNode("anchor", 20, 30);
  const next = createNode("next", 60, 30);
  const container = createContainer({
    clientHeight: 300,
    initialNodes: [anchor, next],
    scrollHeight: 900,
    scrollTop: 120,
  });
  const snapshot = captureScrollAnchor(container);

  container.setNodes([next]);
  next.setTop(30);
  restoreScrollAnchor(container, snapshot);

  assert.equal(container.scrollTop, 90);
});

test("restores a bottom-pinned snapshot to the actual new bottom", () => {
  const item = createNode("item", 280, 30);
  const container = createContainer({
    clientHeight: 300,
    initialNodes: [item],
    scrollHeight: 600,
    scrollTop: 298,
  });
  const snapshot = captureScrollAnchor(container);

  container.scrollHeight = 1300;
  container.scrollTop = 200;
  restoreScrollAnchor(container, snapshot);

  assert.equal(container.scrollTop, 1000);
});
