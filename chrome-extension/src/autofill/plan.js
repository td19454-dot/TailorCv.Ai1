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
  normalizeOptionText,
  classifySensitive,
  findDeclineOption,
  isNeverFill,
  matchFieldKey,
  formatDateForField,
  splitPhone,
  looksLikeDecline,
  EEO_GROUPS,
  eeoGroup,
  eeoShapes,
  eeoOptionAllowed,
  READ_FIRST_KEYS,
  looksLikeOpaqueId,
  stripRegionSuffix,
  isMotivationQuestion,
  isConditionalFollowUp,
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

    // We could not read the question — only its internal id. Never sent to the
    // model (it would be guessing) and never filled: the person answers it.
    if (looksLikeOpaqueId(row.label)) {
      d.noServer = true;
      return row.required
        ? done(d, ASK, '', '', 0, "we couldn't read this question — please answer it")
        : done(d, SKIP, '', '', 0, "we couldn't read this question");
    }

    // Tier 0 — never touched.
    if (isNeverFill(row.label)) {
      return done(d, SKIP, '', '', 0, 'we never fill this kind of field');
    }

    // Documents are attached, not typed.
    if (row.kind === 'file' || row.documentSlot) {
      // Already holds a document — one the person uploaded (often tailored for
      // this job) or the ATS kept. Never replaced with the base resume, and not
      // reported: nothing happened here worth a line in the results.
      if (row.filled) return done(d, SKIP, '', '', 0, 'already has a file');
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
        // Only point at the profile when the profile has a place for it.
        // Citizenship, clearance and criminal-history questions don't: they are
        // worded too differently per employer to hold one stored answer, so the
        // person answers them here, on this form.
        // A specific profile field (nationality) counts as a place for it too.
        // A demographic question the profile has no field for ("Are you a
        // military spouse?") is the person's to answer here, not a profile task.
        const onProfile = (PROFILE_CATEGORIES.has(category) && (category !== 'demographic' || !!entry))
                          || !!(entry && entry.sensitive);
        return onProfile
          ? done(d, PROFILE, '', '', 0, profileHint(category, entry))
          : done(d, ASK, '', '', 0, 'we never guess this — choose your answer');
      }
      // The stored answer, in whatever wording this form offers for it. Still
      // only ever THEIR answer — the shapes widen it ("South Asian" ->
      // "Asian"), never narrow or invent one, and a value belonging to no
      // known group is matched exactly as before.
      const shapes = candidatesFor(entry ? entry.key : '', stored, bank);
      if (shapes.length > 1) d.candidates = shapes;
      // The writer re-picks from the OPEN list with this same coerce(), since
      // most EEO dropdowns only show their options once opened.
      if (entry && READ_FIRST_KEYS.has(entry.key)) d.readFirst = { key: entry.key, stored };
      const value = coerce(stored, Object.assign({}, row,
        { candidates: shapes, candidateKey: entry ? entry.key : '' }));
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

    // "If you answered Yes above, please explain": autofill answered the
    // question above itself, and has nothing true to add here. Never sent to the
    // model, which would otherwise invent an explanation.
    if (isConditionalFollowUp(row.label)) {
      d.noServer = true;
      return row.required
        ? done(d, ASK, '', '', 0, 'only needed for some answers to the question above')
        : done(d, SKIP, '', '', 0, 'only needed if you answered Yes above');
    }

    // "Why Anthropic?", "Why this role?", a cover-letter box: written for THIS
    // job by the server from the resume and the posting — never a stored
    // sentence pasted in — and always left for review.
    if (isMotivationQuestion(row.label, row.kind)) {
      d.compose = true;
      const written = answered[String(row.serverIndex != null ? row.serverIndex : position)];
      const text = written ? String(written.value || '').trim() : '';
      if (text) {
        return done(d, SUGGEST, text, written.source || 'ai_written',
                    Number(written.confidence) || 0.55, 'written for this job — read it before you submit');
      }
      d.askable = true;
      return row.required
        ? done(d, ASK, '', '', 0, 'needs an answer written for this job')
        : done(d, SKIP, '', '', 0, 'optional — no answer written yet');
    }

    // "By selecting the checkbox, you agree to our Terms and Conditions and
    // Privacy Policy": with the profile's standing permission on, it is ticked
    // straight from that, the same on every form, no model involved. With it
    // off (the default) the box goes through the usual consent handling below.
    if (row.kind === 'checkbox' && looksLikeTermsAgreement(row.label)
        && bank.accepts_employer_terms_and_privacy_policy === 'Yes') {
      const value = coerce('yes', row);
      if (value !== null) {
        return done(d, FILL, value, 'profile', 0.95, "you allowed agreeing to employers' terms");
      }
    }

    // Tier 1 — deterministic profile match.
    const entry = matchFieldKey(row.label);
    if (entry && bank[entry.key]) {
      const raw = entry.key === 'middle_name' && /\binitial\b/i.test(row.label)
        ? String(bank[entry.key]).trim().charAt(0).toUpperCase()
        : bank[entry.key];
      // Built BEFORE coerce so it can weigh every shape against the options.
      // Passed on a COPY of the row: decide() is a pure reducer over the
      // descriptors and is re-run on every pass, so it must not write to them.
      // Only when there is genuinely more than one shape. A phone number's
      // single candidate is its UNSHAPED self, which the writer must never
      // reach for after shapePhone() has done its work.
      const shapes = candidatesFor(entry.key, raw, bank);
      d.candidates = shapes.length > 1 ? shapes : [];
      const value = coerce(raw, Object.assign({}, row,
        { candidates: shapes, candidateKey: entry.key }));
      if (value !== null) {
        const action = isProse(entry.key, value) ? SUGGEST : FILL;
        return done(d, action, value, 'profile', 0.95, '');
      }
      // We hold an answer and this list does not offer it. A catch-all is the
      // honest choice for "somewhere else" — but only here, in the ordinary
      // profile tier: the sensitive tier above returns before this point, so a
      // work-authorization or EEO question can never reach it. SUGGEST, not
      // FILL, because a catch-all is a compromise the user should see.
      const other = row.options && row.options.length ? findOtherOption(row.options) : null;
      if (other) {
        return done(d, SUGGEST, other, 'profile', 0.5,
                    `"${truncate(String(raw), 40)}" isn't offered here; chose "${other}"`);
      }
    }

    // We know EXACTLY what this field asks for, and the profile has nothing for
    // it: someone with no middle name, no GitHub, no portfolio. The answer is
    // "nothing", and it must stay nothing. The model sees only this same
    // profile, so the most it could do is borrow a neighbouring value — which is
    // how a Middle Name box ended up holding the full name.
    //
    // Still sent to the server, but RECALL-ONLY: an answer the user typed for
    // this field before (the learning loop) is legitimately theirs and is used;
    // the model is never asked.
    if (entry && !bank[entry.key] && !PROSE_KEYS.has(entry.key)) {
      d.knownEmpty = true;
      const recalled = answered[String(row.serverIndex != null ? row.serverIndex : position)];
      if (recalled && recalled.source === 'saved_answer' && String(recalled.value || '').trim()) {
        const value = coerce(recalled.value, row);
        if (value !== null) {
          return done(d, Number(recalled.confidence) >= AUTOFILL_MIN ? FILL : SUGGEST,
                      value, 'saved_answer', Number(recalled.confidence) || 0,
                      recalled.matchedQuestion
                        ? `from your answer to "${truncate(recalled.matchedQuestion, 60)}"` : '');
        }
      }
      return row.required
        ? done(d, ASK, '', '', 0, 'not in your profile')
        : done(d, SKIP, '', '', 0, 'not in your profile');
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

// The narrower set the profile's "Agree to employers' terms / privacy policies"
// permission speaks for: agreeing to terms, a privacy policy, or acknowledging
// / certifying the application. NOT marketing or talent-pool opt-ins — the
// person never said yes to being contacted, only to the employer's terms.
const TERMS_RE = /\bterms\b|\bprivacy (policy|notice|statement)\b|\bi agree\b|\bagree to\b|\bi accept\b|\baccept (the|our|these)\b|\backnowledge\b|\bi certify\b|\bcertify that\b|\battest\b/i;
const OPT_IN_RE = /\bmarketing\b|\bpromotional\b|\bnewsletter\b|\bsubscribe\b|\btext messages?\b|\bsms\b|\bwhatsapp\b|\bupdates about\b|\btalent (pool|community|network)\b|\bfuture (roles|openings|opportunities)\b|\bjob alerts?\b|\bcontact me\b|\bkeep me\b|\bnotify me\b/i;

export function looksLikeTermsAgreement(label) {
  const t = String(label == null ? '' : label);
  return TERMS_RE.test(t) && !OPT_IN_RE.test(t);
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
    // Shapes the answer may take, best first. One entry for an ordinary field;
    // several for the ones whose label does not say what the box wants.
    candidates: [],
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

// Sensitive categories the profile page has a field for (routers/profile_page.py).
const PROFILE_CATEGORIES = new Set(['work_authorization', 'sponsorship', 'salary', 'demographic']);

function profileHint(category, entry) {
  if (entry && entry.key === 'nationality') return 'add your nationality to your profile';
  switch (category) {
    case 'work_authorization': return 'add your work authorization to your profile';
    case 'sponsorship': return 'add your sponsorship answer to your profile';
    case 'salary': return 'add your salary expectation to your profile';
    case 'demographic': return 'set your voluntary disclosures in your profile';
    default: return '';
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
// ── candidates: one field, several legitimate shapes ─────────
//
// A dropdown labelled "Country" may want "India", a dial code "+91", or
// "India (+91)". One labelled "Current location" may want the full
// "Kolkata, West Bengal, India", or just the city, or just the state, or a
// closed list of offices. The LABEL cannot tell these apart — the option list
// can, and by the time anything is written the widget is already open and its
// options already read. So a decision carries an ordered list of shapes the
// same answer can take, and whichever one the form actually offers wins, at no
// extra open, click or wait.
//
// Most specific first, so a form that accepts several gets the fullest one.

const LOCATION_KEYS = new Set(['location', 'address_city', 'address_state', 'address_country']);

// A degree is written one way on a CV and offered another way in a dropdown:
// "Bachelor of Technology" on the profile, "Bachelor's Degree" on the form. The
// level is the part both agree on, so each level carries the phrasings forms
// actually use. Ordered most specific first, and checked highest-level first so
// "Master of Technology" is never read as a bachelor's.
const DEGREE_LEVELS = [
  { test: /\b(ph\.? ?d|doctorate|doctoral|d\.?phil)\b/i,
    // Level phrasings only. "Doctor of Philosophy" is a SPECIFIC degree and
    // reads as a near-match for "Doctor of Medicine (M.D.)", which it is not.
    shapes: ["Doctorate", "Doctoral Degree", "PhD"] },
  // "graduate" is master-level in US phrasing; \b keeps it out of
  // "undergraduate", which is the bachelor's row below. Every shape a level
  // offers must itself name that level, or the level guard has nothing to
  // check and a generic "Postgraduate Degree" drifts onto "Associate's Degree".
  { test: /\b(m\.? ?tech|m\.? ?sc|m\.? ?s|m\.? ?a|m\.? ?eng|mba|mca|m\.? ?com|master'?s?|post ?graduate|graduate)\b/i,
    shapes: ["Master's Degree", "Masters", "Master", "Postgraduate Degree", "Graduate Degree"] },
  { test: /\b(b\.? ?tech|b\.? ?e|b\.? ?sc|b\.? ?s|b\.? ?a|b\.? ?eng|bca|b\.? ?com|bachelor'?s?|under ?graduate)\b/i,
    shapes: ["Bachelor's Degree", "Bachelors", "Bachelor", "Undergraduate Degree", "Undergraduate"] },
  { test: /\bassociate'?s?\b/i,
    shapes: ["Associate's Degree", "Associates", "Associate"] },
  { test: /\b(high school|secondary school|higher secondary|12th|hsc|diploma)\b/i,
    shapes: ["High School", "High School Diploma", "Secondary School"] },
];

// Race / ethnicity, which every form words differently: "South Asian" on the
// profile, "Asian" on the form, "Asian or Pacific Islander" on the next one.
//
// These WIDEN and never narrow. Going from the broader category the user chose
// to a narrower one would be putting an answer in their mouth on a protected
// characteristic, so each group lists only equal-or-broader phrasings of what
// they already said, and a stored value matching no group is left alone.
const ETHNICITY_GROUPS = [
  // Ordered before the Asian row: "American Indian" and "Asian Indian" share a
  // word, and only the tribal-affiliation sense belongs here.
  { test: /\b(american indian|alaska(n)? native|native american|indigenous|first nations?|aboriginal)\b/i,
    shapes: ['American Indian or Alaska Native', 'Indigenous / First Nations',
             'Indigenous', 'First Nations', 'Native American'] },
  { test: /\b(native hawaiian|pacific islander)\b/i,
    shapes: ['Native Hawaiian or Other Pacific Islander', 'Pacific Islander',
             'Native Hawaiian'] },
  { test: /\b(south asian|east asian|southeast asian|asian|desi|chinese|japanese|korean|filipino|vietnamese|asian indian|indian subcontinent)\b/i,
    shapes: ['Asian', 'Asian or Pacific Islander', 'Asian (Not Hispanic or Latino)'] },
  // Before the Black row: "North African" contains "African", and checked
  // after it, "Middle Eastern or North African" was recorded as Black.
  { test: /\b(middle eastern|north african|arab|mena)\b/i,
    shapes: ['Middle Eastern or North African', 'Middle Eastern / North African',
             'Middle Eastern', 'MENA'] },
  { test: /\b(black|african american|afro|african)\b/i,
    shapes: ['Black or African American', 'Black or African', 'Black',
             'African American', 'Black (Not Hispanic or Latino)'] },
  { test: /\b(hispanic|latino|latina|latinx|latin american)\b/i,
    shapes: ['Hispanic or Latino', 'Hispanic / Latino', 'Hispanic', 'Latino'] },
  { test: /\b(white|caucasian|european)\b/i,
    shapes: ['White', 'White / European', 'Caucasian',
             'White (Not Hispanic or Latino)'] },
  { test: /\b(two or more|multiracial|multi racial|mixed|biracial)\b/i,
    shapes: ['Two or More Races', 'Multiracial', 'Two or more races (Not Hispanic or Latino)'] },
];

/** An option may answer only if it states the same thing the person stored. */
function eeoGuardFor(key, stored) {
  const want = eeoGroup(key, stored);
  return function eeoGuard(candidate, option) {
    return eeoOptionAllowed(key, want, option);
  };
}

/** The index of the group `text` belongs to, or -1. */
function ethnicityGroup(text) {
  // "(Not Hispanic or Latino)" names a group the answer is NOT in — read with
  // it, "White (Not Hispanic or Latino)" would be filed under Hispanic.
  const t = String(text || '').replace(/\(\s*not hispanic or latino\s*\)/ig, ' ');
  return ETHNICITY_GROUPS.findIndex(g => g.test.test(t));
}

/** Broader phrasings of the ethnicity `text` names, or []. */
function ethnicityShapes(text) {
  const i = ethnicityGroup(text);
  return i < 0 ? [] : ETHNICITY_GROUPS[i].shapes;
}

/**
 * May this option answer this ethnicity candidate?
 *
 * The same trap as degrees, with more at stake: these labels are long, share
 * connectives, and sit right in the fuzzy matcher's weak band — "Black or
 * African American" against "American Indian or Alaska Native" shares two
 * words. A protected characteristic is never recorded on a resemblance, so the
 * option must belong to the SAME group and read as the same thing.
 */
function ethnicityGuardFor(stored) {
  return function ethnicityGuard(candidate, option) {
    const want = ethnicityGroup(candidate);
    if (want < 0) return true;
    if (ethnicityGroup(option) !== want) return false;
    // Either the form words it exactly as one of the curated phrasings (which
    // are equal-or-broader by construction), or it is a plain widening of what
    // the person themselves wrote.
    // Workday qualifies every non-Hispanic group: "Black or African American
    // (Not Hispanic or Latino)". The curated phrasings already accept that
    // qualifier for some groups; compare without it so every group does.
    const plain = String(option).replace(/\s*\(\s*not hispanic or latino\s*\)\s*/i, ' ').trim();
    return sameText(candidate, option) || sameText(candidate, plain)
        || widensOrEquals(stored, option) || widensOrEquals(stored, plain);
  };
}

function sameText(a, b) {
  return normalizeOptionText(a) === normalizeOptionText(b);
}

/**
 * Is `option` the same as what they wrote, or broader than it?
 *
 * The direction is the whole point. "South Asian" may answer a list offering
 * "Asian": everything the narrower answer says, the broader one also says.
 * The reverse must never happen — a stored "Asian" taking "South Asian" off a
 * list would be filing a more specific claim about the person's ethnicity than
 * they ever made, on a form they sign. Anything a candidate does not already
 * say is refused, and the field goes back to them.
 */
function widensOrEquals(stored, option) {
  const a = normalizeOptionText(stored);
  const b = normalizeOptionText(option);
  if (!a || !b) return false;
  if (a === b) return true;
  const want = new Set(a.split(' ').filter(Boolean));
  const got = new Set(b.split(' ').filter(Boolean));
  return [...got].every(t => want.has(t));
}

/** The index of the level `text` names, or -1. */
function degreeLevel(text) {
  return DEGREE_LEVELS.findIndex(l => l.test.test(String(text || '')));
}

/** The dropdown phrasings for whatever level `text` names, or []. */
function degreeShapes(text) {
  const i = degreeLevel(text);
  return i < 0 ? [] : DEGREE_LEVELS[i].shapes;
}

/**
 * May this option answer this degree candidate?
 *
 * Education lists are full of near-misses that the fuzzy matcher rates highly
 * because they share a generic word: "Master of Science" scores over the bar
 * against "Computer Science Degree", and "Doctoral Degree" against
 * "Bachelor's Degree". Both would put the wrong qualification on an
 * application. So a candidate that names a level may only take an option
 * naming the SAME level — an option naming none (a subject, not a
 * qualification) is not an answer to "what is your degree level".
 */
function degreeLevelAgrees(candidate, option) {
  const want = degreeLevel(candidate);
  if (want < 0) return true;                 // we cannot tell; leave it to matching
  return degreeLevel(option) === want;
}

/**
 * Whether these two name the same qualification, not merely a similar one.
 *
 * Education lists sit in the band where the fuzzy matcher is least reliable —
 * every entry is three words, two of them shared. "Master's Degree" scores
 * respectably against "Master of Business Administration", and matching there
 * would claim an MBA the person does not hold. So a degree is only taken on an
 * exact reading or a whole-word containment, never on the 0.55 fuzzy band that
 * serves reworded sentences elsewhere.
 */
function degreeReadsTheSame(candidate, option) {
  const a = normalizeOptionText(candidate);
  const b = normalizeOptionText(option);
  if (!a || !b) return false;
  if (a === b) return true;
  const want = new Set(a.split(' ').filter(Boolean));
  const got = new Set(b.split(' ').filter(Boolean));
  const subset = (small, large) => [...small].every(t => large.has(t));
  if (subset(got, want)) return true;                     // option ⊆ candidate
  if (subset(want, got)) return want.size / got.size >= 0.5;
  return false;
}

/** The per-option test for a degree row. */
function degreeGuard(candidate, option) {
  return degreeLevelAgrees(candidate, option) && degreeReadsTheSame(candidate, option);
}

/** Unique, non-empty, order preserved. */
function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const t = String(v == null ? '' : v).trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * The shapes `value` could legitimately take for this field, best first.
 *
 * Deliberately built only from what the user actually stored. The dial code
 * comes from their own phone number via splitPhone() rather than a country
 * table: a table would have to be kept correct forever, and the number in the
 * profile is already the authority on which country they dial from.
 */
export function candidatesFor(key, value, bank) {
  const b = bank || {};
  const text = String(value == null ? '' : value).trim();
  // Level phrasings first: a dropdown offering "Bachelor's Degree" is answered
  // by the level, while the raw "Bachelor of Technology" is only right on the
  // lists that spell it out — so it stays, last.
  if (key === 'degree') return uniq(degreeShapes(text).concat([text]));
  // The stored wording first — a form offering "South Asian" should get it —
  // then the broader categories it belongs to.
  if (key === 'race_ethnicity') return uniq([text].concat(ethnicityShapes(text)));
  if (EEO_GROUPS[key]) return uniq([text].concat(eeoShapes(key, text)));
  if (!LOCATION_KEYS.has(key)) return text ? [text] : [];

  const city = String(b.address_city || '').trim();
  const state = String(b.address_state || '').trim();
  const country = String(b.address_country || '').trim();
  const full = String(b.location || '').trim();

  if (key === 'address_country') {
    // splitPhone already returns it with the leading '+'.
    const plus = splitPhone(String(b.phone || '')).dialCode;
    return uniq([text, plus, plus && country ? `${country} (${plus})` : '']);
  }

  // City / state / free-text location: every granularity the box might want.
  return uniq([
    text,
    full,
    city && state && country ? `${city}, ${state}, ${country}` : '',
    city && state ? `${city}, ${state}` : '',
    city,
    state,
    country,
  ]);
}

// Catch-alls, tried only after every real candidate has missed. Kept separate
// from DECLINE_OPTION_MARKERS: declining to answer is a statement about the
// question, "Other" is a statement about the answer, and only one of them is
// ever acceptable on a sensitive field.
const OTHER_OPTION_MARKERS = [
  'other', 'none of the above', 'not listed', 'not applicable', 'n/a',
  'outside', 'elsewhere', 'rest of world',
];

/** The list's catch-all option, or null. */
export function findOtherOption(options) {
  for (const opt of options || []) {
    const label = String(typeof opt === 'string' ? opt : (opt && opt.label) || '')
      .toLowerCase().trim();
    if (!label) continue;
    if (OTHER_OPTION_MARKERS.some(m => label === m || label.startsWith(m + ' ')
                                   || label.startsWith(m + ','))) {
      return typeof opt === 'string' ? opt : opt.label;
    }
  }
  return null;
}

/**
 * The option this row offers for any of `candidates`, or null.
 *
 * Every candidate is scored and the best match wins, rather than the first that
 * clears the bar: on a list of "India (+91)" the country candidate scores
 * higher than the bare dial code, and on a list of "+91" only the dial code
 * matches at all. Ties go to the earlier (more specific) candidate.
 */
export function bestCandidateMatch(candidates, options, guard) {
  if (!options || !options.length) return null;
  const labels = options.map(o => (typeof o === 'string' ? o : o.label));
  for (const candidate of candidates || []) {
    const allowed = guard ? labels.filter(l => guard(candidate, l)) : labels;
    if (!allowed.length) continue;
    const hit = bestOptionMatch(candidate, allowed);
    if (hit == null) continue;
    const label = typeof hit === 'string' ? hit : hit.label;
    if (sharesWord(candidate, label)) return label;
  }
  return null;
}

/**
 * Do these two share a whole word?
 *
 * Character similarity alone is not safe on place names: "West Bengal" scores
 * 0.60 against "Bengaluru" — over the 0.55 threshold — on the letters they
 * happen to share, which would put a candidate from Kolkata in the Bengaluru
 * office. They have no word in common, and that is the signal that the
 * resemblance is an accident of spelling.
 *
 * Scoped to this path deliberately. Elsewhere the fuzzy matcher earns its keep
 * on rewordings of the same sentence ("I am not a protected veteran"), which
 * always share words anyway; tightening it globally is a separate change with
 * its own risks.
 */
function sharesWord(a, b) {
  const wordsOf = t => new Set(String(t || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const left = wordsOf(a);
  for (const w of wordsOf(b)) if (left.has(w)) return true;
  return false;
}

export function coerce(value, row) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;

  if (row.kind === 'checkbox' || row.kind === 'radio') {
    return coerceChoice(text, row);
  }
  // Workday's split date: carried as ISO and split into month/day/year by the
  // writer. Unparseable means ask, never three pieces of a guess.
  if (row.kind === 'date-parts') {
    return formatDateForField(text, { type: 'date' }) || null;
  }
  if (row.kind === 'select' || row.kind === 'combobox') {
    const options = (row.options || []).map(o => (typeof o === 'string' ? o : o.label));
    if (!options.length) return text;     // options unreadable: let the writer try
    // Every shape of the answer, not just the one the label suggested: a
    // "Country" list of dial codes matches "+91" and nothing else.
    const candidates = (row.candidates && row.candidates.length) ? row.candidates : [text];
    const guard = row.candidateKey === 'degree' ? degreeGuard
                : row.candidateKey === 'race_ethnicity'
                  ? ethnicityGuardFor(candidates[0])
                : EEO_GROUPS[row.candidateKey]
                  ? eeoGuardFor(row.candidateKey, candidates[0])
                : null;
    // Self-identification lists are compared without Workday's trailing
    // "(United States of America)"; the option returned is the real one.
    const bare = READ_FIRST_KEYS.has(row.candidateKey) ? options.map(stripRegionSuffix) : options;
    const match = bestCandidateMatch(candidates, bare, guard);
    if (match != null) return options[bare.indexOf(match)];
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
    if (d.action !== ASK && !d.askable && !d.knownEmpty) return;
    if (d.sensitive || d.slot || d.noServer) return;
    if (isNeverFill(d.label)) return;
    if (classifySensitive(d.label)) return;     // belt and braces
    out.push({
      i,
      label: d.label,
      kind: d.kind,
      required: !!d.required,
      sensitive: false,
      // A field we can name but have no value for: recall a saved answer, but
      // never let the model compose one. Enforced on the server as well.
      recallOnly: !!d.knownEmpty,
      compose: !!d.compose,
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
