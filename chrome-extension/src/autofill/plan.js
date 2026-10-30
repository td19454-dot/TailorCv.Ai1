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
  hasHonorificOptions,
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
  questionSignature,
  STORABLE_SENSITIVE,
  matchSensitiveKey,
} from './match.js';
import { countryOf, countryOption, countryShare, countryShapes, countryNamedIn } from './countries.js';

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
  // The company this form belongs to: its own name is no sensitive word on its
  // own form (Visa) — see withoutEmployer.
  const employer = String((ctx && ctx.jobCompany) || '');
  const answered = (server && server.answers) || {};
  const registry = (state && state.registry) || {};
  const userEdited = new Set((state && state.userEdited) || []);

  return (rows || []).map((row, position) => {
    const d = base(row);
    d.employer = employer;

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
    // Except Workday's skills prompt: it only ADDS — the skills Workday read
    // from the resume stay, and the profile's other skills join them.
    const additiveSkills = row.multiPrompt && (matchFieldKey(row.label) || {}).key === 'top_skills';
    if (row.filled && !row.invalid && !additiveSkills) {
      return done(d, SKIP, row.value, '', 0, 'already filled in');
    }

    // "Have you been employed by Quantiphi previously?" — a fact the work
    // history settles: Yes if any job in the profile was there, else No. Sent
    // to the model it came back unanswered, and that one required radio
    // stopped auto-apply (Quantiphi Workday, Oct 2026). Ahead of the sensitive
    // tier: "Have you ever worked for Visa Inc.?" is about the employer named
    // Visa, not a visa, and was sent to the profile as a sponsorship question.
    const prior = previousEmployerAnswer(row, ctx, bank);
    if (prior) {
      if (prior.ask) return done(d, ASK, '', '', 0, prior.ask);
      if (prior.readFirst) d.readFirst = prior.readFirst;
      return done(d, FILL, prior.value, 'profile', 0.9, prior.reason);
    }
    // "Are you engaged in any outside employment you would like to continue?"
    // (Mastercard), "Do you have a second job, outside business…?" (Capital
    // One): always No — the person's standing answer (Oct 2026).
    const outside = outsideEmploymentAnswer(row);
    if (outside !== null) {
      return done(d, FILL, outside, 'profile', 0.9, 'no outside employment — always No');
    }

    // Tier 0b — sensitive. Stored value or nothing.
    const category = classifySensitive(row.label, employer);
    if (category) {
      d.sensitive = category;
      // Its own category's answer — see matchSensitiveKey for the sponsorship
      // question that the open search matched to current_company.
      const entry = matchSensitiveKey(row.label, category);
      let stored = entry ? bank[entry.key] : '';
      // Country of birth: the profile's own, else its country of citizenship
      // (the person's choice, Oct 2026) — as the country, never a demonym:
      // "Indian" was how PwC's list ended on "British Indian Ocean Territory".
      if (entry && entry.key === 'country_of_birth') {
        const raw = String(stored || bank.nationality || '').trim();
        stored = countryOf(raw) || raw;
        if (countryOf(raw)) d.candidates = countryShapes(countryOf(raw));
      }
      // A demographic question's saved answer comes AFTER the profile, which is
      // where these live: a later change there must win over an old form.
      const savedDemographic = () => {
        if (category !== 'demographic') return null;
        const saved = savedSensitiveAnswer(row.label, ctx && ctx.savedSensitive);
        const value = saved ? coerce(saved, row) : null;
        return value === null ? null
          : done(d, FILL, value, 'saved_answer', 0.9, 'your saved answer to this question');
      };
      if (STORABLE_SENSITIVE.has(category) && category !== 'demographic') {
        // Clearance / criminal history / citizenship: the person's own saved
        // answer to THIS question, if they saved one on an earlier form. Same
        // question only — an answer to one employer's wording is not reused for
        // another's — and it must be one of this form's own options. Ahead of
        // the profile: their answer to this exact wording says more than the
        // profile's one citizenship status translated onto it.
        const saved = savedSensitiveAnswer(row.label, ctx && ctx.savedSensitive);
        const value = saved ? coerce(saved, row) : null;
        if (value !== null) {
          return done(d, FILL, value, 'saved_answer', 0.9, 'your saved answer to this question');
        }
      }
      // "Are you / is anyone in your family a Government Official?" — from the
      // profile's two answers; see governmentOfficialAnswer.
      // Criminal history likewise, from its one answer; criminalHistoryAnswer.
      if (category === 'government_official' || category === 'criminal') {
        const g = category === 'criminal' ? criminalHistoryAnswer(row, bank) : governmentOfficialAnswer(row, bank);
        if (g.followUp) {
          return row.required
            ? done(d, ASK, '', '', 0, 'only needed for some answers to the question above')
            : done(d, SKIP, '', '', 0, 'only needed if you answered Yes above');
        }
        // Unset in the profile: still the person's to answer HERE (an ASK, not
        // a PROFILE row, which has no answer box), and to remember if they like.
        if (g.profile) return done(d, ASK, '', '', 0, `${g.profile}, or choose your answer here`);
        if (g.ask) return done(d, ASK, '', '', 0, g.ask);
        return done(d, FILL, g.value, 'profile', 0.95, g.reason);
      }
      // Citizenship from the profile's country of citizenship — see
      // citizenshipAnswer. Before this, a Workday country list was searched for
      // "Not a U.S. citizen or permanent resident" and never stuck.
      if (category === 'citizenship') {
        const c = citizenshipAnswer(row, bank, entry);
        if (c && c.ask) return done(d, ASK, '', '', 0, c.ask);
        if (c) {
          if (c.candidates && c.candidates.length > 1) d.candidates = c.candidates;
          if (c.drill) d.drill = c.drill;
          if (c.readFirst) d.readFirst = c.readFirst;
          if (row.value && looksLikeDecline(c.value) && !looksLikeDecline(row.value)) {
            return done(d, SKIP, row.value, '', 0, 'keeping the answer already there');
          }
          return done(d, FILL, c.value, 'profile', 0.95, '');
        }
      }
      if (!stored) {
        const fromSaved = savedDemographic();
        if (fromSaved) return fromSaved;
        // Only point at the profile when the profile has a place for it.
        // Clearance and criminal-history questions don't: they are worded too
        // differently per employer to hold one stored answer, so the person
        // answers them here, on this form (and may save that answer).
        // A specific profile field (nationality) counts as a place for it too.
        // A demographic question the profile has no field for ("Are you a
        // military spouse?") is the person's to answer here, not a profile task.
        // Likewise a birth question with no profile field ("Region of Birth").
        const onProfile = (PROFILE_CATEGORIES.has(category)
                           && ((category !== 'demographic' && category !== 'birth') || !!entry))
                          || !!(entry && entry.sensitive);
        return onProfile
          ? done(d, PROFILE, '', '', 0, profileHint(category, entry))
          : done(d, ASK, '', '', 0, 'we never guess this — choose your answer');
      }
      // "Are you Hispanic/Latino?" is the race question asked as a Yes/No
      // (Greenhouse asks it first, then reveals the race list on "No"). The
      // stored race answers it, but not as written: "Asian" is no option of
      // Yes / No, so it went back to the person on every Greenhouse form.
      let key = entry ? entry.key : '';
      let answer = stored;
      if (key === 'race_ethnicity' && isHispanicYesNoQuestion(row.label)) {
        const yesNo = hispanicYesNo(stored);
        if (yesNo === null) {
          return done(d, ASK, '', '', 0, `your stored answer (${stored}) doesn't say — choose your answer`);
        }
        if (yesNo) { key = 'hispanic_latino'; answer = yesNo; }
      }
      // "What is your sexual orientation?", "Are you transgender?": the
      // profile's LGBTQ+ answer only implies these. Its "No" is heterosexual /
      // straight, and not transgender; its "Yes" or "Questioning" doesn't say
      // which — and was put into an orientation list as "No" (Oct 2026). A
      // decline stays a decline.
      if (key === 'lgbtq_identity' && !looksLikeDecline(stored)) {
        const sig = questionSignature(row.label);
        const orientation = /\borientation\b/.test(sig);
        if (orientation || /\btransgender\b/.test(sig)) {
          if (!/^no\b/i.test(String(stored).trim())) {
            const fromSaved = savedDemographic();
            if (fromSaved) return fromSaved;
            return done(d, ASK, '', '', 0, `your LGBTQ+ answer (${stored}) doesn't say — choose your answer`);
          }
          if (orientation) { key = 'sexual_orientation'; answer = 'Heterosexual'; }
        }
      }
      // The stored answer, in whatever wording this form offers for it. Still
      // only ever THEIR answer — the shapes widen it ("South Asian" ->
      // "Asian"), never narrow or invent one, and a value belonging to no
      // known group is matched exactly as before.
      const shapes = candidatesFor(key, answer, bank);
      if (shapes.length > 1) d.candidates = shapes;
      // The writer re-picks from the OPEN list with this same coerce(), since
      // most EEO dropdowns only show their options once opened.
      if (READ_FIRST_KEYS.has(key) || key === 'hispanic_latino') d.readFirst = { key, stored: answer };
      // Work authorization may be a list of statements, read against both
      // stored answers; the list is short, so open it and read it whole.
      const sponsorship = key === 'authorized_to_work_in_country' ? bank.requires_visa_sponsorship : undefined;
      if (sponsorship !== undefined) d.readFirst = { key, stored: answer, sponsorship };
      const value = coerce(answer, Object.assign({}, row,
        { candidates: shapes, candidateKey: key, sponsorship }));
      if (value === null) {
        // We have their answer but this form offers no option matching it.
        const fromSaved = savedDemographic();
        if (fromSaved) return fromSaved;
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

    // "Are you at least 18 years of age?" — every applicant is an adult, so
    // this has one answer everywhere and never needs a model (which marked it
    // for review) or the person. Only the 18/16 threshold: "at least 21" is
    // not true of every applicant, so it is left alone.
    const ageAnswer = adultAgeAnswer(row.label);
    if (ageAnswer) {
      const value = coerce(ageAnswer, row);
      if (value !== null) {
        return done(d, FILL, value, 'standard', 0.95, '');
      }
    }

    // Tier 1 — deterministic profile match.
    let entry = matchFieldKey(row.label);
    // "Title" beside Mr. / Ms. / Dr. is the name's title; the same word in a
    // work-history block is a job title, never to be given "Mr.".
    if (entry && entry.key === 'name_title' && !hasHonorificOptions(row.options)) entry = null;
    // A work-location preference is the person's choice; nothing on file says it.
    if (entry && entry.key === 'preferred_work_location') {
      return row.required
        ? done(d, ASK, '', '', 0, 'which locations you would like to work in')
        : done(d, SKIP, '', '', 0, 'optional — your work-location preference');
    }
    const storedValue = entry ? bankValue(entry.key, bank) : '';
    if (entry && storedValue) {
      const raw = entry.key === 'middle_name' && /\binitial\b/i.test(row.label)
        ? String(storedValue).trim().charAt(0).toUpperCase()
        : storedValue;
      // Built BEFORE coerce so it can weigh every shape against the options.
      // Passed on a COPY of the row: decide() is a pure reducer over the
      // descriptors and is re-run on every pass, so it must not write to them.
      // Only when there is genuinely more than one shape. A phone number's
      // single candidate is its UNSHAPED self, which the writer must never
      // reach for after shapePhone() has done its work.
      const shapes = candidatesFor(entry.key, raw, bank);
      d.candidates = shapes.length > 1 ? shapes : [];
      // A degree dropdown is opened once and chosen from in full, by
      // degreeOption — not searched by typing each candidate in turn, which
      // costs a wait per spelling ("BTECH", "B.Tech", "Bachelor's Degree"…).
      if (entry.key === 'degree' && (row.kind === 'combobox' || row.kind === 'select')) {
        d.readFirst = { key: 'degree', stored: raw };
      }
      // Workday's "Type to Add Skills": one search-and-tick per skill, so the
      // profile's comma-joined skills go as a list. Sent whole, the string
      // matched nothing and the box stayed empty (NVIDIA, Oct 2026).
      if (entry.key === 'top_skills' && row.multiPrompt) {
        const skills = splitSkills(raw);
        if (skills.length) {
          d.multiValues = skills;
          return done(d, FILL, skills.join(', '), 'profile', 0.95, '');
        }
      }
      // Workday's two-level list: LinkedIn sits inside a category. The
      // writer searches for it, then opens the categories (commitHierarchyPick).
      if (entry.key === 'how_did_you_hear_about_us' && row.kind === 'combobox') {
        d.hierarchy = { leaf: HEARD_VIA, parents: HEARD_VIA_PARENTS, fallback: HEARD_VIA_FALLBACK };
      }
      const value = coerce(raw, Object.assign({}, row,
        { candidates: shapes, candidateKey: entry.key }));
      if (value !== null) {
        const action = isProse(entry.key, value) ? SUGGEST : FILL;
        return done(d, action, value, 'profile', 0.95, '');
      }
      if (entry.key === 'how_did_you_hear_about_us') {
        return done(d, ASK, '', '', 0, 'no LinkedIn or External Agency option here — choose your answer');
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
    if (entry && !storedValue && !PROSE_KEYS.has(entry.key)) {
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
                || row.kind === 'radio' || row.kind === 'checkbox' || row.kind === 'choice';
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
// "I have read and consent to the above" is Citi's Terms checkbox (Oct 2026):
// none of the other phrasings, so the profile's permission never reached it.
const TERMS_RE = /\bterms\b|\bprivacy (policy|notice|statement)\b|\bi agree\b|\bagree to\b|\bi accept\b|\baccept (the|our|these)\b|\backnowledge\b|\bi certify\b|\bcertify that\b|\battest\b|\bi have read\b|\bread and (understood|understand|agree|accept|consent)\b|\bconsent to the (above|terms|foregoing|following)\b/i;
const OPT_IN_RE = /\bmarketing\b|\bpromotional\b|\bnewsletter\b|\bsubscribe\b|\btext messages?\b|\bsms\b|\bwhatsapp\b|\bupdates about\b|\btalent (pool|community|network)\b|\bfuture (roles|openings|opportunities)\b|\bjob alerts?\b|\bcontact me\b|\bkeep me\b|\bnotify me\b/i;

const ADULT_RE = /\b(at least|over|above|older than|minimum age of|aged?)\s*(the age of\s*)?(18|eighteen|16|sixteen)\b|\b(18|eighteen|16|sixteen)\s*(years?\s*(of age|old)?|\+)?\s*(or|and)\s*(older|over|above)\b|\b(18|eighteen)\s*\+|\blegal (working )?age\b|\bage of majority\b/i;
const MINOR_RE = /\b(under|younger than|below)\s*(the age of\s*)?(18|eighteen|16|sixteen)\b/i;

/** "yes" for "Are you at least 18?", "no" for "Are you under 18?", else ''. */
export function adultAgeAnswer(label) {
  const t = String(label == null ? '' : label);
  if (MINOR_RE.test(t)) return 'no';
  if (ADULT_RE.test(t)) return 'yes';
  return '';
}

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
const PROFILE_CATEGORIES = new Set(['work_authorization', 'sponsorship', 'salary', 'demographic', 'birth']);

function profileHint(category, entry) {
  if (entry && entry.key === 'nationality') return 'add your country of citizenship to your profile';
  if (category === 'citizenship') return 'add your country of citizenship to your profile';
  if (entry && entry.key === 'citizenship_status') return 'add your citizenship status to your profile';
  switch (category) {
    case 'work_authorization': return 'add your work authorization to your profile';
    case 'sponsorship': return 'add your sponsorship answer to your profile';
    case 'salary': return 'add your salary expectation to your profile';
    case 'demographic': return 'set your voluntary disclosures in your profile';
    case 'birth': return 'add your date / place of birth to your profile';
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
  { test: /\b(high school|secondary school|higher secondary|12th|hsc)\b/i,
    shapes: ["High School", "High School Diploma", "Secondary School"] },
  // A diploma on its own is post-school (a polytechnic "Diploma in Mechanical
  // Engineering", a "Diploma in Fine Arts") — not a high-school qualification.
  // Listed after high school so "High School Diploma" still reads as that.
  // Before, any "diploma" was the high-school level, and a Diploma in Fine
  // Arts was entered on Oracle as "High School Diploma".
  { test: /\bdiploma\b/i,
    shapes: ['Diploma'] },
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

/**
 * "Are you Hispanic/Latino?" — the Yes/No form of the ethnicity question, not
 * a race list that merely offers "Hispanic or Latino" among its options (those
 * are labelled Race / Ethnicity and stay with the ordinary matching).
 */
export function isHispanicYesNoQuestion(label) {
  const text = String(label || '');
  return /\b(hispanic|latin[oax])\b/i.test(text) && !/\b(race|racial|ethnicity)\b/i.test(text);
}

/**
 * The stored race read as an answer to "Are you Hispanic/Latino?".
 *
 * 'Yes' / 'No' when the stored group settles it; '' for a decline, which is
 * matched as stored (onto the form's own decline option); null when it does
 * not settle it — "Two or More Races" may or may not include Hispanic, and an
 * unrecognised value says nothing — so the person answers.
 */
export function hispanicYesNo(stored) {
  if (looksLikeDecline(stored)) return '';
  const group = ethnicityGroup(stored);
  if (group < 0) return null;
  const shapes = ETHNICITY_GROUPS[group].shapes;
  if (shapes.includes('Hispanic or Latino')) return 'Yes';
  if (shapes.includes('Two or More Races')) return null;
  return 'No';
}

// "How did you hear about us?" — always LinkedIn. Workday files it under a
// category (PwC: Job Posting Sites › LinkedIn, Social Platform › LinkedIn);
// these are those categories, in the order to try them.
export const HEARD_VIA = 'LinkedIn';
export const HEARD_VIA_FALLBACK = 'External Agency';
export const HEARD_VIA_PARENTS = ['Social Platform', 'Social Media', 'Professional Network',
  'Job Posting Sites', 'Job Posting', 'Job Portal', 'Job Board', 'Online Job Board', 'Internet'];

// US citizenship status, by the category it states. Ordered: "Not a U.S.
// citizen" must be read as "none" before the citizen row sees "citizen", and
// DACA's "Authorized to work … under DACA" before anything else reads it.
//
// Matching is by group and nothing else. Similarity is the wrong tool here:
// "Not a U.S. citizen" and "(a) U.S. citizen or national" share most of their
// words, and confusing them is a false statement on an export-control form.
const CITIZENSHIP_GROUPS = [
  // "…AND I am NOT a U.S. person" (Snowflake's export-control list) mentions
  // "citizen" earlier in the same option; read as the citizen row it was the
  // pick for a U.S. citizen. Any "not … person / citizen" is a "none".
  { name: 'none', test: /\bnot (a |an )?(u\.? ?s\.?|united states)? ?(citizen|national|person)\b|\bnon[- ]?(u\.? ?s\.? )?citizen\b|\bforeign national\b|\bother\b|\bnone of (the )?above\b/i },
  { name: 'daca', test: /\bdaca\b|\bdeferred action\b/i },
  { name: 'asylee', test: /\basyl(ee|um)\b/i },
  { name: 'refugee', test: /\brefugee\b/i },
  { name: 'permanent_resident', test: /\bpermanent resident\b|\bgreen card\b/i },
  { name: 'citizen', test: /\bcitizen\b|\bnational of the united states\b|\bu\.? ?s\.? national\b/i },
];

function citizenshipGroup(text) {
  const g = CITIZENSHIP_GROUPS.find(group => group.test.test(String(text || '')));
  return g ? g.name : '';
}

/** The one option stating the same citizenship status, or null. */
export function citizenshipOption(stored, options) {
  const want = citizenshipGroup(stored);
  if (!want) return null;
  const same = (options || []).filter(o => citizenshipGroup(o) === want);
  return same.length === 1 ? same[0] : null;
}

// The U.S. status the profile states, or the one its country of citizenship
// implies: a citizen of the U.S. is one; anyone else is not — and holds no
// green card unless the profile says so.
const US_CITIZEN = 'U.S. citizen or national';
const NOT_US = 'Not a U.S. citizen or permanent resident';

function usStatus(bank, country) {
  const explicit = String((bank && bank.citizenship_status) || '').trim();
  if (explicit) return explicit;
  if (!country) return '';
  return country === 'United States' ? US_CITIZEN : NOT_US;
}

// Asks about more than citizenship: residence, "U.S. person" (export control).
const BEYOND_CITIZEN_RE = /\bpermanent resident|\bgreen card\b|\bperson\b|\blawful|\bprotected individual\b|\brefugee\b|\basylee\b/i;
const PLACEHOLDER_RE = /^(select|choose|please select|--|—)/i;

function isYesNoRow(row, labels) {
  const real = labels.filter(l => l && !PLACEHOLDER_RE.test(l.trim()));
  if (real.length) return real.every(l => /^(yes|no)\b/i.test(l.trim()) || looksLikeDecline(l));
  return /^\s*(are|is|do|does|have|has|will|were)\b/i.test(row.label || '');
}

/**
 * A citizenship question answered from the profile's country of citizenship
 * (bank.nationality, "India" — or an older "Indian"), or null to leave it to
 * the stored-answer path below.
 *
 *  - "Are you a citizen of Singapore?" — Yes if that is their country, else No.
 *    Asked about U.S. residence too, the country alone can't say: their U.S.
 *    status settles it if they set one, otherwise they choose.
 *  - A list of countries or nationalities — their country, exactly.
 *  - A list of U.S. statuses (SpaceX) — their U.S. status, stated or implied.
 *  - A list not read yet (Workday's prompt) — their country, searched for, with
 *    Workday's per-country level (India › Citizen) answered "Citizen".
 *
 * Returns { value, candidates?, drill?, readFirst? } or { ask, profile? }.
 */
export function citizenshipAnswer(row, bank, entry) {
  const country = countryOf((bank && bank.nationality) || '');
  const labels = (row.options || []).map(o => (typeof o === 'string' ? o : (o && o.label) || ''))
    .filter(Boolean);
  const named = countryNamedIn(row.label);

  if (named && isYesNoRow(row, labels)) {
    const explicitGroup = citizenshipGroup((bank && bank.citizenship_status) || '');
    if (!country && !(named === 'United States' && explicitGroup)) return null;
    let yes;
    if (!country) {
      // Only a U.S. status on file: it answers a U.S. question by itself.
      yes = explicitGroup === 'citizen'
        || (BEYOND_CITIZEN_RE.test(row.label || '') && explicitGroup === 'permanent_resident');
    } else if (named === country) {
      yes = true;
    } else if (BEYOND_CITIZEN_RE.test(row.label || '')) {
      const explicit = String((bank && bank.citizenship_status) || '').trim();
      if (named !== 'United States' || !explicit) {
        return { ask: `you're a citizen of ${country} — your profile doesn't say whether you hold residence there` };
      }
      const group = citizenshipGroup(explicit);
      yes = group === 'citizen' || group === 'permanent_resident'
        || ((group === 'refugee' || group === 'asylee') && /\bperson\b|\bprotected individual\b/i.test(row.label));
    } else {
      yes = false;
    }
    const value = coerce(yes ? 'Yes' : 'No', Object.assign({}, row, { candidateKey: '' }));
    return value === null ? { ask: 'none of the options say Yes or No' } : { value };
  }

  if (labels.length) {
    const own = countryOption(country, labels);
    if (own) return { value: own, drill: row.kind === 'combobox' ? 'Citizen' : '' };
    // Workday's flat status list: "Citizen (India)", "Permanent Resident (India)".
    // Their country's rows, then the Citizen one among them — never just the
    // first, and never a lone "Permanent Resident (India)".
    const theirs = country ? labels.filter(l => countryOf(l, true) === country) : [];
    const pick = theirs.length ? citizenshipOption('Citizen', theirs) : null;
    if (pick) return { value: pick };
    if (countryShare(labels) >= 0.5) {
      return country ? { ask: `${country} isn't one of this list's options — choose your answer` } : null;
    }
    if (entry && entry.key === 'nationality') return null;
    const status = usStatus(bank, country);
    if (!status) return null;
    const value = citizenshipOption(status, labels);
    return value
      ? { value, readFirst: { key: 'citizenship_status', stored: status, country } }
      : { ask: `none of the options match your citizenship (${country || status})` };
  }

  // Options not read yet. A question naming a country ("U.S. citizenship
  // status") is a status list; anything else is answered with the country.
  if (named && entry && entry.key === 'citizenship_status') {
    const status = usStatus(bank, country);
    return status ? { value: status, readFirst: { key: 'citizenship_status', stored: status, country } } : null;
  }
  if (!country) return null;
  return { value: country, candidates: countryShapes(country), drill: row.kind === 'combobox' ? 'Citizen' : '' };
}

// "Have you (ever) been employed by X (previously)?", "Have you worked for X
// before?", "Are you a former employee of X?". The company is what follows
// by/for/at/with/of, up to "previously", "before", "or", a bracket or the end.
// Only as the whole question (anchored), and never "worked WITH X" — that is
// a skills question ("Have you worked with Python before?").
const PRIOR_EMPLOYER_RE = new RegExp(
  '^\\s*(?:(?:have|had)\\s+you\\s+(?:ever\\s+)?(?:been\\s+)?(?:previously\\s+)?(?:employed|worked|work)'
  + '|(?:are|were)\\s+you\\s+(?:ever\\s+)?(?:a\\s+)?(?:former|previous|past)\\s+(?:employee|worker|intern|contractor))'
  + '\\s+(?:directly\\s+)?(?:by|for|at|of)\\s+(.+?)'
  + '(?=\\s+(?:previously|before|in the past|ever|or\\b|and\\b|as\\b|in any|whether)|\\s*[?(,:*]|$)', 'i');
const COMPANY_SUFFIX_RE = /\b(inc|incorporated|ltd|limited|llc|llp|plc|pvt|private|corp|corporation|co|company|gmbh|ag|sa|group|holdings|technologies|technology|solutions|services|analytics|india|global)\b/g;
const OUR_COMPANY_RE = /^(us|our (company|firm|organi[sz]ation)|this (company|firm|organi[sz]ation)|the company)$/i;

function companyKey(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** Same employer: one name's words contain the other's ("Quantiphi" / "Quantiphi Analytics Pvt Ltd"). */
function sameCompany(a, b) {
  const x = companyKey(a), y = companyKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 3) return false;
  return (' ' + long + ' ').includes(' ' + short + ' ')
    || (short.length >= 4 && long.startsWith(short));      // "Citi" / "Citibank"
}

/**
 * Yes / No for "have you worked for <company> before", from the profile's
 * work history — or null when the label is not that question. Asks instead of
 * answering when there is no work history to read, or no company to read it for.
 */
export function previousEmployerAnswer(row, ctx, bank) {
  const kind = row.kind;
  if (kind !== 'radio' && kind !== 'choice' && kind !== 'select' && kind !== 'combobox') return null;
  // A Yes / No question; options unread (a Workday button) are left to coerce.
  const opts = (row.options || []).map(o => String(typeof o === 'string' ? o : (o && o.label) || '').trim())
    .filter(o => o && !PLACEHOLDER_RE.test(o));
  const yesNo = opts.some(o => /^yes\b/i.test(o)) && opts.some(o => /^no\b/i.test(o));
  // Or sentences: DoorDash's "I have not worked at DoorDash" / "I am a previous
  // employee" / "I am a previous DoorDash Dasher" (Oct 2026).
  if (opts.length && !yesNo && !opts.some(o => EMPLOYER_NEVER_RE.test(o))) return null;
  const m = PRIOR_EMPLOYER_RE.exec(String(row.label || '').replace(/\*+\s*$/, ''));
  if (!m) return null;
  let company = m[1].trim().replace(/^(the|a|an)\s+/i, '');
  if (OUR_COMPANY_RE.test(company)) company = String((ctx && ctx.jobCompany) || '').trim();
  if (!company || /^(your|my|any)\b/i.test(company)
      || /\b(government|military|agency|state.owned|public sector)\b/i.test(company)) return null;
  const jobs = ((ctx && ctx.facts && ctx.facts.workExperience) || []).map(j => j && j.company).filter(Boolean);
  const named = [bank.current_company, bank.previous_company].filter(Boolean);
  const employers = jobs.concat(named);
  // Not in the work history is No, however broadly the question is worded
  // (the person's call: auto-apply must not stop for this).
  const was = employers.find(e => sameCompany(e, company));
  const value = coerce(was ? 'Yes' : 'No', Object.assign({}, row, { candidateKey: 'previous_employer' }));
  if (value === null) {
    return opts.length && !yesNo
      ? { ask: `none of the options plainly says ${was ? `you worked at ${company}` : `you never worked at ${company}`}` }
      : null;
  }
  // A list read only once open (Greenhouse): open it and pick by the same rule.
  return { value, readFirst: { key: 'previous_employer', stored: was ? 'Yes' : 'No' },
           reason: was ? `you worked at ${was}` : `${company} isn't in your work history` };
}

const EMPLOYER_NEVER_RE = /\b(not|never)\b[^.]*\b(work\w*|employ\w*)\b|\bhaven'?t\b[^.]*\bwork\w*/i;
const EMPLOYER_BEFORE_RE = /\b(previous|former|past|currently|current)\b[^.]*\b(employee|employed|staff)\b|\bi (have|used to) work(ed)? (at|for)\b/i;

/**
 * The option stating "Yes" / "No" to "have you worked here before": a Yes /
 * No list by its own words, else the one sentence that says it — "I have not
 * worked at DoorDash"; "I am a previous employee", never "a previous Dasher"
 * (a courier is no employee). Null unless exactly one says it.
 */
export function previousEmployerOption(answer, options) {
  const labels = (options || []).map(o => String(typeof o === 'string' ? o : (o && o.label) || '').trim()).filter(Boolean);
  const no = /^no$/i.test(String(answer || '').trim());
  const plain = labels.filter(o => (no ? /^no\b/i : /^yes\b/i).test(o));
  if (plain.length === 1) return plain[0];
  const said = labels.filter(o => (no
    ? EMPLOYER_NEVER_RE.test(o)
    : EMPLOYER_BEFORE_RE.test(o) && !EMPLOYER_NEVER_RE.test(o)));
  return said.length === 1 ? said[0] : null;
}

// Outside employment, a second job, a side business or other work the person
// would keep alongside the job. Read from the question itself — the text before
// its bracketed examples, which list government service, boards and the like.
// Not "other work" alone: "any other work experience", "other work
// authorization" are different questions.
const OUTSIDE_WORK_RE = new RegExp([
  /\boutside\s+(employment|jobs?|business(es)?|work|activit(y|ies)|engagements?|interests?)\b/.source,
  /\bsecond(ary)?\s+(employment|jobs?|business(es)?)\b/.source,
  /\b(other|additional)\s+(employment|jobs?)\b(?!\s+(offers?|experience|history))/.source,
  /\bmoonlight\w*|\bside\s+(business|jobs?|gigs?|hustle)\b/.source,
].join('|'), 'i');
const ASKS_IF_RE = /^\s*(are|do|will|would|have|is)\s+you\b/i;

/** "No" in this field's own wording for an outside-employment question, or null. */
export function outsideEmploymentAnswer(row) {
  const kind = row.kind;
  if (kind !== 'radio' && kind !== 'choice' && kind !== 'select' && kind !== 'combobox') return null;
  const opts = (row.options || []).map(o => String(typeof o === 'string' ? o : (o && o.label) || '').trim())
    .filter(o => o && !PLACEHOLDER_RE.test(o));
  if (opts.length && !(opts.some(o => /^yes\b/i.test(o)) && opts.some(o => /^no\b/i.test(o)))) return null;
  const head = String(row.label || '').split(/[[(]/)[0];
  if (!ASKS_IF_RE.test(head) || !OUTSIDE_WORK_RE.test(head)) return null;
  return coerce('No', Object.assign({}, row, { candidateKey: '' }));
}

// Government-official declarations, from the profile's two answers. The profile
// asks the broadest version — ever, any relative, any government body or
// state-owned company — so its "No" is true of every narrower wording and is
// filled anywhere. Its "Yes" only where the form asks that same open-ended
// question: a past role may fall outside "the last 12 months". Whose official,
// a negated statement, business associates: the person answers those.
const GOV_NEGATED_RE = /\b(not|neither|nor|none)\b/i;
const GOV_OTHERS_RE = /\bassociates?\b|\bbusiness (partners?|relationships?)\b|\bfriends?\b|\bclose (personal|business)\b|\bpolitically exposed\b/i;
const GOV_FAMILY_RE = /\bfamily\b|\brelatives?\b|\bspouses?\b|\bpartners?\b|\bparents?\b|\bsiblings?\b|\bbrothers?\b|\bsisters?\b|\bchild(ren)?\b|\bsons?\b|\bdaughters?\b|\bin-?laws?\b|\bhousehold\b|\brelated to\b/i;
const GOV_SELF_RE = /\b(are|were) you\b|\bhave you (ever )?(been|held|served|occupied)\b|\bdo you (currently )?(hold|occupy|serve)\b|\bi (am|was|have been)\b/i;
const GOV_OPEN_ENDED_RE = /\bever\b|\bat any time\b|\bnow or in the past\b|\b(past|current) or (present|former)\b|\bformer(ly)?\b|\bha(ve|s) (you |\w+ )?been\b/i;
const GOV_TIME_LIMIT_RE = /\b(within|during|in) the (last|past|previous|preceding)\b|\b(last|past|previous|preceding) (\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/i;

/**
 * A government-official question answered from bank.is_government_official /
 * bank.family_government_official: { value, reason }, { ask }, { profile } or
 * { followUp }. Read from the question alone — the text before its "?", never
 * the definition after it, which lists "any official or employee of…".
 */
export function governmentOfficialAnswer(row, bank) {
  const label = String(row.label || '');
  if (isConditionalFollowUp(label)) return { followUp: true };
  const kind = row.kind;
  if (kind !== 'radio' && kind !== 'choice' && kind !== 'select' && kind !== 'combobox') {
    return { ask: 'we fill this question as a Yes / No only — choose your answer' };
  }
  const head = (label.includes('?') ? label.split('?')[0] : label.split(/\.\s/)[0]).slice(0, 400);
  if (GOV_NEGATED_RE.test(head)) return { ask: 'worded as a "not" statement — choose your answer' };
  if (GOV_OTHERS_RE.test(head)) return { ask: 'asks about people your profile answers don\'t cover — choose your answer' };
  // "Are you related to …" is about family, not the person.
  const family = GOV_FAMILY_RE.test(head);
  const self = GOV_SELF_RE.test(head.replace(/\b(are|were) you (related|connected) to\b/ig, ''));
  if (!family && !self) return { ask: 'we could not tell whose government role this asks about — choose your answer' };

  const answers = [];
  if (self) answers.push(String((bank && bank.is_government_official) || ''));
  if (family) answers.push(String((bank && bank.family_government_official) || ''));
  if (answers.some(a => a !== 'Yes' && a !== 'No')) {
    return { profile: 'add your government-official answers to your profile' };
  }
  let answer = null;
  if (answers.every(a => a === 'No')) answer = 'No';
  else if (answers.length === 1 && GOV_OPEN_ENDED_RE.test(head) && !GOV_TIME_LIMIT_RE.test(head)) answer = 'Yes';
  if (!answer) return { ask: 'your profile says Yes — check it applies to what this question asks' };

  const value = coerce(answer, Object.assign({}, row, { candidateKey: '' }));
  if (value === null) return { ask: `none of the options match your profile answer (${answer})` };
  const whose = self && family ? 'you or your family' : (self ? 'you' : 'your family');
  return { value, reason: `your profile: ${answer === 'No' ? 'no government official' : 'a government official'} (${whose})` };
}

// Criminal history, from the profile's one answer: "Have you ever been convicted
// of any crime, or do you have criminal charges pending?" Its "No" is true of
// every narrower wording (a felony, the last 7 years, excluding traffic) and is
// filled anywhere; its "Yes" never is — whether it applies depends on exactly
// what this form asks. Only a question about the person's own record: consent
// to a background check is the same category and a different question, where
// "No" would refuse the check.
const CRIME_HISTORY_RE = /\bconvict\w*|\bcriminal (record|history|charges?|offen[cs]es?|convictions?|proceedings?|cases?)\b|\bfelon(y|ies)\b|\bmisdemean\w*|\bpending (criminal )?charges?\b|\bcharged with\b|\bpleaded? (guilty|no contest)\b/i;
// A narrowing clause only makes the question narrower, so "No" still holds:
// "…a crime, other than minor traffic violations", "…that has not been sealed".
const CRIME_EXCLUSION_RE = /\b(other than|excluding|except( for)?|not including|apart from)\b[^,;)?]*|\b(that|which) (has|have) not been [^,;)?]*/gi;
const CRIME_CONSENT_RE = /\bconsent\w*|\bauthori[sz]\w*|\bagree\w*|\bwilling\b|\bsubmit to\b|\bundergo\b|\bpass\b/i;
// Statements to certify, not questions: "I confirm I have no criminal record".
const CRIME_STATEMENT_RE = /\b(confirm|certify|declare|attest)\b|\bi (have|had|am) (no|not|never)\b|\b(not|never|neither|nor|none)\b/i;
// Beyond "convicted or charged": arrests, cautions, investigations, traffic
// tickets, workplace discipline — or someone else's record.
const CRIME_UNCOVERED_RE = /\barrest\w*|\bdetain\w*|\bcaution\w*|\binvestigat\w*|\btraffic\b|\bdriving\b|\bmoving violations?\b|\bdisciplin\w*|\bdismiss\w*|\bterminat\w*|\bfamily\b|\brelatives?\b|\bspouse\b/i;
const CRIME_SELF_RE = /\b(have|are|were|do|did) you\b|\byou (have|are|were)\b|\bi (have|am|was)\b/i;

/**
 * A criminal-history question answered from bank.has_criminal_history:
 * { value, reason }, { ask }, { profile } or { followUp }. Read from the
 * question alone — the text before its "?".
 */
export function criminalHistoryAnswer(row, bank) {
  const label = String(row.label || '');
  if (isConditionalFollowUp(label)) return { followUp: true };
  const head = (label.includes('?') ? label.split('?')[0] : label.split(/\.\s/)[0]).slice(0, 400);
  const core = head.replace(CRIME_EXCLUSION_RE, ' ');
  if (!CRIME_HISTORY_RE.test(core) || CRIME_CONSENT_RE.test(core)) {
    return { ask: 'we never guess this — choose your answer' };
  }
  const kind = row.kind;
  if (kind !== 'radio' && kind !== 'choice' && kind !== 'select' && kind !== 'combobox') {
    return { ask: 'we fill this question as a Yes / No only — choose your answer' };
  }
  if (CRIME_STATEMENT_RE.test(core)) return { ask: 'worded as a statement — choose your answer' };
  if (CRIME_UNCOVERED_RE.test(core)) return { ask: 'asks more than your profile answer covers — choose your answer' };
  if (!CRIME_SELF_RE.test(core)) return { ask: 'we never guess this — choose your answer' };

  const stored = String((bank && bank.has_criminal_history) || '');
  if (stored !== 'Yes' && stored !== 'No') return { profile: 'add your criminal-history answer to your profile' };
  if (stored === 'Yes') return { ask: 'your profile says Yes — check it applies to what this question asks' };
  const value = coerce('No', Object.assign({}, row, { candidateKey: '' }));
  if (value === null) return { ask: 'none of the options match your profile answer (No)' };
  return { value, reason: 'your profile: no criminal convictions or pending charges' };
}

// A Workday skills prompt takes one search per skill; ten is plenty and keeps
// the field from costing more than a few seconds.
const MAX_PROMPT_SKILLS = 10;

/** "Python, SQL; Machine Learning" → ['Python', 'SQL', 'Machine Learning'], unique, capped. */
export function splitSkills(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text || '').split(/[,;|\n]+/)) {
    const s = part.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= MAX_PROMPT_SKILLS) break;
  }
  return out;
}

/** The saved answer to exactly this question (same signature), or ''. */
export function savedSensitiveAnswer(label, saved) {
  const sig = questionSignature(label);
  if (!sig) return '';
  const hit = (saved || []).find(s => s && questionSignature(s.question) === sig);
  return hit ? String(hit.answer || '').trim() : '';
}

const YES_RE = /^(yes|y|true)$/i;
const NO_RE = /^(no|n|false)$/i;

/**
 * "Are you legally authorized to work in the United States?" answered with
 * sentences instead of Yes / No (SpaceX: "I am authorized to work in the United
 * States for any employer", "…for my present employer only", "I require
 * sponsorship…", "I am not authorized…").
 *
 * Read off the person's own two stored answers, never one of them alone:
 * "authorized: Yes" says nothing about "any employer" vs "present employer
 * only" until "needs sponsorship: No" settles it. Returns the one option that
 * states their answer, or null — two candidates, or none, and they choose.
 */
export function workAuthStatement(authorized, sponsorship, options) {
  const auth = String(authorized || '').trim();
  const spons = String(sponsorship || '').trim();
  let test;
  if (YES_RE.test(spons)) {
    // They need sponsorship: that is the statement, whatever "authorized" says.
    test = o => /\b(require|need)s?\b.*\bsponsor/i.test(o) && !/\b(not|don'?t|never)\b/i.test(o);
  } else if (YES_RE.test(auth) && NO_RE.test(spons)) {
    test = o => /\bauthori[sz]ed\b/i.test(o) && /\bany employer\b/i.test(o) && !/\bnot\b/i.test(o);
  } else if (NO_RE.test(auth) && NO_RE.test(spons)) {
    test = o => /\bnot (legally )?authori[sz]ed\b|\bunauthori[sz]ed\b/i.test(o) && !/\bsponsor/i.test(o);
  } else {
    return null;
  }
  const hits = (options || []).filter(test);
  return hits.length === 1 ? hits[0] : null;
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

// Specific degrees, each with the spellings employers' lists use for it, most
// specific entries first. Workday (NVIDIA) offers "BTECH", "MTECH", "MCA";
// Greenhouse (Stripe) only "Bachelor's Degree", "Master's Degree", "Doctor of
// Philosophy (Ph.D.)". So a degree tries its own spellings first and its level
// after: a B.Tech gets "BTECH" where it is offered and "Bachelor's Degree"
// where it is not.
//
// Spellings match EXACTLY, ignoring only case, punctuation and spaces
// ("B.Tech" = "BTECH" = "B. Tech"), never by resemblance: "Some college" is not
// "Some post college". `level` is a word degreeLevel() reads; null means the
// value has no level to widen to — an MD is not a PhD, and "No degree" is
// nobody's bachelor's — so those are offered exactly or not at all.
const DEGREE_CATALOG = [
  { test: /\bph\.? ?d\b|doctor of philosophy|\bdoctorate\b|\bdoctoral\b/i,
    spellings: ['PhD', 'Doctor of Philosophy (Ph.D.)', 'Doctor of Philosophy'], level: 'phd' },
  { test: /\bm\.d\.?(?![a-z])|^md$|doctor of medicine/i,
    spellings: ['MD', 'Doctor of Medicine (M.D.)', 'Doctor of Medicine'], level: null },
  { test: /\bj\.d\.?(?![a-z])|^jd$|juris doctor/i,
    spellings: ['JD', 'Juris Doctor (J.D.)', 'Juris Doctor'], level: null },
  { test: /\bm\.? ?tech\b|master of technology/i,
    spellings: ['MTech', 'Master of Technology'], level: 'master' },
  { test: /\bm\.e\.?(?![a-z])|^me$|master of engineering/i,
    spellings: ['M.E.', 'Master of Engineering'], level: 'master' },
  { test: /\bmca\b|master of computer application/i,
    spellings: ['MCA', 'Master of Computer Applications'], level: 'master' },
  { test: /\bm\.? ?b\.? ?a\b|master of business administration/i,
    spellings: ['MBA', 'Master of Business Administration (M.B.A.)', 'Master of Business Administration'], level: 'master' },
  { test: /\bm\.? ?sc\b|\bm\.s\.?(?![a-z])|^ms$|master of science/i,
    spellings: ['M.Sc', 'M.S.', 'Master of Science', 'Master of Science (M.S.)'], level: 'master' },
  { test: /\bm\.a\.?(?![a-z])|^ma$|master of arts/i,
    spellings: ['M.A.', 'Master of Arts'], level: 'master' },
  { test: /\bm\.? ?com\b|master of commerce/i,
    spellings: ['M.Com', 'Master of Commerce'], level: 'master' },
  { test: /\bb\.? ?tech\b|bachelor of technology/i,
    spellings: ['BTech', 'Bachelor of Technology'], level: 'bachelor' },
  { test: /\bb\.e\.?(?![a-z])|^be$|bachelor of engineering/i,
    spellings: ['B.E.', 'Bachelor of Engineering'], level: 'bachelor' },
  { test: /\bbca\b|bachelor of computer application/i,
    spellings: ['BCA', 'Bachelor of Computer Applications'], level: 'bachelor' },
  { test: /\bbba\b|bachelor of business administration/i,
    spellings: ['BBA', 'Bachelor of Business Administration'], level: 'bachelor' },
  { test: /\bb\.? ?sc\b|\bb\.s\.?(?![a-z])|^bs$|bachelor of science/i,
    spellings: ['B.Sc', 'B.S.', 'Bachelor of Science', 'Bachelor of Science (B.S.)'], level: 'bachelor' },
  { test: /\bb\.a\.?(?![a-z])|^ba$|bachelor of arts/i,
    spellings: ['B.A.', 'Bachelor of Arts'], level: 'bachelor' },
  { test: /\bb\.? ?com\b|bachelor of commerce/i,
    spellings: ['B.Com', 'Bachelor of Commerce'], level: 'bachelor' },
  { test: /\bassociate'?s?\b/i,
    spellings: ["Associate's Degree", 'Associates', 'Associate'], level: 'associate' },
  // Status answers (Workday NVIDIA's list) — exact only. "Some post college"
  // before "Some college", and post-diploma before diploma.
  { test: /some post ?college/i, spellings: ['Some post college'], level: null },
  { test: /some college/i, spellings: ['Some college'], level: null },
  { test: /technical|other training/i, spellings: ['Technical/other training'], level: null },
  { test: /post[- ]?diploma/i, spellings: ['Post-diploma studies'], level: null },
  { test: /\bno degree\b|^none$/i, spellings: ['No Degree', 'None'], level: null },
  { test: /\b(high school|secondary school|higher secondary|12th|hsc)\b/i,
    spellings: ['High School', 'High School or equivalent', 'High School Diploma', 'Secondary School'],
    level: 'high school' },
  // A university diploma is not a polytechnic one: each is offered only as itself.
  { test: /university diploma/i, spellings: ['University Diploma'], level: null },
  // Not widened: the only "diploma level" phrasing is "Diploma" itself, and
  // widening would read "University Diploma" as containing it.
  { test: /\bdiploma\b/i, spellings: ['Diploma'], level: null },
];

/** The catalog entry `text` names, or null. */
export function degreeEntry(text) {
  const t = String(text || '').trim();
  return t ? DEGREE_CATALOG.find(e => e.test.test(t)) || null : null;
}

/** Letters and digits only: "B.Tech" and "BTECH" are both "btech". */
const compactDegree = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The option a list offers for this stored degree, or null.
 *
 * In memory, against the one list already read — trying more spellings costs
 * no extra open, click or wait. The degree's own spellings first (exactly),
 * then its level (same level only, through degreeGuard), and nothing beyond:
 * a degree the list does not offer is asked, not approximated.
 */
export function degreeOption(stored, options) {
  const labels = (options || []).map(o => (typeof o === 'string' ? o : o.label)).filter(Boolean);
  if (!labels.length) return null;
  const entry = degreeEntry(stored);
  if (!entry) {
    // Not in the catalog: the earlier behaviour — level phrasings, then the text.
    return bestCandidateMatch(uniq(degreeShapes(stored).concat([stored])), labels, degreeGuard)
      || iscedOption(stored, null, labels);
  }
  const byCompact = new Map(labels.map(l => [compactDegree(l), l]));
  for (const s of [stored].concat(entry.spellings)) {
    const hit = byCompact.get(compactDegree(s));
    if (hit) return hit;
  }
  if (!entry.level) return null;
  return bestCandidateMatch(degreeShapes(entry.level), labels, degreeGuard)
    || iscedOption(stored, entry, labels);
}

// UNESCO's ISCED levels, which some lists name instead of the degree (Visa:
// "Bachelor's or Equivalent First-Degree (ISCED 6: BA, BSc, BEng, LLB, etc.)").
// None of the level phrasings is inside that text, so a B.E. matched nothing
// and the Degree stayed "Select One". Indexed like DEGREE_LEVELS; a diploma has
// no single level (ISCED 4 or 5 by country) and is left to the model.
const ISCED_BY_LEVEL = [8, 7, 6, 5, 3, null];
const ISCED_RE = /\bISCED\s*(\d)(?:\s*[–-]\s*(\d))?/i;

/** The ISCED level a stored degree is at, or null. */
function iscedLevelOf(stored, entry) {
  const i = degreeLevel(entry && entry.level ? entry.level : stored);
  return i < 0 ? null : ISCED_BY_LEVEL[i];
}

/** Does this option's "ISCED n" (or "ISCED 0–2") cover level `n`? */
function iscedCovers(option, n) {
  const m = ISCED_RE.exec(option);
  if (!m) return false;
  const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo;
  return n >= lo && n <= hi;
}

/**
 * The option a list worded by ISCED level offers for this degree, or null.
 * One option at the level: that one. Several (Visa's ISCED 7 is both "Master
 * of Business Administration - MBA" and "Master's or Equivalent"): the one whose
 * name — the text before its bracket — names this degree, else the only one
 * naming no OTHER specific degree. Never a guess between two.
 */
function iscedOption(stored, entry, labels) {
  const n = iscedLevelOf(stored, entry);
  if (n == null) return null;
  const same = labels.filter(l => iscedCovers(l, n));
  if (same.length <= 1) return same[0] || null;
  const lead = l => l.split('(')[0];
  if (entry) {
    const own = same.filter(l => entry.test.test(lead(l)));
    if (own.length === 1) return own[0];
  }
  const generic = same.filter(l => { const e = degreeEntry(lead(l)); return !e || e === entry; });
  return generic.length === 1 ? generic[0] : null;
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
/** The stored answer for a key — a few are derived from another field. */
function bankValue(key, bank) {
  const b = bank || {};
  if (key === 'phone_country_code') return splitPhone(String(b.phone || '')).dialCode || '';
  // Always LinkedIn (the person's call, Oct 2026): no profile answer to keep.
  if (key === 'how_did_you_hear_about_us') return HEARD_VIA;
  return b[key];
}

export function candidatesFor(key, value, bank) {
  const b = bank || {};
  const text = String(value == null ? '' : value).trim();
  if (key === 'phone_country_code') {
    // Every way a dial-code list words it: Oracle "+91 (India)", Workday
    // "India (+91)", a bare "+91", or just the country.
    const country = String(b.address_country || '').trim();
    return uniq([
      country ? `${text} (${country})` : '',
      country ? `${country} (${text})` : '',
      text,
      country,
    ]);
  }
  // Level phrasings first: a dropdown offering "Bachelor's Degree" is answered
  // by the level, while the raw "Bachelor of Technology" is only right on the
  // lists that spell it out — so it stays, last.
  if (key === 'degree') {
    // Its own spellings first ("BTECH" where a list offers it), then its level
    // ("Bachelor's Degree"), then the text as stored. See DEGREE_CATALOG.
    const entry = degreeEntry(text);
    if (!entry) return uniq(degreeShapes(text).concat([text]));
    return uniq([text].concat(entry.spellings, entry.level ? degreeShapes(entry.level) : []));
  }
  // The stored wording first — a form offering "South Asian" should get it —
  // then the broader categories it belongs to.
  if (key === 'race_ethnicity') return uniq([text].concat(ethnicityShapes(text)));
  // LinkedIn, else "External Agency" (the person's call: Capital One's flat
  // list has no LinkedIn). Never a referral, an event or "Other".
  if (key === 'how_did_you_hear_about_us') return [HEARD_VIA, HEARD_VIA_FALLBACK];
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

  // Longest first, then shorter: "Kolkata, West Bengal, India", then
  // "Kolkata, West Bengal", then "Kolkata". A dropdown that offers the fuller
  // form gets it; one that only has the short form still matches further down.
  // Only shapes that ARE this field: a state alone is not a city, and a city
  // alone is not a state.
  const cityStateCountry = city && state && country ? `${city}, ${state}, ${country}` : '';
  const cityState = city && state ? `${city}, ${state}` : '';
  if (key === 'address_city') {
    return uniq([cityStateCountry, cityState, city && country ? `${city}, ${country}` : '', city, text]);
  }
  if (key === 'address_state') {
    return uniq([cityStateCountry, state && country ? `${state}, ${country}` : '', state, text]);
  }
  // The one-line location: every granularity, longest to shortest.
  return uniq([full, cityStateCountry, cityState, city, state && country ? `${state}, ${country}` : '',
               state, country, text]);
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

  if (row.kind === 'checkbox' || row.kind === 'radio' || row.kind === 'choice') {
    return coerceChoice(text, row);
  }
  // Workday's split date: carried as ISO and split into month/day/year by the
  // writer. Unparseable means ask, never three pieces of a guess.
  if (row.kind === 'date-parts') {
    return formatDateForField(text, { type: 'date' }) || null;
  }
  if (row.kind === 'select' || row.kind === 'combobox') {
    const options = (row.options || []).map(o => (typeof o === 'string' ? o : o.label));
    // Options unreadable: let the writer try. A location dropdown starts from
    // its longest shape ("Kolkata, West Bengal, India") and works down.
    if (!options.length) {
      return LOCATION_KEYS.has(row.candidateKey) && row.candidates && row.candidates.length
        ? row.candidates[0] : text;
    }
    return pickFromOptions(text, row, options);
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
/**
 * One of `options` for this stored answer, by the field's own rules — the same
 * whether the options are a dropdown's rows or a radio group's labels.
 */
function pickFromOptions(text, row, options) {
  // Every shape of the answer, not just the one the label suggested: a
  // "Country" list of dial codes matches "+91" and nothing else.
  if (row.candidateKey === 'citizenship_status') {
    // A country list (Workday) takes the country; a list of U.S. statuses, the status.
    return (row.country && countryOption(row.country, options)) || citizenshipOption(text, options);
  }
  if (row.candidateKey === 'degree') return degreeOption(text, options);
  if (row.candidateKey === 'previous_employer') return previousEmployerOption(text, options);
  // A country, against a list of countries: exactly that country or none —
  // never "British Indian Ocean Territory" for "Indian".
  const country = countryOf(text);
  if (country && countryShare(options) >= 0.5) return countryOption(country, options);
  // A work-authorization list worded as statements rather than Yes / No.
  if (row.candidateKey === 'authorized_to_work_in_country'
      && !options.some(o => YES_RE.test(o.trim()) || NO_RE.test(o.trim()))) {
    return workAuthStatement(text, row.sponsorship, options);
  }
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

// Answers whose options are only ever chosen within their own group: a
// resemblance or a "contains not" is never enough on these.
function guardedKey(key) {
  return key === 'race_ethnicity' || key === 'citizenship_status'
      || key === 'hispanic_latino' || !!EEO_GROUPS[key];
}

function coerceChoice(text, row) {
  const options = (row.options || []).map(o => (typeof o === 'string' ? o : o.label))
                                     .filter(Boolean);
  const truthy = /^(yes|true|1|on|checked|i agree|agree|accept)$/i.test(text);
  if (!options.length || (options.length === 1 && row.kind === 'checkbox')) {
    return truthy ? 'yes' : null;
  }
  // A profile answer on a radio group or a row of buttons (Ashby's Gender /
  // Race / Veteran Status) gets the dropdown's rules: "Cisgender man" takes
  // "Male", "South Asian" takes "Asian (Not Hispanic or Latino)". Before this
  // a radio group skipped them, so those went back to the person — and the
  // polarity fallback below could take "I am not a protected veteran" for a
  // stored "I identify as a protected veteran".
  if (row.candidateKey) {
    const picked = pickFromOptions(text, row, options);
    if (picked != null || guardedKey(row.candidateKey)) return picked;
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
    if (classifySensitive(d.label, d.employer)) return;     // belt and braces
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
