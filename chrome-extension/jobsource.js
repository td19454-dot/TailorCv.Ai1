// Where the job description lives, for a page that only holds the application.
//
// An application form (Workday step 2, Oracle ".../apply/section/1", a Lever
// "/apply") rarely carries the posting it belongs to — but its URL says which
// posting that is, and every major ATS publishes its postings as data. This
// maps an application URL to that posting and reads it back.
//
// Loaded three ways, so it must stay a plain script with no imports and no DOM:
// by the content scripts (manifest.json, before content.js), by the background
// worker (importScripts, like env.js), and by the tests.

(function (root) {
  'use strict';

  function safeUrl(url) {
    try { return new URL(String(url || '')); } catch (e) { return null; }
  }

  /**
   * The posting an application URL belongs to: { ats, key, api } or null.
   * `key` identifies the job across pages and tabs ("workday:nvidia.wd5…:JR2019386");
   * `api` is where its public posting data lives.
   */
  function jobKey(url) {
    const u = safeUrl(url);
    if (!u) return null;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean).map(p => decodeURIComponent(p));

    // Workday: /{lang}/{site}/job/{location}/{Title_REQID}[/apply[/...]]
    if (/\.myworkdayjobs\.com$|\.myworkdaysite\.com$/.test(host)) {
      const j = parts.indexOf('job');
      if (j < 1 || parts.length < j + 3) return null;
      const site = parts[j - 1];
      const loc = parts[j + 1];
      const slug = parts[j + 2];
      const req = (slug.match(/_([A-Za-z0-9-]+)$/) || [])[1] || slug;
      const tenant = host.split('.')[0];
      const path = [loc, slug].map(encodeURIComponent).join('/');
      return { ats: 'workday', key: `workday:${host}:${req}`,
               api: `https://${host}/wday/cxs/${tenant}/${site}/job/${path}` };
    }

    // Greenhouse: /{board}/jobs/{id}, or the embed /embed/job_app?for={board}&token={id}
    if (/(^|\.)greenhouse\.io$/.test(host)) {
      let board = '', id = '';
      if (parts[0] === 'embed') {
        board = u.searchParams.get('for') || '';
        id = u.searchParams.get('token') || '';
      } else {
        const j = parts.indexOf('jobs');
        if (j >= 1) { board = parts[j - 1]; id = parts[j + 1] || ''; }
      }
      id = (id.match(/^\d+/) || [])[0] || '';
      if (!board || !id) return null;
      return { ats: 'greenhouse', key: `greenhouse:${board}:${id}`,
               api: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}` };
    }

    // Lever: jobs.lever.co/{company}/{uuid}[/apply]
    if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
      const [co, id] = parts;
      if (!co || !id || !/^[0-9a-f-]{20,}$/i.test(id)) return null;
      const apiHost = host === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co';
      return { ats: 'lever', key: `lever:${co}:${id}`,
               api: `https://${apiHost}/v0/postings/${co}/${id}` };
    }

    // Oracle Candidate Experience: /hcmUI/CandidateExperience/{lang}/sites/{site}/job/{id}[/apply/...]
    if (/oraclecloud\.com$/.test(host)) {
      const s = parts.indexOf('sites');
      const j = parts.indexOf('job');
      if (s < 0 || j < 0 || !parts[s + 1] || !/^\d+$/.test(parts[j + 1] || '')) return null;
      const site = parts[s + 1];
      const id = parts[j + 1];
      return { ats: 'oracle', key: `oracle:${host}:${id}`,
               api: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`
                  + `?expand=all&onlyData=true&finder=ById;Id=%22${id}%22,siteNumber=${site}` };
    }
    return null;
  }

  /**
   * The posting page for an application URL — what a person would open to read
   * the job: the application steps ("/apply/...") removed, Greenhouse's embed
   * turned back into its board page. Unknown URLs come back unchanged.
   */
  function postingUrl(url) {
    const u = safeUrl(url);
    if (!u) return String(url || '');
    const k = jobKey(url);
    if (k && k.ats === 'greenhouse') {
      const [, board, id] = k.key.split(':');
      return `https://job-boards.greenhouse.io/${board}/jobs/${id}`;
    }
    if (k) {
      const cut = u.pathname.search(/\/apply(\/|$)/);
      const path = cut >= 0 ? u.pathname.slice(0, cut) : u.pathname;
      return `${u.origin}${path}`;
    }
    return u.href;
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

  function decodeEntities(s) {
    return String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCharCode(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
    });
  }

  /** HTML to readable text, without a DOM (the background worker has none). */
  function htmlToText(html) {
    let s = decodeEntities(html);   // Greenhouse sends its HTML entity-escaped
    s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
         .replace(/<\s*(br|\/p|\/div|\/h\d|\/tr)\s*\/?>/gi, '\n')   // <li> adds its own
         .replace(/<\s*li[^>]*>/gi, '\n- ')
         .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s);
    return s.replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  /** { role, company, jd_string } from an ATS's posting data, or null. */
  function parsePosting(ats, data) {
    if (!data || typeof data !== 'object') return null;
    let role = '', company = '', jd = '';
    if (ats === 'workday') {
      const info = data.jobPostingInfo || {};
      role = info.title;
      company = (data.hiringOrganization && data.hiringOrganization.name) || '';
      jd = htmlToText(info.jobDescription);
    } else if (ats === 'greenhouse') {
      role = data.title;
      company = data.company_name || '';
      jd = htmlToText(data.content);
    } else if (ats === 'lever') {
      role = data.text;
      const lists = (data.lists || []).map(l =>
        `${l.text || ''}\n${htmlToText(l.content)}`).join('\n\n');
      jd = [data.descriptionPlain || htmlToText(data.description), lists,
            data.additionalPlain || htmlToText(data.additional)].filter(Boolean).join('\n\n');
    } else if (ats === 'oracle') {
      const item = (data.items || [])[0] || {};
      role = item.Title;
      jd = [item.ExternalDescriptionStr, item.ExternalResponsibilitiesStr,
            item.ExternalQualificationsStr].map(htmlToText).filter(Boolean).join('\n\n');
    }
    jd = String(jd || '').trim();
    if (!jd) return null;
    return { role: clean(role), company: clean(company), jd_string: jd };
  }

  function walkForJobPosting(node, depth) {
    if (!node || depth > 4) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walkForJobPosting(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    const type = node['@type'];
    if ((type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) && node.description) {
      return node;
    }
    return node['@graph'] ? walkForJobPosting(node['@graph'], depth + 1) : null;
  }

  /** A schema.org JobPosting in a page's HTML, as { role, company, jd_string }, or null. */
  function jobPostingFromHtml(html) {
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      let parsed;
      try { parsed = JSON.parse(m[1]); } catch (e) { continue; }
      const job = walkForJobPosting(parsed, 0);
      if (!job) continue;
      const org = job.hiringOrganization;
      const jd = htmlToText(job.description);
      if (!jd) continue;
      return { role: clean(job.title), company: clean(typeof org === 'string' ? org : (org && org.name)),
               jd_string: jd };
    }
    return null;
  }

  /** Do two job titles name the same job? Most of the words, in either order. */
  function sameRole(a, b) {
    const words = t => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(w => w.length > 2));
    const x = words(a), y = words(b);
    if (!x.size || !y.size) return false;
    let shared = 0;
    for (const w of x) if (y.has(w)) shared++;
    return shared / Math.min(x.size, y.size) >= 0.6;
  }

  root.TCVJobSource = { jobKey, postingUrl, parsePosting, jobPostingFromHtml, htmlToText, sameRole };
})(typeof globalThis !== 'undefined' ? globalThis : self);
