// Deciding what goes in each field. A pure reducer over field descriptors —
// no DOM, no network — so every rule below is assertable from plain `node`
// (test/plan.test.mjs) rather than only by loading a form in a browser.
//
// The tiers, in order. Each field takes the first one that answers it:
//
//   0  NEVER      SSN / bank / password-shaped questions. Not touched at all,
//                 and not even offered as something to answer in the sidebar.
//   0b SENSITIVE  work authorization, sponsorship, citizenship, clearance,
//                 criminal history, salary, EEO. Answered ONLY from a value the
//                 user themselves stored; otherwise handed back with a pointer
//                 to their profile. Never sent to the server, never inferred,
//                 never fuzzy-matched.
//   1  PROFILE    a deterministic synonym match onto the answer bank. No LLM.
//   2  RECALLED   a previously stored answer to this question (the server did
//                 the matching, exact or semantic).
//   3  AI         the server's single answer-mapping call.
//   4  ASK        required, and nothing above answered it.
//   5  SKIP       optional and unanswered, or already filled, or a document.
//
// The one thing this file must never do is produce a value it cannot justify.
// An empty field is visible to the user and costs them ten seconds; a wrong
// one is submitted silently.

import {
  bestOptionMatch,
  classifySensitive,
  findDeclineOption,
  isNeverFill,
  matchFieldKey,
  formatDateForField,
  splitPhone,
  looksLikeDecline,
} from './match.js';

export const AUTOFILL_MIN = 0.8;
export const SUGGEST_MIN = 0.5;

// Above this many characters a value is prose, and prose is never written in
// silently however confident the source: the v1 promise is that the user
// reviews before submitting, and a paragraph they did not read is the one thing
// they cannot review at a glance.
const PROSE_LENGTH = 180;
const PROSE_KEYS = new Set(['cover_letter', 'why_do_you_want_this_role']);

// Actions a row can end up with.
export const FILL = 'fill';         // write it, report as filled
export const SUGGEST = 'suggest';   // write it, report as needing review
export const ASK = 'ask';           // the user answers it in the sidebar
export const PROFILE = 'profile';   // the user answers it once, in their profile
export const DOCUMENT = 'document'; // a file upload, handled separately
export const SKIP = 'skip';         // deliberately left alone

/**
 * Decide every row. Returns a NEW array of decisions; `rows` is not mutated.
 *
 * @param rows    descriptors from discover.describeFields()
 * @param ctx     { answerBank, sensitiveAnswered, hasResume, hasCoverLetter }
 * @param server  { answers: {index: {value, source, confidence}}, ask: [] }
 *                — absent on the first (LLM-free) pass
 * @param state   { registry: {key: value}, userEdited: [keys] }
 */
