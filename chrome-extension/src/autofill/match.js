// Pure matching / normalisation logic. No DOM, no network, no chrome.* —
// which is what makes every rule in here assertable from plain `node`
// (test/match.test.mjs) instead of only by loading a form in a browser.
//
// Most of this is a deliberate port of the server-side auto-apply engine's
// equivalents in auto_apply/browser.py and auto_apply/runner.py. Where a
// function looks needlessly fussy, the comment says which real failure it is
// fussy about — those were paid for once already and must not be re-learned.

// ── normalisation ────────────────────────────────────────────

/** auto_apply/profile.py question_signature(): the canonical key for a label. */
export function questionSignature(text) {
  let s = String(text == null ? '' : text).toLowerCase().trim();
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** browser.py _normalize_option_text(). */
export function normalizeOptionText(text) {
  let s = String(text == null ? '' : text).toLowerCase().trim();
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ── option matching ──────────────────────────────────────────

export const OPTION_MATCH_THRESHOLD = 0.55;

const PLACEHOLDER_OPTION_RE = /^(select|choose|please select)\b.*\.{0,3}$|^--+$/i;

/** Whether an option label is a placeholder rather than a real answer. */
export function isPlaceholderOption(label) {
  return PLACEHOLDER_OPTION_RE.test(String(label == null ? '' : label).trim());
}

/**
 * browser.py _commit_matches(): does the widget's displayed text actually
 * represent the option we asked for?
 *
 * Deliberately whole-word subset comparison, NOT a substring test and NOT a
 * similarity ratio. Both of those are far too loose for exactly the values
 * that go wrong: "india" is a substring of "british INDIAn ocean territory",
 * and "Austria" scores 0.75 against "Australia". The displayed text
 * legitimately carries extra decoration (a dial code, a flag, the label echoed
 * beside the value), so either side is allowed to carry extras.
 */
export function commitMatches(wanted, shown) {
  const want = new Set(normalizeOptionText(wanted).split(' ').filter(Boolean));
  const got = new Set(normalizeOptionText(shown).split(' ').filter(Boolean));
  if (!want.size) return true;
  if (!got.size) return false;
  return isSubset(want, got) || isSubset(got, want);
}

function isSubset(small, large) {
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

/**
 * Python difflib.SequenceMatcher(None, a, b).ratio(), reimplemented.
 *
 * This has to be difflib's actual measure (Ratcliff-Obershelp: recursively sum
 * the longest CONTIGUOUS matching blocks), not a more convenient stand-in. The
 * first version here used a longest-common-SUBSEQUENCE ratio, which is a
 * strictly more permissive metric — it disagreed with difflib on 114 of 515
 * sampled pairs and scored "canada" against "india" at 0.55 where difflib says
 * 0.18. Since OPTION_MATCH_THRESHOLD (0.55) was tuned against difflib on the
 * server, reusing that number with a looser metric silently turns "no option
 * fits, leave it for the user" into a confidently wrong click.
 *
 * difflib's autojunk heuristic is deliberately not implemented: it only
 * engages for sequences of 200+ elements, and these are form-option labels.
 */
export function similarity(a, b) {
  const s = String(a == null ? '' : a), t = String(b == null ? '' : b);
  if (!s.length && !t.length) return 1;
  if (!s.length || !t.length) return 0;
  return (2 * matchingBlockTotal(s, t)) / (s.length + t.length);
}

function matchingBlockTotal(a, b) {
  // Index of every position each character occupies in b, as difflib's b2j.
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    const arr = b2j.get(b[j]);
    if (arr) arr.push(j); else b2j.set(b[j], [j]);
  }

  // difflib.find_longest_match: the longest contiguous block, preferring the
  // earliest i, then the earliest j.
  const findLongest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      const indices = b2j.get(a[i]);
      if (indices) {
        for (let x = 0; x < indices.length; x++) {
          const j = indices[x];
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          next.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  };

  let total = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (!k) continue;
    total += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return total;
}

export const DECLINE_OPTION_MARKERS = [
  'decline', 'prefer not', 'rather not', 'not disclose',
  'not wish to', "don't wish to", 'not want to', "don't want to",
  'not to answer',
];

/**
 * browser.py _looks_like_decline(): a "prefer not to answer"-style non-answer.
 *
 * Matches on the shared "not ... answer" core rather than one fixed phrase per
 * variant — GitLab's real wording is "I do not want to answer", which an
 * earlier list covering only "do not wish" missed entirely. New phrasings for
 * the same underlying option should not need a marker added by hand each time
 * a different employer's copywriter words it slightly differently.
 */
export function looksLikeDecline(text) {
  const lowered = String(text == null ? '' : text).toLowerCase();
  return DECLINE_OPTION_MARKERS.some(m => lowered.includes(m));
}

export function findDeclineOption(options) {
  for (const opt of options || []) {
    if (looksLikeDecline(optLabel(opt))) return opt;
  }
  return null;
}

function optLabel(opt) {
  if (opt == null) return '';
  return typeof opt === 'string' ? opt : String(opt.label == null ? '' : opt.label);
}

/**
 * browser.py _best_option_match(): the option whose text best matches `value`,
 * or null when nothing clears OPTION_MATCH_THRESHOLD.
 *
 * Returning null on a weak match is the point — a non-match must never become
 * a wrong click. Exact normalised equality wins outright; otherwise the best
 * similarity ratio, with a 0.75 floor for containment either way (which is
 * what lets "Decline to self-identify" match a form's slightly differently
 * worded real option).
 *
 * `options` may be strings or {value,label} objects; the matching element is
 * returned in whatever shape it came in.
 */
export function bestOptionMatch(value, options) {
  const normValue = normalizeOptionText(value);
  const list = options || [];
  if (!normValue || !list.length) return null;

  for (const opt of list) {
    if (normalizeOptionText(optLabel(opt)) === normValue) return opt;
  }
  let best = null, bestScore = 0;
  for (const opt of list) {
    const normLabel = normalizeOptionText(optLabel(opt));
    if (!normLabel) continue;
    let score = similarity(normValue, normLabel);
    if (normLabel.includes(normValue) || normValue.includes(normLabel)) {
      score = Math.max(score, 0.75);
    }
    if (score > bestScore) { best = opt; bestScore = score; }
  }
  return bestScore >= OPTION_MATCH_THRESHOLD ? best : null;
}

// ── label equivalence ────────────────────────────────────────

// runner.py _LABEL_STOPWORDS: words carrying no identifying weight, so they
// don't count toward "these two labels name the same question".
export const LABEL_STOPWORDS = new Set((`
a an and any are as at be by can do does for from have has how i if in is it
me my no not of on or please provide select that the their this to us was we
what when where which who will with would you your now future
`).trim().split(/\s+/));

export function distinctive(label) {
  return new Set(
    questionSignature(label).split(' ').filter(t => t && !LABEL_STOPWORDS.has(t)));
}

/**
 * runner.py _labels_match(): whether two form labels name the same question.
 *
 * Deliberately NOT a similarity ratio. The EEO block is a set of labels that
 * differ by a single word — "What is your military status?" vs "What is your
 * disability status?" scores 0.85 on a ratio, and conflating those would fill
 * one with the other's answer. Token containment has no such failure: neither
 * is a subset of the other.
 *
 * At least two distinctive words are required, so a stopword-only or one-word
 * label can never match broadly.
 */
export function labelsMatch(a, b) {
  const na = questionSignature(a), nb = questionSignature(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = distinctive(a), db = distinctive(b);
  if (!da.size || !db.size) return false;
  const [small, large] = da.size <= db.size ? [da, db] : [db, da];
  return small.size >= 2 && isSubset(small, large);
}

// ── document slots ───────────────────────────────────────────

// runner.py _DOCUMENT_FIELD_MARKERS.
export const DOCUMENT_FIELD_MARKERS = [
  'cover letter', 'resume', 'cv', 'writing sample', 'attach', 'upload', 'document',
];

// runner.py _DOCUMENT_SLOT_MARKERS. Only these two are ever attached
// automatically; a Portfolio or Writing Sample label stays unmatched and is
// reported to the user as needing them.
const DOCUMENT_SLOT_MARKERS = [
  ['cover_letter', ['cover letter', 'coverletter']],
  ['resume', ['resum', 'cv', 'curriculum']],
];

export function documentSlotFor(label) {
  const lowered = String(label == null ? '' : label).toLowerCase();
  for (const [slot, markers] of DOCUMENT_SLOT_MARKERS) {
    if (markers.some(m => lowered.includes(m))) return slot;
  }
  return null;
}

// ── sensitive questions: the structural safety rule ──────────
//
// These categories are NEVER answered by inference, by an LLM, or by a fuzzy
// label match. They are answered only from a value the user themselves stored,
// looked up by an explicit synonym table, or else handed back to the user.
//
// This is the client-side half of the invariant stated in the module docstring
// of auto_apply/profile.py: a fabricated answer to "are you authorized to work
// in the US?" is a false declaration filed under the user's name, and a
// guessed salary figure or disability status is nobody's to guess. The server
// re-derives this classification independently and drops these fields from the
// LLM prompt entirely, so the model is never shown a field it could answer.

// Order matters only for which label the UI shows; every branch is equally
// locked. Note the deliberate \w* suffixes — an earlier version anchored on
// \bexpect\b and so missed "What are your salary expectations?", the single
// most common phrasing of the one question in here with a number for an answer.
export const SENSITIVE_PATTERNS = [
  // category, matcher (against the normalised signature)
  ['sponsorship', /\bsponsor\w*|\bvisa\b|\bh1b\b|\bh 1b\b|\bwork permit\b|\bimmigration status\b|\bopt\b|\bcpt\b/],
  ['work_authorization', new RegExp([
    /\bright to work\b/.source,                       // standalone, UK phrasing
    /\bwork (authori\w*|eligib\w*|status)\b/.source,   // "work authorization"
    /\bemployment eligib\w*/.source,
    /\b(authori[sz]\w*|eligib\w*) to (work|be employed)\b/.source,
    // The general shape: an eligibility word somewhere before a work word.
    /\b(authori[sz]\w*|eligib\w*|legal\w*)\b[\s\S]*\b(work|employ\w*)\b/.source,
  ].join('|'))],
  ['citizenship', /\bcitizen\w*|\bnationality\b|\bpermanent resident\b|\bgreen card\b/],
  ['clearance', /\bsecurity clearance\b|\bclearance level\b|\bpolygraph\b/],
  ['criminal', /\b(convict\w*|criminal|felony|misdemeanor|background check)\b/],
  ['salary', /\b(salary|compensation|pay|wage|rate|ctc)\b[\s\S]*\b(expect\w*|desir\w*|requir\w*|range|current|minimum)\b|\b(expect\w*|desir\w*|current|minimum)\b[\s\S]*\b(salary|compensation|pay|wage|rate|ctc)\b/],
  // The EEO block. browser.py _EEO_FIELD_MARKERS, as alternations.
  ['demographic', /\bgender\b|\brac(e|ial)\b|\bethnic\w*|\bveteran\b|\bmilitary\b|\bdisab\w*|\bpronoun\w*/],
  ['demographic', /\bhispanic\b|\blatino\b|\blgbtq?\b|\bsexual orientation\b|\btransgender\b/],
];

// browser.py _EEO_FIELD_MARKERS — kept separately because EEO fields have a
// behaviour the other sensitive categories don't: a stored "Decline to
// self-identify" is itself a legitimate answer, resolved against whatever
// wording this particular form offers.
export const EEO_FIELD_MARKERS = [
  'gender', 'race', 'ethnic', 'veteran', 'military', 'disab', 'pronoun',
  'hispanic', 'latino',
];

export function looksLikeEeoField(label) {
  const lowered = String(label == null ? '' : label).toLowerCase();
  return EEO_FIELD_MARKERS.some(m => lowered.includes(m));
}

/**
 * The sensitive category this label falls into, or null.
 *
 * Errs toward flagging: a false positive costs the user one question they
 * answer once and we remember forever, while a false negative is a fabricated
 * legal declaration. That asymmetry decides every borderline case here.
 */
export function classifySensitive(label) {
  const sig = questionSignature(label);
  if (!sig) return null;
  for (const [category, re] of SENSITIVE_PATTERNS) {
    if (re.test(sig)) return category;
  }
  return null;
}

// Fields we must never fill from any source, however confident. Unlike the
// sensitive categories these are not "ask the user in the sidebar" either —
// the extension simply has no business touching them.
const NEVER_FILL_PATTERNS = [
  /\bssn\b|\bsocial security\b|\bnational insurance\b|\btax id\b|\bpan (card|number)\b|\baadhaar\b/,
  /\biban\b|\bswift\b|\bsort code\b|\bcvv\b|\bcredit card\b|\bcard number\b/,
  /\b(bank|routing|account) (number|no|details)\b/,
  /\bpassword\b|\bpasscode\b|\bone time (code|password)\b|\botp\b/,
  /\bdate of birth\b|\bbirth date\b|\bbirthdate\b|\bdob\b/,
];

export function isNeverFill(label) {
  const sig = questionSignature(label);
  return NEVER_FILL_PATTERNS.some(re => re.test(sig));
}

/** Values that must never be captured into the learned-answers store. */
const SECRET_VALUE_PATTERNS = [
  /^\d{3}-?\d{2}-?\d{4}$/,                 // US SSN
  /^(?:\d[ -]*?){13,19}$/,                 // card-shaped
  /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i,       // IBAN
];

export function looksSecret(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  return SECRET_VALUE_PATTERNS.some(re => re.test(v));
}

// ── value shaping ────────────────────────────────────────────

/**
 * Split a phone number into its dial code and the national number.
 *
 * Needed because a form with a separate country-code widget rejects the full
 * "+91 98765 43210" pasted into the number box, and one without a widget needs
 * the whole thing. Only the leading "+<digits>" is treated as a dial code —
 * a number stored without one is returned unchanged rather than having a
 * country inferred for it.
 */
export function splitPhone(phone) {
  const raw = String(phone == null ? '' : phone).trim();
  const out = { dialCode: '', national: raw, e164: raw };
  if (!raw.startsWith('+')) return out;
  const digits = raw.slice(1).replace(/\D/g, '');
  if (!digits) return out;
  // Longest-first so +1 doesn't shadow +1-none and +91 isn't read as +9.
  const KNOWN = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39',
    '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '54', '55',
    '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84',
    '86', '90', '91', '92', '93', '94', '95', '98', '211', '212', '213', '234',
    '254', '353', '358', '359', '370', '371', '372', '380', '420', '421', '852',
    '880', '886', '966', '971', '972', '974', '977'];
  let dial = '';
  for (const code of KNOWN.slice().sort((a, b) => b.length - a.length)) {
    if (digits.startsWith(code)) { dial = code; break; }
  }
  if (!dial) return out;
  out.dialCode = '+' + dial;
  out.national = digits.slice(dial.length);
  out.e164 = '+' + digits;
  return out;
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Parse the date shapes resumes and profiles actually contain. Null if unsure. */
export function parseLooseDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  if (/^(present|current|now|immediately|asap)$/i.test(raw)) return null;

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);            // 2024-06-01
  if (m) return ymd(+m[1], +m[2], +m[3]);

  m = raw.match(/^(\d{4})-(\d{1,2})$/);                          // 2024-06
  if (m) return ymd(+m[1], +m[2], 1);

  m = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);          // 06/01/2024
  if (m) {
    // Ambiguous by design. A value > 12 in the first position can only be a
    // day; otherwise assume month-first, which is what US-hosted ATS forms
    // (the overwhelming majority) mean by it.
    const a = +m[1], bb = +m[2];
    return a > 12 ? ymd(+m[3], bb, a) : ymd(+m[3], a, bb);
  }

  m = raw.match(/^(\d{1,2})[/.](\d{4})$/);                       // 06/2024
  if (m) return ymd(+m[2], +m[1], 1);

  m = raw.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);             // Jun 2024
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[2], MONTHS[m[1].toLowerCase()], 1);

  m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // June 1, 2024
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);

  m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/); // 1 June 2024
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);

  m = raw.match(/^(\d{4})$/);                                    // 2024
  if (m) return ymd(+m[1], 1, 1);

  return null;
}

