import {
  longestStreak
} from "./chunk-O7RNMSX7.js";
import {
  codes,
  constants,
  factorySpace,
  markdownLineEnding,
  ok,
  types
} from "./chunk-WCJMOQU6.js";
import {
  katex
} from "./chunk-5AU2BCZV.js";
import "./chunk-EWTE5DHJ.js";

// node_modules/mdast-util-math/lib/index.js
function mathFromMarkdown() {
  return {
    enter: {
      mathFlow: enterMathFlow,
      mathFlowFenceMeta: enterMathFlowMeta,
      mathText: enterMathText
    },
    exit: {
      mathFlow: exitMathFlow,
      mathFlowFence: exitMathFlowFence,
      mathFlowFenceMeta: exitMathFlowMeta,
      mathFlowValue: exitMathData,
      mathText: exitMathText,
      mathTextData: exitMathData
    }
  };
  function enterMathFlow(token) {
    const code = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-math", "math-display"] },
      children: []
    };
    this.enter(
      {
        type: "math",
        meta: null,
        value: "",
        data: { hName: "pre", hChildren: [code] }
      },
      token
    );
  }
  function enterMathFlowMeta() {
    this.buffer();
  }
  function exitMathFlowMeta() {
    const data = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node.type === "math");
    node.meta = data;
  }
  function exitMathFlowFence() {
    if (this.data.mathFlowInside) return;
    this.buffer();
    this.data.mathFlowInside = true;
  }
  function exitMathFlow(token) {
    const data = this.resume().replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
    const node = this.stack[this.stack.length - 1];
    ok(node.type === "math");
    this.exit(token);
    node.value = data;
    const code = (
      /** @type {HastElement} */
      node.data.hChildren[0]
    );
    ok(code.type === "element");
    ok(code.tagName === "code");
    code.children.push({ type: "text", value: data });
    this.data.mathFlowInside = void 0;
  }
  function enterMathText(token) {
    this.enter(
      {
        type: "inlineMath",
        value: "",
        data: {
          hName: "code",
          hProperties: { className: ["language-math", "math-inline"] },
          hChildren: []
        }
      },
      token
    );
    this.buffer();
  }
  function exitMathText(token) {
    const data = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node.type === "inlineMath");
    this.exit(token);
    node.value = data;
    const children = (
      /** @type {Array<HastElementContent>} */
      // @ts-expect-error: we defined it in `enterMathFlow`.
      node.data.hChildren
    );
    children.push({ type: "text", value: data });
  }
  function exitMathData(token) {
    this.config.enter.data.call(this, token);
    this.config.exit.data.call(this, token);
  }
}
function mathToMarkdown(options) {
  let single = (options || {}).singleDollarTextMath;
  if (single === null || single === void 0) {
    single = true;
  }
  inlineMath.peek = inlineMathPeek;
  return {
    unsafe: [
      { character: "\r", inConstruct: "mathFlowMeta" },
      { character: "\n", inConstruct: "mathFlowMeta" },
      {
        character: "$",
        after: single ? void 0 : "\\$",
        inConstruct: "phrasing"
      },
      { character: "$", inConstruct: "mathFlowMeta" },
      { atBreak: true, character: "$", after: "\\$" }
    ],
    handlers: { math: math2, inlineMath }
  };
  function math2(node, _, state, info) {
    const raw = node.value || "";
    const tracker = state.createTracker(info);
    const sequence = "$".repeat(Math.max(longestStreak(raw, "$") + 1, 2));
    const exit = state.enter("mathFlow");
    let value = tracker.move(sequence);
    if (node.meta) {
      const subexit = state.enter("mathFlowMeta");
      value += tracker.move(
        state.safe(node.meta, {
          after: "\n",
          before: value,
          encode: ["$"],
          ...tracker.current()
        })
      );
      subexit();
    }
    value += tracker.move("\n");
    if (raw) {
      value += tracker.move(raw + "\n");
    }
    value += tracker.move(sequence);
    exit();
    return value;
  }
  function inlineMath(node, _, state) {
    let value = node.value || "";
    let size = 1;
    if (!single) size++;
    while (new RegExp("(^|[^$])" + "\\$".repeat(size) + "([^$]|$)").test(value)) {
      size++;
    }
    const sequence = "$".repeat(size);
    if (
      // Contains non-space.
      /[^ \r\n]/.test(value) && // Starts with space and ends with space.
      (/^[ \r\n]/.test(value) && /[ \r\n]$/.test(value) || // Starts or ends with dollar.
      /^\$|\$$/.test(value))
    ) {
      value = " " + value + " ";
    }
    let index = -1;
    while (++index < state.unsafe.length) {
      const pattern = state.unsafe[index];
      if (!pattern.atBreak) continue;
      const expression = state.compilePattern(pattern);
      let match;
      while (match = expression.exec(value)) {
        let position = match.index;
        if (value.codePointAt(position) === 10 && value.codePointAt(position - 1) === 13) {
          position--;
        }
        value = value.slice(0, position) + " " + value.slice(match.index + 1);
      }
    }
    return sequence + value + sequence;
  }
  function inlineMathPeek() {
    return "$";
  }
}

