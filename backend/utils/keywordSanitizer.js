const KEYWORD_MAX_LEN = 200;
const KEYWORD_ALLOWED = /^[\p{L}\p{N}\s.,!?'"&@#:;/()\-]+$/u;

function sanitizeKeyword(raw) {
  if (typeof raw !== 'string') {
    throw new Error('Keyword must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Keyword cannot be empty');
  }
  if (trimmed.length > KEYWORD_MAX_LEN) {
    throw new Error(`Keyword exceeds ${KEYWORD_MAX_LEN} chars`);
  }
  if (trimmed.startsWith('-')) {
    throw new Error('Keyword cannot start with "-"');
  }
  if (!KEYWORD_ALLOWED.test(trimmed)) {
    throw new Error('Keyword contains disallowed characters');
  }
  return trimmed;
}

function sanitizeEmail(raw) {
  if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    throw new Error('Invalid email');
  }
  return raw;
}

module.exports = { sanitizeKeyword, sanitizeEmail, KEYWORD_MAX_LEN };
