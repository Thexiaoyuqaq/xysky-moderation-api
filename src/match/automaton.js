/**
 * Minimal Aho-Corasick automaton.
 *
 * A single scan finds every dictionary occurrence in O(text length), which is
 * what lets the service stay well under a millisecond for typical chat lines.
 *
 * Patterns and text are scanned by UTF-16 code unit. Lexicon patterns are CJK
 * or ASCII, so they are never split mid-surrogate; astral characters simply act
 * as delimiters.
 */
class Automaton {
  constructor() {
    this.nodes = [Automaton.createNode()];
  }

  static createNode() {
    return { next: new Map(), fail: 0, outputs: [] };
  }

  add(pattern, payload) {
    if (typeof pattern !== 'string' || pattern.length === 0) return;

    let state = 0;
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index];
      let next = this.nodes[state].next.get(char);
      if (next === undefined) {
        next = this.nodes.length;
        this.nodes.push(Automaton.createNode());
        this.nodes[state].next.set(char, next);
      }
      state = next;
    }

    this.nodes[state].outputs.push({ pattern, payload });
  }

  build() {
    const queue = [];

    for (const next of this.nodes[0].next.values()) {
      this.nodes[next].fail = 0;
      queue.push(next);
    }

    for (let head = 0; head < queue.length; head += 1) {
      const state = queue[head];

      for (const [char, next] of this.nodes[state].next) {
        let fail = this.nodes[state].fail;
        while (fail !== 0 && !this.nodes[fail].next.has(char)) {
          fail = this.nodes[fail].fail;
        }
        const fallback = this.nodes[fail].next.get(char);
        this.nodes[next].fail = fallback !== undefined && fallback !== next ? fallback : 0;
        this.nodes[next].outputs.push(...this.nodes[this.nodes[next].fail].outputs);
        queue.push(next);
      }
    }

    return this;
  }

  /**
   * @returns {Array<{start:number,end:number,pattern:string,payload:any}>}
   */
  search(text) {
    const hits = [];
    let state = 0;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      while (state !== 0 && !this.nodes[state].next.has(char)) {
        state = this.nodes[state].fail;
      }

      const next = this.nodes[state].next.get(char);
      state = next === undefined ? 0 : next;

      for (const output of this.nodes[state].outputs) {
        hits.push({
          start: index - output.pattern.length + 1,
          end: index + 1,
          pattern: output.pattern,
          payload: output.payload,
        });
      }
    }

    return hits;
  }
}

module.exports = { Automaton };