// node_modules/micromark-extension-math/dev/lib/math-flow.js
var mathFlow = {
  tokenize: tokenizeMathFenced,
  concrete: true,
  name: "mathFlow"
};
var nonLazyContinuation = {
  tokenize: tokenizeNonLazyContinuation,
  partial: true
};
function tokenizeMathFenced(effects, ok2, nok) {
  const self = this;
  const tail = self.events[self.events.length - 1];
  const initialSize = tail && tail[1].type === types.linePrefix ? tail[2].sliceSerialize(tail[1], true).length : 0;
  let sizeOpen = 0;
  return start;
  function start(code) {
    ok(code === codes.dollarSign, "expected `$`");
    effects.enter("mathFlow");
    effects.enter("mathFlowFence");
    effects.enter("mathFlowFenceSequence");
    return sequenceOpen(code);
  }
  function sequenceOpen(code) {
    if (code === codes.dollarSign) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen < 2) {
      return nok(code);
    }
    effects.exit("mathFlowFenceSequence");
    return factorySpace(effects, metaBefore, types.whitespace)(code);
  }
  function metaBefore(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return metaAfter(code);
    }
    effects.enter("mathFlowFenceMeta");
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return meta(code);
  }
  function meta(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.chunkString);
      effects.exit("mathFlowFenceMeta");
      return metaAfter(code);
    }
    if (code === codes.dollarSign) {
      return nok(code);
    }
    effects.consume(code);
    return meta;
  }
  function metaAfter(code) {
    effects.exit("mathFlowFence");
    if (self.interrupt) {
      return ok2(code);
    }
    return effects.attempt(
      nonLazyContinuation,
      beforeNonLazyContinuation,
      after
    )(code);
  }
  function beforeNonLazyContinuation(code) {
    return effects.attempt(
      { tokenize: tokenizeClosingFence, partial: true },
      after,
      contentStart
    )(code);
  }
  function contentStart(code) {
    return (initialSize ? factorySpace(
      effects,
      beforeContentChunk,
      types.linePrefix,
      initialSize + 1
    ) : beforeContentChunk)(code);
  }
  function beforeContentChunk(code) {
    if (code === codes.eof) {
      return after(code);
    }
    if (markdownLineEnding(code)) {
      return effects.attempt(
        nonLazyContinuation,
        beforeNonLazyContinuation,
        after
      )(code);
    }
    effects.enter("mathFlowValue");
    return contentChunk(code);
  }
  function contentChunk(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit("mathFlowValue");
      return beforeContentChunk(code);
    }
    effects.consume(code);
    return contentChunk;
  }
  function after(code) {
    effects.exit("mathFlow");
    return ok2(code);
  }
  function tokenizeClosingFence(effects2, ok3, nok2) {
    let size = 0;
    ok(self.parser.constructs.disable.null, "expected `disable.null`");
    return factorySpace(
      effects2,
      beforeSequenceClose,
      types.linePrefix,
      self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : constants.tabSize
    );
    function beforeSequenceClose(code) {
      effects2.enter("mathFlowFence");
      effects2.enter("mathFlowFenceSequence");
      return sequenceClose(code);
    }
    function sequenceClose(code) {
      if (code === codes.dollarSign) {
        size++;
        effects2.consume(code);
        return sequenceClose;
      }
      if (size < sizeOpen) {
        return nok2(code);
      }
      effects2.exit("mathFlowFenceSequence");
      return factorySpace(effects2, afterSequenceClose, types.whitespace)(code);
    }
    function afterSequenceClose(code) {
      if (code === codes.eof || markdownLineEnding(code)) {
        effects2.exit("mathFlowFence");
        return ok3(code);
      }
      return nok2(code);
    }
  }
}
function tokenizeNonLazyContinuation(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    if (code === null) {
      return ok2(code);
    }
    ok(markdownLineEnding(code), "expected eol");
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return lineStart;
  }
  function lineStart(code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok2(code);
  }
}