function ymd(y, mo, d) {
  if (!y || y < 1900 || y > 2100) return null;
  if (!mo || mo < 1 || mo > 12) return null;
  if (!d || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

const pad = n => String(n).padStart(2, '0');

/**
 * Render a date the way THIS field wants it, or '' when we cannot tell.
 *
 * Returning '' rather than a best guess matters: a garbage string in a date box
 * is worse than an empty one, because the form accepts it and the user does
 * not notice. The empty case is surfaced as "needs your answer" instead.
 */
export function formatDateForField(value, hints) {
  const d = parseLooseDate(value);
  if (!d) return '';
  const h = hints || {};
  const type = String(h.type || '').toLowerCase();

  if (type === 'date') return `${d.y}-${pad(d.m)}-${pad(d.d)}`;   // ISO, per spec
  if (type === 'month') return `${d.y}-${pad(d.m)}`;

  // Take the shape from whatever the field advertises.
  const hint = `${h.placeholder || ''} ${h.pattern || ''} ${h.format || ''}`.toLowerCase();
  if (/yyyy[-/.]mm[-/.]dd|iso/.test(hint)) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  if (/dd[-/.]mm[-/.]yyyy/.test(hint)) return `${pad(d.d)}/${pad(d.m)}/${d.y}`;
  if (/mm[-/.]yyyy/.test(hint)) return `${pad(d.m)}/${d.y}`;
  if (/mm[-/.]dd[-/.]yyyy/.test(hint)) return `${pad(d.m)}/${pad(d.d)}/${d.y}`;

  // No stated shape: MM/DD/YYYY, matching the US-hosted ATS majority.
  return `${pad(d.m)}/${pad(d.d)}/${d.y}`;
}

// ── field synonyms: label -> answer-bank key ─────────────────
//
// The deterministic tier. Each entry maps one answer_bank() key (see
// auto_apply/profile.py answer_bank) to the label wordings that mean it.
// Matching goes through labelsMatch(), so a synonym only needs to carry the
// distinctive words — "First Name" matches "What is your first name?" without
// an entry for the question form.
//
// `sensitive` entries are still listed: that is HOW a sensitive field gets
// answered at all, from a stored value and nothing else.
export const FIELD_SYNONYMS = [
  // identity
  { key: 'first_name', labels: ['first name', 'given name', 'forename', 'legal first name'] },
  { key: 'middle_name', labels: ['middle name', 'middle names', 'middle initial', 'legal middle name'] },
  { key: 'last_name', labels: ['last name', 'surname', 'family name', 'legal last name'] },
  { key: 'full_name', labels: ['full name', 'your name', 'name', 'legal name', 'candidate name'] },
  { key: 'preferred_name', labels: ['preferred name', 'nickname', 'preferred first name'] },
  { key: 'email', labels: ['email', 'email address', 'e mail', 'contact email'] },
  { key: 'phone', labels: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'contact number', 'cell'] },

  // location
  { key: 'location', labels: ['location', 'current location', 'where are you based', 'where do you live'] },
  // Line 1 / line 2 are their own keys. "address line 1" used to map to the
  // whole-address key, which held city+state+country — so a street box got a
  // place name.
  { key: 'address_line1', labels: ['address line 1', 'address line1', 'address 1', 'street address', 'street', 'street line 1'] },
  { key: 'address_line2', labels: ['address line 2', 'address line2', 'address 2', 'apartment', 'suite', 'street line 2'] },
  { key: 'address', labels: ['address', 'mailing address', 'full address', 'residential address', 'postal address'] },
  { key: 'address_city', labels: ['city', 'town', 'current city', 'city of residence'] },
  { key: 'address_state', labels: ['state', 'province', 'region', 'state province'] },
  { key: 'address_country', labels: ['country', 'country of residence'] },
  { key: 'postal_code', labels: ['zip', 'zip code', 'postal code', 'postcode', 'pin code'] },

  // links
  { key: 'linkedin_url', labels: ['linkedin', 'linkedin profile', 'linkedin url'] },
  { key: 'github_url', labels: ['github', 'github profile', 'github url'] },
  { key: 'portfolio_or_website', labels: ['portfolio', 'website', 'personal website', 'portfolio url', 'personal site', 'web site'] },

  // experience
  { key: 'current_job_title', labels: ['current title', 'current job title', 'current role', 'job title', 'most recent title', 'occupation'] },
  { key: 'current_company', labels: ['current company', 'current employer', 'most recent company', 'most recent employer', 'company name', 'employer'] },
  { key: 'years_of_experience', labels: ['years of experience', 'total experience', 'years experience', 'how many years of experience', 'relevant experience years'] },
  { key: 'top_skills', labels: ['skills', 'key skills', 'technical skills', 'core skills'] },

  // education
  { key: 'university', labels: ['university', 'college', 'school', 'institution', 'school name', 'university name', 'alma mater'] },
  { key: 'degree', labels: ['degree', 'degree type', 'highest degree', 'qualification', 'level of education'] },
  { key: 'major', labels: ['major', 'field of study', 'discipline', 'specialization', 'course of study', 'branch'] },
  { key: 'graduation_date', labels: ['graduation date', 'graduation year', 'year of graduation', 'expected graduation', 'end date of education', 'completion date'] },
  { key: 'gpa', labels: ['gpa', 'cgpa', 'grade point average', 'percentage marks', 'academic score'] },

  // logistics
  { key: 'notice_period', labels: ['notice period', 'how much notice', 'notice'] },
  { key: 'available_start_date', labels: ['start date', 'available start date', 'when can you start', 'earliest start date', 'availability date'] },
  { key: 'willing_to_relocate', labels: ['relocate', 'willing to relocate', 'open to relocation'] },
  { key: 'remote_work_preference', labels: ['remote preference', 'work preference', 'work arrangement', 'onsite or remote', 'hybrid preference'] },
  { key: 'how_did_you_hear_about_us', labels: ['how did you hear', 'how did you find', 'referral source', 'where did you hear about us', 'source'] },

  // narrative
  { key: 'why_do_you_want_this_role', labels: ['why this role', 'why do you want to work here', 'why are you interested', 'why us', 'why this company', 'motivation'] },
  { key: 'cover_letter', labels: ['cover letter', 'additional information', 'anything else', 'tell us about yourself', 'introduce yourself'] },

  // sensitive — stored answers only, never inferred
  { key: 'authorized_to_work_in_country', sensitive: true, labels: ['authorized to work', 'legally authorized to work', 'work authorization', 'eligible to work', 'employment eligibility', 'right to work'] },
  { key: 'requires_visa_sponsorship', sensitive: true, labels: ['require sponsorship', 'need sponsorship', 'visa sponsorship', 'require visa', 'sponsorship now or in the future'] },
  { key: 'visa_status', sensitive: true, labels: ['visa status', 'immigration status', 'work permit status', 'current visa'] },
  { key: 'expected_salary', sensitive: true, labels: ['expected salary', 'salary expectation', 'desired salary', 'compensation expectation', 'expected ctc', 'desired compensation'] },
  { key: 'gender', sensitive: true, labels: ['gender', 'gender identity'] },
  { key: 'race_ethnicity', sensitive: true, labels: ['race', 'ethnicity', 'race ethnicity', 'racial identity', 'hispanic or latino'] },
  { key: 'veteran_status', sensitive: true, labels: ['veteran status', 'military status', 'protected veteran', 'military service'] },
  { key: 'disability_status', sensitive: true, labels: ['disability status', 'disability', 'disabled'] },
  { key: 'gender_pronouns', sensitive: true, labels: ['pronouns', 'preferred pronouns'] },
  { key: 'lgbtq_identity', sensitive: true, labels: ['lgbtq', 'sexual orientation', 'transgender'] },
];

/**
 * Whether a synonym names the same thing as a form label.
 *
 * Deliberately NOT labelsMatch(). That function requires two distinctive words
 * on both sides, which is right for its job (reconciling a form's own
 * missing-field list, where the EEO labels differ by exactly one word) but
 * makes every one-word key here — University, City, Degree, GPA, Country —
 * permanently unmatchable against anything but itself.
 *
 * The rule instead: the synonym's distinctive words must all appear in the
 * label, and a ONE-word synonym additionally requires the label to be
 * essentially just that field name (at most one extra distinctive word). So
 * "University" matches "University / College" and "Current City", but not
 * "Name of your previous university supervisor" — which falls through to the
 * LLM tier rather than being answered with the wrong value.
 */
function synonymMatches(syn, label, entry) {
  const ds = distinctive(syn), dl = distinctive(label);
  if (!ds.size || !dl.size) return false;
  if (!isSubset(ds, dl)) return false;
  if (ds.size === 1) {
    // A one-word synonym may only absorb ONE extra word, and only a word that
    // does not change what is being asked for: a harmless qualifier ("Current
    // City", "Legal Name") or another word this same entry already accepts
    // ("University / College"). The earlier rule accepted ANY one extra word,
    // so the bare synonym "name" claimed "Middle Name" and filled it with the
    // person's full name — and would have done the same to "Manager Name",
    // "Reference Name" and "Company Name".
    if (dl.size > 2) return false;
    if (dl.size === 2) {
      const [word] = ds;
      const extra = [...dl].find(w => w !== word);
      const siblings = new Set();
      for (const s of (entry && entry.labels) || []) {
        for (const w of distinctive(s)) siblings.add(w);
      }
      if (!NEUTRAL_QUALIFIERS.has(extra) && !siblings.has(extra)) return false;
    }
  }
  return true;
}

// Words that can sit next to a one-word field name without changing the field.
const NEUTRAL_QUALIFIERS = new Set([
  'current', 'present', 'primary', 'legal', 'full', 'official', 'home', 'permanent',
  'personal', 'contact', 'main', 'preferred',
]);

/**
 * The answer-bank key this label asks for, or null.
 *
 * Exact-signature hits are taken first across ALL entries before any
 * containment match is considered. Without that ordering a bare "Country"
 * label can be claimed by a longer entry that merely contains it, and — worse
 * — "gender" would match before "gender identity" purely on list order.
 */
export function matchFieldKey(label) {
  const sig = questionSignature(label);
  if (!sig) return null;

  for (const entry of FIELD_SYNONYMS) {
    for (const syn of entry.labels) {
      if (questionSignature(syn) === sig) return entry;
    }
  }
  // Containment: prefer the most specific synonym that matches, measured by how
  // many distinctive words it pins down. Ties go to the earlier entry, so the
  // list order is the tiebreak and the more specific keys are listed first
  // within each group.
  let best = null, bestWeight = -1;
  for (const entry of FIELD_SYNONYMS) {
    for (const syn of entry.labels) {
      if (!synonymMatches(syn, label, entry)) continue;
      const weight = distinctive(syn).size;
      if (weight > bestWeight) { best = entry; bestWeight = weight; }
    }
  }
  return best;
}
