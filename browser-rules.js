// Safety rules for Orbit's browser control (pure, tested in test/browser-rules.test.js). browser.js asks
// these before every click or typing step; a page's own text decides nothing here except what is
// clicked, and anything that could spend money, sign in, post or delete waits for the user's click
// on a confirm card. Secrets are never typed at all.

// Words on a button/link (or its form) that mean the step does something you can't take back.
const RISKY =
  /\b(buy|pay|purchase|order|checkout|check out|place order|sign ?in|log ?in|sign ?up|register|post|send|publish|tweet|reply|comment|share|delete|remove|unsubscribe|subscribe|confirm|transfer|donate|book|reserve|install|download|accept|agree|allow)\b/i;

// Fields Orbit never types into, however it was asked.
const SECRET_FIELD =
  /pass(word|wd|code)?|pin\b|otp|one[- ]?time|2fa|cvv|cvc|csc|security code|card ?(number|no)|cc-|iban|routing|account ?number|ssn|social security|secret|api[-_ ]?key|token/i;

const SEARCH_FIELD = /search|query|\bq\b|find/i;

/** el: what browser.js read from the element ({ tag, type, role, name, id, label, autocomplete, text, inForm, formHasPassword }). */
function isSecretField(el = {}) {
  if (String(el.type).toLowerCase() === 'password') return true;
  const hint = [el.autocomplete, el.name, el.id, el.label, el.placeholder].filter(Boolean).join(' ');
  return SECRET_FIELD.test(hint);
}

const isSearchField = (el = {}) =>
  String(el.type).toLowerCase() === 'search' ||
  el.role === 'searchbox' ||
  SEARCH_FIELD.test([el.name, el.id, el.label, el.placeholder].filter(Boolean).join(' '));

/** Why a click needs the user's OK first, or '' if it's safe. */
function clickRisk(el = {}) {
  const words = [el.text, el.label, el.value].filter(Boolean).join(' ');
  const m = words.match(RISKY);
  if (m) return `"${m[0]}"`;
  if (el.formHasPassword) return 'a sign-in form';
  if (el.inForm && (String(el.type).toLowerCase() === 'submit' || el.tag === 'button')) return 'submitting a form';
  return '';
}

/** Why pressing Enter after typing needs the user's OK first ('' if safe). A search box is fine. */
function submitRisk(el = {}) {
  if (isSearchField(el)) return '';
  if (el.formHasPassword) return 'a sign-in form';
  return el.inForm ? 'submitting a form' : '';
}

const ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'option',
  'switch',
  'heading',
  'img',
  'listitem',
  'cell',
  'row',
]);
/** Only roles Playwright knows; anything else falls back to finding by text. */
const validRole = (role) => (ROLES.has(String(role)) ? String(role) : null);

/** http(s) only, like actions.openWebsite. Returns the URL string or null. */
function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

module.exports = { isSecretField, isSearchField, clickRisk, submitRisk, validRole, safeUrl };
