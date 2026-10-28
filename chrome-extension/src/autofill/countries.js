// Countries, for citizenship. The profile keeps the country a person is a
// citizen of ("India"); forms ask for it as a country list, a nationality list
// ("Indian"), Workday's per-country status list (India › Citizen), or a Yes/No
// ("Are you a citizen of Singapore?").
//
// One line per country: the name, then the other ways forms write it —
// official names, Workday's spellings, demonyms. The first name on each line
// is the profile's option: keep routers/profile_page.py COUNTRY_OPTIONS in step.

const TABLE = `
Afghanistan|Afghan
Albania|Albanian
Algeria|Algerian
Andorra|Andorran
Angola|Angolan
Antigua and Barbuda|Antiguan
Argentina|Argentine|Argentinian
Armenia|Armenian
Australia|Australian
Austria|Austrian
Azerbaijan|Azerbaijani
Bahamas|The Bahamas|Bahamian
Bahrain|Bahraini
Bangladesh|Bangladeshi
Barbados|Barbadian
Belarus|Belarusian
Belgium|Belgian
Belize|Belizean
Benin|Beninese
Bhutan|Bhutanese
Bolivia|Plurinational State of Bolivia|Bolivia, Plurinational State of|Bolivian
Bosnia and Herzegovina|Bosnian
Botswana|Motswana|Botswanan
Brazil|Brazilian
Brunei|Brunei Darussalam|Bruneian
Bulgaria|Bulgarian
Burkina Faso|Burkinabe
Burundi|Burundian
Cabo Verde|Cape Verde|Cape Verdean
Cambodia|Cambodian
Cameroon|Cameroonian
Canada|Canadian
Central African Republic|Central African
Chad|Chadian
Chile|Chilean
China|People's Republic of China|PRC|Chinese
Colombia|Colombian
Comoros|Comoran
Congo|Republic of the Congo|Congo, Republic of the|Congolese
Democratic Republic of the Congo|DR Congo|DRC|Congo, Democratic Republic of the|Congo, The Democratic Republic of the
Costa Rica|Costa Rican
Cote d'Ivoire|Côte d'Ivoire|Ivory Coast|Ivorian
Croatia|Croatian
Cuba|Cuban
Cyprus|Cypriot
Czech Republic|Czechia|Czech
Denmark|Danish|Dane
Djibouti|Djiboutian
Dominica|Dominican (Dominica)
Dominican Republic|Dominican
Ecuador|Ecuadorian
Egypt|Egyptian
El Salvador|Salvadoran
Equatorial Guinea|Equatoguinean
Eritrea|Eritrean
Estonia|Estonian
Eswatini|Swaziland|Swazi
Ethiopia|Ethiopian
Fiji|Fijian
Finland|Finnish|Finn
France|French
Gabon|Gabonese
Gambia|The Gambia|Gambian
Georgia|Georgian
Germany|German
Ghana|Ghanaian
Greece|Greek
Grenada|Grenadian
Guatemala|Guatemalan
Guinea|Guinean
Guinea-Bissau|Bissau-Guinean
Guyana|Guyanese
Haiti|Haitian
Honduras|Honduran
Hong Kong|Hong Kong SAR|Hong Kong SAR China|Hong Kong SAR, China|Hong Konger
Hungary|Hungarian
Iceland|Icelandic|Icelander
India|Republic of India|Indian
Indonesia|Indonesian
Iran|Iran, Islamic Republic of|Islamic Republic of Iran|Iranian
Iraq|Iraqi
Ireland|Republic of Ireland|Irish
Israel|Israeli
Italy|Italian
Jamaica|Jamaican
Japan|Japanese
Jordan|Jordanian
Kazakhstan|Kazakhstani|Kazakh
Kenya|Kenyan
Kiribati|I-Kiribati
Kosovo|Kosovar
Kuwait|Kuwaiti
Kyrgyzstan|Kyrgyz
Laos|Lao People's Democratic Republic|Lao|Laotian
Latvia|Latvian
Lebanon|Lebanese
Lesotho|Basotho
Liberia|Liberian
Libya|Libyan
Liechtenstein|Liechtensteiner
Lithuania|Lithuanian
Luxembourg|Luxembourgish|Luxembourger
Macau|Macao|Macao SAR China|Macanese
Madagascar|Malagasy
Malawi|Malawian
Malaysia|Malaysian
Maldives|Maldivian
Mali|Malian
Malta|Maltese
Marshall Islands|Marshallese
Mauritania|Mauritanian
Mauritius|Mauritian
Mexico|Mexican
Micronesia|Micronesia, Federated States of|Micronesian
Moldova|Moldova, Republic of|Republic of Moldova|Moldovan
Monaco|Monegasque
Mongolia|Mongolian
Montenegro|Montenegrin
Morocco|Moroccan
Mozambique|Mozambican
Myanmar|Burma|Burmese
Namibia|Namibian
Nauru|Nauruan
Nepal|Nepalese|Nepali
Netherlands|The Netherlands|Holland|Dutch
New Zealand|New Zealander
Nicaragua|Nicaraguan
Niger|Nigerien
Nigeria|Nigerian
North Korea|Korea, Democratic People's Republic of|Democratic People's Republic of Korea|North Korean
North Macedonia|Macedonia|Macedonian
Norway|Norwegian
Oman|Omani
Pakistan|Pakistani
Palau|Palauan
Palestine|Palestine, State of|State of Palestine|Palestinian Territory|Palestinian
Panama|Panamanian
Papua New Guinea|Papua New Guinean
Paraguay|Paraguayan
Peru|Peruvian
Philippines|The Philippines|Filipino|Philippine
Poland|Polish
Portugal|Portuguese
Puerto Rico|Puerto Rican
Qatar|Qatari
Romania|Romanian
Russia|Russian Federation|Russian
Rwanda|Rwandan
Saint Kitts and Nevis|Kittitian
Saint Lucia|Saint Lucian
Saint Vincent and the Grenadines|Vincentian
Samoa|Samoan
San Marino|Sammarinese
Sao Tome and Principe|São Tomé and Príncipe|Santomean
Saudi Arabia|Saudi|Saudi Arabian
Senegal|Senegalese
Serbia|Serbian
Seychelles|Seychellois
Sierra Leone|Sierra Leonean
Singapore|Singaporean
Slovakia|Slovak Republic|Slovak
Slovenia|Slovenian|Slovene
Solomon Islands|Solomon Islander
Somalia|Somali
South Africa|South African
South Korea|Korea, Republic of|Republic of Korea|Korea|Korean|South Korean
South Sudan|South Sudanese
Spain|Spanish|Spaniard
Sri Lanka|Sri Lankan
Sudan|Sudanese
Suriname|Surinamese
Sweden|Swedish|Swede
Switzerland|Swiss
Syria|Syrian Arab Republic|Syrian
Taiwan|Taiwan, Province of China|Taiwanese
Tajikistan|Tajik
Tanzania|Tanzania, United Republic of|United Republic of Tanzania|Tanzanian
Thailand|Thai
Timor-Leste|East Timor|Timorese
Togo|Togolese
Tonga|Tongan
Trinidad and Tobago|Trinidadian|Tobagonian
Tunisia|Tunisian
Turkey|Türkiye|Turkiye|Turkish
Turkmenistan|Turkmen
Tuvalu|Tuvaluan
Uganda|Ugandan
Ukraine|Ukrainian
United Arab Emirates|UAE|Emirati
United Kingdom|UK|U.K.|Great Britain|Britain|British|England|Scotland|Wales|Northern Ireland|English|Scottish|Welsh
United States|United States of America|USA|U.S.A.|US|U.S.|America|American
Uruguay|Uruguayan
Uzbekistan|Uzbek
Vanuatu|Ni-Vanuatu
Vatican City|Holy See|Holy See (Vatican City State)
Venezuela|Venezuela, Bolivarian Republic of|Venezuelan
Vietnam|Viet Nam|Vietnamese
Yemen|Yemeni
Zambia|Zambian
Zimbabwe|Zimbabwean
`;

