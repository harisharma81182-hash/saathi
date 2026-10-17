// Saathi's face shows one of these expressions. The model picks one for every reply by writing a
// small tag such as [face:proud] at the start of its text. The tag is removed before the user
// sees the text, and the face changes instead.

export const EXPRESSIONS = ['happy', 'excited', 'laughing', 'thinking', 'concerned', 'surprised', 'sleepy', 'proud', 'sorry'];
export const DEFAULT_EXPRESSION = 'happy';

const TAG = /\[face:\s*([a-z]+)\s*\]\s*/i;
const OPEN = '[face:';
const MAX_TAG_LENGTH = 24;

/**
 * Removes [face:...] tags from streamed text. Text arrives in small pieces, and a tag can be split
 * across two pieces ("[fa" + "ce:happy]"), so a piece that might be the start of a tag is held back
 * until the next piece shows whether it is one.
 *
 * push(chunk) returns the text that is safe to show now; onExpression fires when a tag is found.
 */
export class ExpressionFilter {
  constructor({ onExpression } = {}) {
    this.buffer = '';
    this.expression = null;
    this.onExpression = onExpression;
    this.skipSpace = false; // the space after a tag may arrive in the next piece
  }

  push(chunk) {
    if (this.skipSpace) {
      chunk = chunk.trimStart();
      if (!chunk) return '';
      this.skipSpace = false;
    }
    this.buffer += chunk;
    let out = '';
    for (;;) {
      const match = TAG.exec(this.buffer);
      if (!match) break;
      out += this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.skipSpace = this.buffer.length === 0;
      const name = match[1].toLowerCase();
      if (EXPRESSIONS.includes(name)) {
        this.expression = name;
        this.onExpression?.(name);
      }
    }
    // Hold back a possible unfinished tag at the end, e.g. "...done! [fac".
    const start = this.buffer.lastIndexOf('[');
    const tail = start === -1 ? '' : this.buffer.slice(start);
    const mightBeTag = tail && tail.length < MAX_TAG_LENGTH && !tail.includes(']') && (OPEN.startsWith(tail.toLowerCase()) || tail.toLowerCase().startsWith(OPEN));
    if (mightBeTag) {
      out += this.buffer.slice(0, start);
      this.buffer = tail;
    } else {
      out += this.buffer;
      this.buffer = '';
    }
    return out;
  }

  /** Call at the end: whatever was held back was not a tag after all. */
  flush() {
    const rest = this.buffer;
    this.buffer = '';
    return rest;
  }
}

/** Same as the filter, for a complete text (greetings, stored replies). */
export function splitExpression(text) {
  const filter = new ExpressionFilter();
  const clean = (filter.push(text) + filter.flush()).trim();
  return { text: clean, expression: filter.expression ?? DEFAULT_EXPRESSION };
}
