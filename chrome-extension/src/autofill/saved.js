// One answer per kind of option list.
//
// auto_apply/qa_store.py pick_saved is the same matcher, run on the server;
// both are checked against test/fixtures/saved_cases.json so they cannot drift.
//
// "Citizenship Status" over U.S. statuses and over a country list is one
// question with two answers. An answer is kept per KIND of list and only ever
// reused on the same kind, as an option this list offers — never as the
// nearest-looking one: the DACA answer from a U.S. list was typed into
// Workday's country list, found nothing, and the field stayed empty.

import { countryOf, countryOption, countryShare } from './countries.js';
import { looksLikeDecline } from './match.js';

// Two lists at least this alike are the same kind (Jaccard over their options).
export const SAME_KIND = 0.6;

const ENUMERATOR_RE = /^(\([a-z0-9]{1,2}\)|[a-z]\)|\d{1,2}[.)])\s+/;
const PLACEHOLDER_RE = /^(select|choose|please select|please choose)( one| an option)?$|^no selection$/;
const YES_NO_RE = /^(yes|no)\b/;

const labelOf = o => (typeof o === 'string' ? o : (o && o.label) || '');

/** "(e) Authorized to work…" and "Authorized to work…" read the same. */
export function normalizeOption(text) {
  let s = String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
  s = s.replace(ENUMERATOR_RE, '');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** [label, normalized] for every option that is not a placeholder. */
function real(labels) {
  const out = [];
  for (const o of labels || []) {
    const raw = labelOf(o);
    const norm = normalizeOption(raw);
    if (norm && !PLACEHOLDER_RE.test(norm)) out.push([raw, norm]);
  }
  return out;
}

/** 'yesno', 'countries' or 'other'. */
export function listKind(labels) {
  const rows = real(labels);
  if (!rows.length) return 'other';
  if (rows.every(([raw, n]) => YES_NO_RE.test(n) || looksLikeDecline(raw))
      && rows.some(([, n]) => YES_NO_RE.test(n))) return 'yesno';
  if (countryShare(rows.map(([raw]) => raw)) >= 0.5) return 'countries';
  return 'other';
}

/** How alike two option lists are: 1 for two Yes/No or two country lists,
 *  otherwise the overlap of their options. */
export function kindScore(a, b) {
  const ka = listKind(a), kb = listKind(b);
  if (ka === kb && (ka === 'yesno' || ka === 'countries')) return 1;
  const sa = new Set(real(a).map(([, n]) => n));
  const sb = new Set(real(b).map(([, n]) => n));
  if (!sa.size || !sb.size) return 0;
  let both = 0;
  for (const n of sa) if (sb.has(n)) both++;
  return both / (sa.size + sb.size - both);
}

function exact(answer, rows) {
  const want = normalizeOption(answer);
  if (!want) return null;
  const hit = rows.find(([, n]) => n === want);
  return hit ? hit[0] : null;
}

/** The variant saved over the same kind of list as `labels` — the one that
 *  decides this field — or null. Oldest first: a tie goes to the newest. */
export function pickSavedVariant(entry, labels) {
  let best = null, bestScore = 0;
  for (const v of (entry && entry.variants) || []) {
    if (!v || !v.options || !v.options.length) continue;
    const score = kindScore(v.options, labels);
    if (score >= SAME_KIND && score >= bestScore) { best = v; bestScore = score; }
  }
  return best;
}

/**
 * The option on THIS list that states the saved answer, or null.
 *
 * `entry` is { answer, variants }. The variant saved over the same kind of
 * list decides; with none of the same kind there is no saved answer here, and
 * the field is decided as if nothing were saved. An answer saved without
 * options (older, or from the dashboard) counts only when this list offers it
 * verbatim.
 */
export function pickSaved(entry, labels) {
  const rows = real(labels);
  if (!rows.length || !entry) return null;
  if (!(entry.variants || []).some(v => v && v.options && v.options.length)) return exact(entry.answer, rows);
  const best = pickSavedVariant(entry, labels);
  if (!best) return null;
  const answer = String(best.answer || '');
  const hit = exact(answer, rows);
  if (hit) return hit;
  const kind = listKind(labels);
  if (kind === 'countries') {
    const country = countryOf(answer);
    return country ? countryOption(country, rows.map(([raw]) => raw)) : null;
  }
  if (kind === 'yesno') {
    const m = normalizeOption(answer).match(YES_NO_RE);
    if (m) {
      const same = rows.filter(([, n]) => n.split(' ')[0] === m[1]);
      return same.length === 1 ? same[0][0] : null;
    }
  }
  return null;
}