// Matched only as written, never as a lowercase word: "us" in "tell us" and
// "contact us" is not the United States.
const CASE_SENSITIVE = new Set(['US', 'U.S.', 'UK', 'U.K.', 'USA', 'U.S.A.', 'UAE', 'PRC', 'DRC']);

const ENTRIES = TABLE.trim().split('\n').map(line => {
  const names = line.split('|').map(s => s.trim()).filter(Boolean);
  return { name: names[0], names };
});

function norm(text) {
  return String(text == null ? '' : text).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

const BY_NAME = new Map();
for (const e of ENTRIES) {
  for (const n of e.names) {
    const k = norm(n);
    if (k && !BY_NAME.has(k)) BY_NAME.set(k, e.name);
  }
}

export const COUNTRY_NAMES = ENTRIES.map(e => e.name);

/**
 * The country this text names as its subject ("Indian", "Viet Nam", "U.S.A.",
 * "India (+91)", "India › Citizen"), or ''.
 *
 * A country only in parentheses is not the subject: Workday suffixes options
 * with their country — "Single (India)", "Divorced (India)" — and reading
 * those as "India" made a marital-status list look like a country list, so
 * "Single (India)" was answered with its first entry, "Divorced (India)"
 * (PwC, Oct 2026). `inParens` allows it, for the one place that needs it:
 * Workday's citizenship statuses, "Citizen (India)".
 */
export function countryOf(text, inParens = false) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';
  const whole = BY_NAME.get(norm(raw));
  if (whole) return whole;
  const outside = BY_NAME.get(norm(raw.replace(/\([^)]*\)/g, ' ')));
  if (outside) return outside;
  if (inParens) {
    const inside = /\(([^)]+)\)/.exec(raw);
    if (inside) {
      const c = BY_NAME.get(norm(inside[1]));
      if (c) return c;
    }
  }
  return BY_NAME.get(norm(raw.split(/\s*[›>]\s*|\s[-–—:]\s/)[0])) || '';
}

