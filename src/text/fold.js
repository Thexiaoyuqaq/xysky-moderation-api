/**
 * Character folding used by the matcher.
 *
 * Two directions matter:
 *   - canonical: NFKC + lowercase + traditional->simplified, separators kept.
 *     Rules (phone numbers, URLs, contacts) run on this view.
 *   - folded: canonical + homoglyph/leet folding. Latin words run on this view,
 *     so `ｓｈ１ｔ` and Cyrillic lookalikes match while numbers stay meaningful
 *     for the rule engine.
 */
const ZERO_WIDTH = new RegExp("[­᠎​-‏‪-‮⁠-⁤﻿]", "u");
// Control characters are exactly what this pattern is meant to strip.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

// Only strong sentence terminators stop a CJK match from spanning across them.
// Normal punctuation and newlines are treated as intra-message gaps, because
// `傻。逼` / `傻 逼` are the same evasion in chat.
const SENTENCE_BREAK = /[。．！？!?；;]/u;

// True for characters that participate in compact matching.
const WORD_CHAR = /[\p{L}\p{N}]/u;

const CONFUSABLES = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
  'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j',
  'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ӏ': 'l', 'ԛ': 'q', 'ѵ': 'v', 'ɡ': 'g',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w',
  // Latin extensions / small caps
  'ı': 'i', 'ȷ': 'j', 'ʟ': 'l', 'ꜱ': 's', 'ᴡ': 'w', 'ᴄ': 'c', 'ᴠ': 'v',
  'ᴢ': 'z', 'ᴏ': 'o', 'ᴜ': 'u', 'ɪ': 'i', 'ɴ': 'n', 'ᴍ': 'm',
};

const LEET = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g',
  '@': 'a', '$': 's', '!': 'i',
};

function foldChar(char) {
  const lower = char.toLowerCase();
  return CONFUSABLES[lower] || LEET[lower] || lower;
}

function isAsciiAlnum(char) {
  return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
}

function isWordChar(char) {
  return WORD_CHAR.test(char);
}

function isSentenceBreak(char) {
  return SENTENCE_BREAK.test(char);
}

module.exports = {
  ZERO_WIDTH,
  CONTROL,
  SENTENCE_BREAK,
  CONFUSABLES,
  LEET,
  foldChar,
  isAsciiAlnum,
  isWordChar,
  isSentenceBreak,
};