// node_modules/micromark-extension-math/dev/lib/math-text.js
function mathText(options) {
  const options_ = options || {};
  let single = options_.singleDollarTextMath;
  if (single === null || single === void 0) {
    single = true;
  }
  return {
    tokenize: tokenizeMathText,
    resolve: resolveMathText,
    previous,
    name: "mathText"
  };
  function tokenizeMathText(effects, ok2, nok) {
    const self = this;
    let sizeOpen = 0;
    let size;
    let token;
    return start;
    function start(code) {
      ok(code === codes.dollarSign, "expected `$`");
      ok(previous.call(self, self.previous), "expected correct previous");
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      return sequenceOpen(code);
    }
    function sequenceOpen(code) {
      if (code === codes.dollarSign) {
        effects.consume(code);
        sizeOpen++;
        return sequenceOpen;
      }
      if (sizeOpen < 2 && !single) {
        return nok(code);
      }
      effects.exit("mathTextSequence");
      return between(code);
    }
    function between(code) {
      if (code === codes.eof) {
        return nok(code);
      }
      if (code === codes.dollarSign) {
        token = effects.enter("mathTextSequence");
        size = 0;
        return sequenceClose(code);
      }
      if (code === codes.space) {
        effects.enter("space");
        effects.consume(code);
        effects.exit("space");
        return between;
      }
      if (markdownLineEnding(code)) {
        effects.enter(types.lineEnding);
        effects.consume(code);
        effects.exit(types.lineEnding);
        return between;
      }
      effects.enter("mathTextData");
      return data(code);
    }
    function data(code) {
      if (code === codes.eof || code === codes.space || code === codes.dollarSign || markdownLineEnding(code)) {
        effects.exit("mathTextData");
        return between(code);
      }
      effects.consume(code);
      return data;
    }
    function sequenceClose(code) {
      if (code === codes.dollarSign) {
        effects.consume(code);
        size++;
        return sequenceClose;
      }
      if (size === sizeOpen) {
        effects.exit("mathTextSequence");
        effects.exit("mathText");
        return ok2(code);
      }
      token.type = "mathTextData";
      return data(code);
    }
  }
}
function resolveMathText(events) {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  let index;
  let enter;
  if ((events[headEnterIndex][1].type === types.lineEnding || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === types.lineEnding || events[tailExitIndex][1].type === "space")) {
    index = headEnterIndex;
    while (++index < tailExitIndex) {
      if (events[index][1].type === "mathTextData") {
        events[tailExitIndex][1].type = "mathTextPadding";
        events[headEnterIndex][1].type = "mathTextPadding";
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }
  index = headEnterIndex - 1;
  tailExitIndex++;
  while (++index <= tailExitIndex) {
    if (enter === void 0) {
      if (index !== tailExitIndex && events[index][1].type !== types.lineEnding) {
        enter = index;
      }
    } else if (index === tailExitIndex || events[index][1].type === types.lineEnding) {
      events[enter][1].type = "mathTextData";
      if (index !== enter + 2) {
        events[enter][1].end = events[index - 1][1].end;
        events.splice(enter + 2, index - enter - 2);
        tailExitIndex -= index - enter - 2;
        index = enter + 2;
      }
      enter = void 0;
    }
  }
  return events;
}
function previous(code) {
  return code !== codes.dollarSign || this.events[this.events.length - 1][1].type === types.characterEscape;
}

// node_modules/micromark-extension-math/dev/lib/syntax.js
function math(options) {
  return {
    flow: { [codes.dollarSign]: mathFlow },
    text: { [codes.dollarSign]: mathText(options) }
  };
}

// node_modules/micromark-extension-math/dev/lib/html.js
var renderToString = katex.renderToString;

// node_modules/remark-math/lib/index.js
var emptyOptions = {};
function remarkMath(options) {
  const self = (
    /** @type {Processor} */
    this
  );
  const settings = options || emptyOptions;
  const data = self.data();
  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);
  const toMarkdownExtensions = data.toMarkdownExtensions || (data.toMarkdownExtensions = []);
  micromarkExtensions.push(math(settings));
  fromMarkdownExtensions.push(mathFromMarkdown());
  toMarkdownExtensions.push(mathToMarkdown(settings));
}
export {
  remarkMath as default
};
//# sourceMappingURL=remark-math.js.map
