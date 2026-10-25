/**
 * Builds the three normalized views the matcher works on.
 *
 * Every view character carries `[start, end)` offsets into the ORIGINAL string,
 * so a match found in any view can be masked and reported without touching a
 * surrogate pair or an NFKC expansion halfway.
 *
 *   canonical: NFKC, lowercase, traditional -> simplified. Separators kept.
 *   folded:    canonical + homoglyph/leet folding. Separators kept.
 *   compact:   folded with every non-letter/non-digit removed. Each character
 *              records how much raw text was skipped before it and whether a
 *              strong sentence terminator was crossed, which is what bounds
 *              CJK gap matching.
 */
const { TRADITIONAL_TO_SIMPLIFIED } = require('./scriptMap');
const {
  ZERO_WIDTH,
  CONTROL,
  foldChar,
  isWordChar,
  isSentenceBreak,
} = require('./fold');

function createView() {
  return { text: '', starts: [], ends: [] };
}

function append(view, char, start, end) {
  view.text += char;
  // Offsets are indexed by UTF-16 code unit (the same coordinate system regex
  // uses). A surrogate pair therefore gets two identical entries.
  for (let index = 0; index < char.length; index += 1) {
    view.starts.push(start);
    view.ends.push(end);
  }
}

function buildViews(input) {
  const raw = String(input ?? '');
  const canonical = createView();

  // canonical: iterate by code point so emoji and other astral characters get
  // a single [start, end) range covering both UTF-16 code units.
  for (let index = 0; index < raw.length;) {
    const codePoint = raw.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    const width = char.length;

    if (ZERO_WIDTH.test(char) || CONTROL.test(char)) {
      index += width;
      continue;
    }

    let normalized;
    try {
      normalized = char.normalize('NFKC');
    } catch {
      normalized = char;
    }
    normalized = normalized.toLowerCase();

    // NFKC may expand or contract. Every produced character maps back to the
    // whole original range, which keeps masking valid.
    for (const produced of normalized) {
      append(
        canonical,
        TRADITIONAL_TO_SIMPLIFIED.get(produced) || produced,
        index,
        index + width
      );
    }

    index += width;
  }

  // folded: 1:1 over canonical characters.
  const folded = createView();
  for (let index = 0; index < canonical.text.length; index += 1) {
    append(
      folded,
      foldChar(canonical.text[index]),
      canonical.starts[index],
      canonical.ends[index]
    );
  }

  // compact: letters and numbers only, with gap metadata.
  const compact = {
    text: '',
    starts: [],
    ends: [],
    gapBefore: [],
    sentenceBreakBefore: [],
  };

  let previousKeptEnd = 0;
  let crossedSentence = false;

  for (let index = 0; index < folded.text.length; index += 1) {
    const char = folded.text[index];

    if (!isWordChar(char)) {
      if (isSentenceBreak(char)) crossedSentence = true;
      continue;
    }

    const start = folded.starts[index];
    compact.text += char;
    compact.starts.push(start);
    compact.ends.push(folded.ends[index]);
    compact.gapBefore.push(Math.max(0, start - previousKeptEnd));
    compact.sentenceBreakBefore.push(crossedSentence);

    crossedSentence = false;
    previousKeptEnd = folded.ends[index];
  }

  return { raw, canonical, folded, compact };
}

/**
 * Maps a view range back to the original text range. Returns null for empty
 * ranges (behavioral hits have no span).
 */
function viewRange(view, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) return null;
  return { start: view.starts[start], end: view.ends[end - 1] };
}

module.exports = { buildViews, viewRange, createView };
