"""Countries, as the Chrome extension knows them (chrome-extension/src/autofill/countries.js).

A country answer selects that country under any of its names — "United States",
"USA", "United States of America", "U.S.A." — and never a look-alike. difflib
scored "india" against "dominica" at 0.615, over _best_option_match's 0.55, and
EY's Country of Residence was filled Dominica from a list whose first page
stopped there (Oct 2026). A spelling missing from the table leaves the field to
the person, which is the safe direction.

TABLE is countries.js's TABLE, verbatim: test_countries.py keeps them equal.
"""

import re
import unicodedata

TABLE = """
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
"""


def _norm(text) -> str:
    s = unicodedata.normalize("NFD", str(text or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace(".", "")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^the ", "", s)


ENTRIES = [[n.strip() for n in line.split("|") if n.strip()]
           for line in TABLE.strip().splitlines()]

_BY_NAME: dict[str, str] = {}
for _names in ENTRIES:
    for _n in _names:
        _BY_NAME.setdefault(_norm(_n), _names[0])

COUNTRY_NAMES = [names[0] for names in ENTRIES]


def country_of(text) -> str:
    """The country this text names as its subject ("Indian", "U.S.A.",
    "India (+91)", "India › Citizen"), or ''. A country only in brackets is not
    the subject: "Single (India)" is a marital status."""
    raw = str(text or "").strip()
    if not raw:
        return ""
    whole = _BY_NAME.get(_norm(raw))
    if whole:
        return whole
    outside = _BY_NAME.get(_norm(re.sub(r"\([^)]*\)", " ", raw)))
    if outside:
        return outside
    return _BY_NAME.get(_norm(re.split(r"\s*[›>]\s*|\s[-–—:]\s", raw)[0]), "")


def country_option(country: str, labels: list[str]) -> str | None:
    """The label naming `country`, or None — never a near miss. The plain name
    over "India (+91)" when a list has both."""
    if not country:
        return None
    same = [l for l in labels if country_of(l) == country]
    if not same:
        return None
    return next((l for l in same if _norm(l) == _norm(country)), same[0])


def country_share(labels: list[str]) -> float:
    """The share of these labels that are countries: mostly countries is a country list."""
    labels = [l for l in labels if l]
    if not labels:
        return 0.0
    return sum(1 for l in labels if country_of(l)) / len(labels)