/** Every way a form may write this country, its own name first. */
export function countryShapes(country) {
  const e = ENTRIES.find(x => x.name === country);
  return e ? e.names.slice() : (country ? [country] : []);
}

const labelOf = o => (typeof o === 'string' ? o : (o && o.label) || '');

/** The option naming `country`, or null. Never a near-miss: a wrong country is a false statement. */
export function countryOption(country, options) {
  if (!country) return null;
  const labels = (options || []).map(labelOf);
  const same = labels.filter(l => countryOf(l) === country);
  if (!same.length) return null;
  // The plain name over "India (+91)" when a list has both.
  return same.find(l => norm(l) === norm(country)) || same[0];
}

/** The share of these options that are countries: a list mostly of countries is a country list. */
export function countryShare(options) {
  const labels = (options || []).map(labelOf).filter(Boolean);
  if (!labels.length) return 0;
  return labels.filter(l => countryOf(l)).length / labels.length;
}

/**
 * The one country a question asks about: "Are you a citizen of Singapore?",
 * "Are you a U.S. citizen?", "Do you hold Canadian citizenship?". '' when it
 * names none, or more than one.
 */
export function countryNamedIn(question) {
  const raw = String(question || '');
  const padded = ' ' + norm(raw) + ' ';
  const hits = [];   // [country, matched name]
  for (const e of ENTRIES) {
    for (const n of e.names) {
      if (CASE_SENSITIVE.has(n)) {
        const esc = n.replace(/\./g, '\\.');
        if (new RegExp(`(^|[^A-Za-z.])${esc}(?![A-Za-z])`).test(raw)) hits.push([e.name, norm(n)]);
        continue;
      }
      const k = norm(n);
      if (k.length > 2 && padded.includes(' ' + k + ' ')) hits.push([e.name, k]);
    }
  }
  // A name inside a longer matched name is not a second country: "Ireland" in
  // "Northern Ireland", "Sudan" in "South Sudan", "India" in "British Indian…".
  const kept = hits.filter(([c, k]) => !hits.some(([c2, k2]) =>
    c2 !== c && k2 !== k && (' ' + k2 + ' ').includes(' ' + k + ' ')));
  const countries = new Set(kept.map(([c]) => c));
  return countries.size === 1 ? Array.from(countries)[0] : '';
}