export function decide(rows, ctx, server, state) {
  const bank = (ctx && ctx.answerBank) || {};
  const answered = (server && server.answers) || {};
  const registry = (state && state.registry) || {};
  const userEdited = new Set((state && state.userEdited) || []);

  return (rows || []).map((row, position) => {
    const d = base(row);

    // A field the person has touched themselves is never overwritten, whatever
    // we think we know. This has no equivalent in the server engine (nobody is
    // watching there) and is the single most important rule here: the user is
    // sitting in front of this form.
    if (userEdited.has(row.key)) {
      return done(d, SKIP, '', '', 0, 'you edited this');
    }

    // We wrote this field already this run and the page still shows a value.
    // All three conditions matter — see the server engine's registry rule: if
    // the form cleared it, or nothing actually landed, it must be filled again
    // rather than wrongly skipped.
    if (row.key && registry[row.key] !== undefined && row.filled && !row.invalid) {
      return done(d, SKIP, registry[row.key], 'profile', 1, 'already filled');
    }

    if (!row.readable) {
      return done(d, SKIP, '', '', 0, 'could not read this field');
    }

    // Tier 0 — never touched.
    if (isNeverFill(row.label)) {
      return done(d, SKIP, '', '', 0, 'we never fill this kind of field');
    }

    // Documents are attached, not typed.
    if (row.kind === 'file' || row.documentSlot) {
      const slot = row.documentSlot;
      const have = slot === 'cover_letter' ? (ctx && ctx.hasCoverLetter)
                 : slot === 'resume' ? (ctx && ctx.hasResume) : false;
      d.slot = slot;
      return have
        ? done(d, DOCUMENT, '', 'profile', 0.95, '')
        : done(d, ASK, '', '', 0,
               slot ? 'attach this yourself' : 'we could not tell which file this wants');
    }

    // Already filled by the page itself (an ATS that parsed the resume, or the
    // browser's own autofill). Left alone unless the form is rejecting it.
    if (row.filled && !row.invalid) {
      return done(d, SKIP, row.value, '', 0, 'already filled in');
    }

    // Tier 0b — sensitive. Stored value or nothing.
    const category = classifySensitive(row.label);
    if (category) {
      d.sensitive = category;
      const entry = matchFieldKey(row.label);
      const stored = entry && entry.sensitive ? bank[entry.key] : '';
      if (!stored) {
        return done(d, PROFILE, '', '', 0, profileHint(category));
      }
      const value = coerce(stored, row);
      if (value === null) {
        // We have their answer but this form offers no option matching it.
        return done(d, ASK, '', '', 0, `none of the options match your stored answer (${stored})`);
      }
      // An EEO field already showing a real answer must not be downgraded to a
      // "prefer not to say" — the server engine's anti-downgrade guard, applied
      // before the write rather than inside it.
      if (row.value && looksLikeDecline(value) && !looksLikeDecline(row.value)) {
        return done(d, SKIP, row.value, '', 0, 'keeping the answer already there');
      }
      return done(d, FILL, value, 'profile', 0.95, '');
    }

    // Tier 1 — deterministic profile match.
    const entry = matchFieldKey(row.label);
    if (entry && bank[entry.key]) {
      const value = coerce(bank[entry.key], row);
      if (value !== null) {
        const action = isProse(entry.key, value) ? SUGGEST : FILL;
        return done(d, action, value, 'profile', 0.95, '');
      }
    }

    // Tiers 2 and 3 — whatever the server answered.
    const fromServer = answered[String(row.serverIndex != null ? row.serverIndex : position)];
    if (fromServer && String(fromServer.value || '').trim()) {
      const value = coerce(fromServer.value, row);
      if (value !== null) {
        const confidence = Number(fromServer.confidence) || 0;
        const prose = isProse('', value);
        const action = (confidence >= AUTOFILL_MIN && !prose) ? FILL
                     : (confidence >= SUGGEST_MIN ? SUGGEST : ASK);
        return done(d, action, value, fromServer.source || 'ai', confidence,
                    fromServer.matchedQuestion
                      ? `from your answer to "${truncate(fromServer.matchedQuestion, 60)}"`
                      : '');
      }
    }

    // Tier 4 / 5.
    if (row.required) {
      return done(d, ASK, '', '', 0, 'we have no answer for this on file');
    }
    // Optional and unanswered. Skipped in the results, but some of these are
    // still worth one line in the server request:
    //
    //  - A consent or opt-in checkbox. The server engine's prompt carries a
    //    specific rule for these and a specific reason: an unanswered consent
    //    question the employer marks required blocks the whole submission, and
    //    "required" is not always in the markup.
    //  - A choice field, where the answer is one of a handful of listed options
    //    and costs a few tokens to ask about.
    //  - A field whose key we DID match but could not coerce onto this form's
    //    options ("B.Tech" against High School / Bachelor's / Master's). We know
    //    the answer; we just cannot map it, which is precisely what the model is
    //    for.
    const choice = row.kind === 'select' || row.kind === 'combobox'
                || row.kind === 'radio' || row.kind === 'checkbox';
    d.askable = looksLikeConsent(row.label) || choice || !!entry;
    return done(d, SKIP, '', '', 0, 'optional, and we have no answer for it');
  });
}

// Consent, opt-in and agreement checkboxes, which are frequently unmarked in the
// markup and required in practice.
const CONSENT_RE = new RegExp([
  /\bconsent\b|\bi agree\b|\bagree to\b|\baccept\b|\backnowledge\b/.source,
  /\bprivacy (policy|notice)\b|\bterms\b|\bgdpr\b/.source,
  /\bopt[ -]?in\b|\bsubscribe\b|\bmarketing\b|\bpromotional\b/.source,
  /\bupdates about\b|\btalent (pool|community|network)\b|\bfuture (roles|openings|opportunities)\b/.source,
  /\bcontact me\b|\bkeep me\b|\bnotify me\b/.source,
].join('|'), 'i');

export function looksLikeConsent(label) {
  return CONSENT_RE.test(String(label == null ? '' : label));
}

function base(row) {
  return {
    key: row.key,
    row,
    label: row.label,
    kind: row.kind,
    required: !!row.required,
    options: row.options || [],
    sensitive: null,
    slot: null,
  };
}

function done(d, action, value, source, confidence, reason) {
  d.action = action;
  d.value = value == null ? '' : String(value);
  d.source = source || '';
  d.confidence = confidence || 0;
  d.reason = reason || '';
  return d;
}

function isProse(key, value) {
  return PROSE_KEYS.has(key) || String(value).length > PROSE_LENGTH;
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function profileHint(category) {
  switch (category) {
    case 'work_authorization': return 'add your work authorization to your profile';
    case 'sponsorship': return 'add your sponsorship answer to your profile';
    case 'citizenship': return 'answer this one yourself';
    case 'clearance': return 'answer this one yourself';
    case 'criminal': return 'answer this one yourself';
    case 'salary': return 'add your salary expectation to your profile';
    case 'demographic': return 'set your voluntary disclosures in your profile';
    default: return 'answer this one yourself';
  }
}

/**
 * Shape a value for this specific control, or return null to refuse.
 *
 * Refusing is a first-class outcome. A field offering a fixed set of options
 * cannot be answered with a value that is not in it — the same stored value
 * cannot fit two employers' dropdowns for the "same" question, since one
 * company's location field is a country list and another's is "USA / Canada /
 * Elsewhere". Coercing regardless is how "India" gets typed into a menu that
 * never offered it; refusing turns that into a question for the user.
 */
export function coerce(value, row) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;

  if (row.kind === 'checkbox' || row.kind === 'radio') {
    return coerceChoice(text, row);
  }
  if (row.kind === 'select' || row.kind === 'combobox') {
    const options = (row.options || []).map(o => (typeof o === 'string' ? o : o.label));
    if (!options.length) return text;     // options unreadable: let the writer try
    const match = bestOptionMatch(text, options);
    if (match != null) return typeof match === 'string' ? match : match.label;
    return declineFallback(text, options);
  }

  const hints = row.hints || {};
  if (hints.type === 'date' || hints.type === 'month' || looksLikeDateField(row)) {
    const shaped = formatDateForField(text, hints);
    return shaped || null;   // unparseable: ask rather than write nonsense
  }
  if (hints.type === 'tel' || /phone|mobile|contact number/i.test(row.label || '')) {
    return shapePhone(text, row);
  }
  if (hints.type === 'number') {
    const numeric = text.replace(/[^\d.]/g, '');
    return numeric || null;
  }
  if (hints.maxLength && text.length > hints.maxLength) {
    // Truncating prose mid-sentence is worse than leaving it for the user.
    return text.length > PROSE_LENGTH ? null : text.slice(0, hints.maxLength);
  }
  return text;
}

/**
 * When the stored answer is "prefer not to say" and no option matches its
 * wording, take whatever option on THIS form means the same thing.
 *
 * Every employer words the opt-out differently — "Decline To Self Identify",
 * "I don't wish to answer", "I prefer not to say" — and none of those is close
 * enough to the others for a similarity ratio to link them (the shared words are
 * all stopwords). But the user's intent is unambiguous and the mapping is
 * one-to-one: there is at most one decline option in a list. The server engine
 * reaches the same conclusion with _find_decline_option.
 *
 * Only ever maps a decline ONTO a decline. It cannot turn a real answer into an
 * opt-out, which is the direction that would lose information the user gave us.
 */
function declineFallback(text, options) {
  if (!looksLikeDecline(text)) return null;
  const found = findDeclineOption(options);
  return found == null ? null : (typeof found === 'string' ? found : found.label);
}

function looksLikeDateField(row) {
  const hint = `${(row.hints && row.hints.placeholder) || ''} ${row.label || ''}`;
  return /\b(date|dd\s*\/\s*mm|mm\s*\/\s*dd|yyyy)\b/i.test(hint);
}

/**
 * A yes/no answer against the actual choices this control offers.
 *
 * A lone checkbox has no options, so "yes" means check it and anything else
 * means leave it. A radio group has real option labels, and a group whose
 * options are "Yes"/"No" must be answered by matching the label — not by
 * checking the first one.
 */
function coerceChoice(text, row) {
  const options = (row.options || []).map(o => (typeof o === 'string' ? o : o.label))
                                     .filter(Boolean);
  const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(text);
  if (!options.length || (options.length === 1 && row.kind === 'checkbox')) {
    return truthy ? 'yes' : null;
  }
  const match = bestOptionMatch(text, options);
  if (match) return typeof match === 'string' ? match : match.label;
  // "yes"/"no" against options worded differently ("I am authorized", "I am not").
  const polarity = truthy ? /\b(yes|i am|i do|i have)\b/i : /\b(no|not|n['’]t)\b/i;
  const found = options.find(o => polarity.test(o));
  return found || null;
}

function shapePhone(text, row) {
  const parts = splitPhone(text);
  // A separate country-code control next to this input means the number box
  // wants the national part only; otherwise it wants the whole thing.
  return row.hasCountryWidget ? (parts.national || text) : (parts.e164 || text);
}

// ── what to send to the server ───────────────────────────────

/**
 * The fields the server needs to help with, as the plan request's `fields`.
 *
 * Deliberately excludes sensitive fields entirely — not merely marks them. The
 * server refuses them again on arrival, but the cheapest way to guarantee a
 * question about someone's disability status is never answered by a language
 * model is for it never to leave the browser.
 */
export function fieldsForServer(decisions) {
  const out = [];
  decisions.forEach((d, i) => {
    // `askable` covers the optional fields still worth one line — see the end of
    // decide() for which and why.
    if (d.action !== ASK && !d.askable) return;
    if (d.sensitive || d.slot) return;
    if (isNeverFill(d.label)) return;
    if (classifySensitive(d.label)) return;     // belt and braces
    out.push({
      i,
      label: d.label,
      kind: d.kind,
      required: !!d.required,
      sensitive: false,
      documentSlot: null,
      options: (d.options || []).map(o => (typeof o === 'string' ? o : o.label))
                                .filter(Boolean).slice(0, 300),
    });
  });
  return out;
}

/** Does this page need a server round trip at all? */
export function needsServer(decisions) {
  return fieldsForServer(decisions).length > 0;
}

/** Counts for the sidebar header. */
export function summarize(decisions) {
  const counts = { fill: 0, suggest: 0, ask: 0, profile: 0, document: 0, skip: 0 };
  for (const d of decisions || []) counts[d.action] = (counts[d.action] || 0) + 1;
  return counts;
}
