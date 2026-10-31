"""The profile page: every value autofill puts into an application form, in one
place, viewable and editable.

  GET    /profile                       the page
  GET    /api/profile                   stored + effective values, per field
  POST   /api/profile                   save (partial: only the keys sent change)
  GET    /api/profile/answers           the learned question -> answer store
  PUT    /api/profile/answers/{id}      edit one
  DELETE /api/profile/answers/{id}      forget one

Why a page and not only the Job Dashboard modal: the modal was built for one
job (collect the minimum an unattended auto-apply run needs) and shows a subset
of what autofill actually uses. Education, employers and skills came only from
the resume parse and could not be seen or corrected anywhere. This page shows
what a form will actually receive — including values that are only suggested
from the resume so far — and lets each be saved.

FIELDS below is the single definition of the page: it drives rendering, the
save mapping and the "what autofill will use" read. A field added here appears,
saves and reports its effective value with no second place to update.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

import document_store
from database import SessionLocal
from models import User, UserApplyProfile, UserApplyQA

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

YES_NO = [("", "Not set"), ("yes", "Yes"), ("no", "No")]
REMOTE = [("", "Not set"), ("remote", "Remote"), ("hybrid", "Hybrid"),
          ("onsite", "On-site"), ("flexible", "Flexible")]
EEO_NOTE = "Not set — we answer “Decline to self-identify”"
TITLE_OPTIONS = [("", "Not set"), ("Mr.", "Mr."), ("Ms.", "Ms."), ("Mrs.", "Mrs."),
                 ("Miss", "Miss"), ("Mx.", "Mx."), ("Dr.", "Dr.")]

# EEO answers as the MOST detailed lists real forms use (these are Greenhouse's
# demographic questions, e.g. job-boards.greenhouse.io/robinhood). Storing the
# finest answer lets the extension widen it onto a coarser form — "Cisgender
# man" answers "Male", "I have never served in the military" answers "I am not a
# protected veteran" — which can't be done in the other direction without
# guessing. Matching lives in chrome-extension/src/autofill/match.js EEO_GROUPS.
EEO_UNSET = ("", "Not set — we answer “Decline to self-identify”")


def _eeo(*labels: str) -> list:
    return [EEO_UNSET] + [(label, label) for label in labels]


GENDER_OPTIONS = _eeo(
    "Cisgender woman", "Cisgender man", "Transgender woman", "Transgender man",
    "Non-binary", "Two-spirit", "My gender identity is not listed")
RACE_OPTIONS = _eeo(
    "American Indian or Alaskan Native", "Black or African American", "East Asian",
    "Hispanic or Latino", "Middle Eastern or North African",
    "Native Hawaiian or Other Pacific Islander", "South Asian", "Southeast Asian", "White",
    "Two or More Races")
VETERAN_OPTIONS = _eeo(
    "I have never served in the military", "I identify as a protected veteran",
    "I identify as a non-protected veteran", "I am on active duty",
    "I am part of the national guard or on reserve",
    "I identify in multiple military status categories")
DISABILITY_OPTIONS = _eeo(
    "Yes, I have a disability (or previously had a disability)",
    "No, I don't have a disability")
PRONOUN_OPTIONS = _eeo("He/him", "She/her", "They/them", "He/they", "She/they",
                       "Ze/zir", "My pronouns are not listed")
LGBTQ_OPTIONS = _eeo("Yes", "No", "Questioning")

# The profile's Degree dropdown, grouped by level. Each is the person's actual
# degree; the extension's DEGREE_CATALOG (chrome-extension/src/autofill/plan.js)
# turns it into what each employer's list calls it — "BTECH" on Workday,
# "Bachelor's Degree" on Greenhouse. test_degree_options.py checks that every
# label here is recognised there.
DEGREE_GROUPS = [
    ("Doctorate", ["PhD (Doctor of Philosophy)", "MD (Doctor of Medicine)", "JD (Juris Doctor)"]),
    ("Master's", ["M.Tech (Master of Technology)", "M.E. (Master of Engineering)",
                  "M.S. / M.Sc (Master of Science)", "MCA (Master of Computer Applications)",
                  "MBA (Master of Business Administration)", "M.A. (Master of Arts)",
                  "M.Com (Master of Commerce)", "Master's degree (other)"]),
    ("Bachelor's", ["B.Tech (Bachelor of Technology)", "B.E. (Bachelor of Engineering)",
                    "B.S. / B.Sc (Bachelor of Science)", "BCA (Bachelor of Computer Applications)",
                    "BBA (Bachelor of Business Administration)", "B.A. (Bachelor of Arts)",
                    "B.Com (Bachelor of Commerce)", "Bachelor's degree (other)"]),
    ("Other", ["Associate's degree", "University Diploma", "Diploma", "Post-diploma studies",
               "Technical/other training", "Some post college", "Some college",
               "High School", "No degree"]),
]

# The profile's Field of Study dropdown: Workday's own list (NVIDIA, Oct 2026),
# spelled exactly as Workday spells it, so the value autofill puts into
# Workday's Field of Study box is one of its options verbatim — no fuzzy match.
# Workday lists "Electronics & Communication" twice (once in capitals); kept once.
FIELD_OF_STUDY_OPTIONS = [
    "Accounting", "Advanced Computing", "Advertising", "Aeronautical Engineering", "Aerospace",
    "Agriculture", "Animation", "Applications Design and Data Analysis", "Applied Computing",
    "Applied Electronics", "Applied Informatics", "Applied Mathematics", "Applied Science",
    "Applied Statistics", "Architecture", "Art", "Artificial Intelligence", "Automation",
    "Automotive Engineering", "Big Data Algorithms", "Biochemistry", "BioComputational Physics",
    "Bio-Electrical Engineering", "Bioengineering", "Bioinformatics", "Biology",
    "Biomedical Applications", "Biomedical Engineering", "Business Administration",
    "Business Analytics", "Business Management", "Catalysis Science", "Chartered Accountant",
    "Chemical Engineering", "Chemistry", "Civil Engineering", "Cognitive Science", "Communications",
    "Complexity Science & Engineering", "Computational Fluid Dynamics",
    "Computational Mathematics", "Computational Science & Engineering", "Computer & Info Science",
    "Computer Application", "Computer Engineering", "Computer Games",
    "Computer Information Systems", "Computer Networking", "Computer Science",
    "Computer Science & Engin.", "Computer System Design", "Computer Vision and Machine Learning",
    "Control & Instrumentation", "Control Science and Engineering", "Data Science",
    "Deep Learning", "Design Technology", "Ecommerce", "Economics", "Education",
    "Electrical & Computer Engineering", "Electrical and Electronics Engineering",
    "Electrical Engineering", "Electrical Engineering and Computer Science",
    "Electronic Engineering", "Electronics", "Electronics & Communication",
    "Embedded System Design", "Energy and Environmental Systems", "Engineering", "English",
    "Entrepreneurship", "Finance", "Game Design", "Geomatics Engineering", "Graphic Design",
    "High Performance Computing", "History", "HumanComputer Interaction", "Humanities",
    "Human Resources", "Images", "Industrial Arts", "Industrial Engineering",
    "Information systems & Technologies", "Information Technology",
    "Innovation and Research Results Transfer", "Interactive Telecommunications Program",
    "Interdisciplinary Studies", "Law", "Logic and Methodology of Science", "Machine Learning",
    "Management Information Systems", "Management science and Engineering", "Marketing",
    "Materials Engineering", "Mathematics", "Mechanical and Electrical Engineering",
    "Mechanical Engineering", "Mechanics", "Mechatronics Engineering", "Media Arts and Animation",
    "Neuroscience", "No Degree", "Other", "Physical Chemistry", "Physics", "Political Science",
    "Product Development & Management", "Product Management", "Project Management",
    "Psychology", "Public Relations", "Radio Physics", "Robotics Engineering", "Robotic Systems",
    "Science", "Scientific Computing", "Software Engineering", "Speech Recognition", "Statistics",
    "Technical Management", "Telecommunication", "Thermal Engineering", "Visual Communication",
    "Visual Psychophysics",
]

# "Citizenship Status" in the categories US forms ask it in (SpaceX's ITAR list:
# citizen or national / lawful permanent resident / refugee / asylee / DACA /
# other). A fixed list, not free text: plan.js CITIZENSHIP_GROUPS maps each onto
# the form's own wording, and only within the same group.
CITIZENSHIP_OPTIONS = [
    ("", "Not set"),
    ("U.S. citizen or national", "U.S. citizen or national"),
    ("U.S. lawful permanent resident (green card)", "U.S. lawful permanent resident (green card)"),
    ("Refugee", "Refugee"),
    ("Asylee", "Asylee"),
    ("DACA recipient", "DACA recipient"),
    ("Not a U.S. citizen or permanent resident", "Not a U.S. citizen or permanent resident"),
]

# Country of citizenship. The first names of chrome-extension/src/autofill/
# countries.js, which autofill reads this against ("Are you a citizen of …?",
# country and nationality lists, Workday's per-country citizenship list).
COUNTRY_OPTIONS = [("", "Not set")] + [(c, c) for c in [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
    "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
    "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
    "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso",
    "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic",
    "Chad", "Chile", "China", "Colombia", "Comoros", "Congo",
    "Democratic Republic of the Congo", "Costa Rica", "Cote d'Ivoire", "Croatia", "Cuba",
    "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
    "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini",
    "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana",
    "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras",
    "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
    "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
    "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia",
    "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macau", "Madagascar", "Malawi",
    "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius",
    "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
    "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand",
    "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman",
    "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
    "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar", "Romania", "Russia", "Rwanda",
    "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa",
    "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
    "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
    "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
    "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
    "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
    "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
    "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen",
    "Zambia", "Zimbabwe",
]]

NATIONALITY_LEGACY = {
    "afghan": "Afghanistan",
    "albanian": "Albania",
    "algerian": "Algeria",
    "andorran": "Andorra",
    "angolan": "Angola",
    "antiguan": "Antigua and Barbuda",
    "argentine": "Argentina",
    "argentinian": "Argentina",
    "armenian": "Armenia",
    "australian": "Australia",
    "austrian": "Austria",
    "azerbaijani": "Azerbaijan",
    "the bahamas": "Bahamas",
    "bahamian": "Bahamas",
    "bahraini": "Bahrain",
    "bangladeshi": "Bangladesh",
    "barbadian": "Barbados",
    "belarusian": "Belarus",
    "belgian": "Belgium",
    "belizean": "Belize",
    "beninese": "Benin",
    "bhutanese": "Bhutan",
    "plurinational state of bolivia": "Bolivia",
    "bolivia, plurinational state of": "Bolivia",
    "bolivian": "Bolivia",
    "bosnian": "Bosnia and Herzegovina",
    "motswana": "Botswana",
    "botswanan": "Botswana",
    "brazilian": "Brazil",
    "brunei darussalam": "Brunei",
    "bruneian": "Brunei",
    "bulgarian": "Bulgaria",
    "burkinabe": "Burkina Faso",
    "burundian": "Burundi",
    "cape verde": "Cabo Verde",
    "cape verdean": "Cabo Verde",
    "cambodian": "Cambodia",
    "cameroonian": "Cameroon",
    "canadian": "Canada",
    "central african": "Central African Republic",
    "chadian": "Chad",
    "chilean": "Chile",
    "people's republic of china": "China",
    "prc": "China",
    "chinese": "China",
    "colombian": "Colombia",
    "comoran": "Comoros",
    "republic of the congo": "Congo",
    "congo, republic of the": "Congo",
    "congolese": "Congo",
    "dr congo": "Democratic Republic of the Congo",
    "drc": "Democratic Republic of the Congo",
    "congo, democratic republic of the": "Democratic Republic of the Congo",
    "congo, the democratic republic of the": "Democratic Republic of the Congo",
    "costa rican": "Costa Rica",
    "côte d'ivoire": "Cote d'Ivoire",
    "ivory coast": "Cote d'Ivoire",
    "ivorian": "Cote d'Ivoire",
    "croatian": "Croatia",
    "cuban": "Cuba",
    "cypriot": "Cyprus",
    "czechia": "Czech Republic",
    "czech": "Czech Republic",
    "danish": "Denmark",
    "dane": "Denmark",
    "djiboutian": "Djibouti",
    "dominican (dominica)": "Dominica",
    "dominican": "Dominican Republic",
    "ecuadorian": "Ecuador",
    "egyptian": "Egypt",
    "salvadoran": "El Salvador",
    "equatoguinean": "Equatorial Guinea",
    "eritrean": "Eritrea",
    "estonian": "Estonia",
    "swaziland": "Eswatini",
    "swazi": "Eswatini",
    "ethiopian": "Ethiopia",
    "fijian": "Fiji",
    "finnish": "Finland",
    "finn": "Finland",
    "french": "France",
    "gabonese": "Gabon",
    "the gambia": "Gambia",
    "gambian": "Gambia",
    "georgian": "Georgia",
    "german": "Germany",
    "ghanaian": "Ghana",
    "greek": "Greece",
    "grenadian": "Grenada",
    "guatemalan": "Guatemala",
    "guinean": "Guinea",
    "bissau-guinean": "Guinea-Bissau",
    "guyanese": "Guyana",
    "haitian": "Haiti",
    "honduran": "Honduras",
    "hong kong sar": "Hong Kong",
    "hong kong sar china": "Hong Kong",
    "hong kong sar, china": "Hong Kong",
    "hong konger": "Hong Kong",
    "hungarian": "Hungary",
    "icelandic": "Iceland",
    "icelander": "Iceland",
    "republic of india": "India",
    "indian": "India",
    "indonesian": "Indonesia",
    "iran, islamic republic of": "Iran",
    "islamic republic of iran": "Iran",
    "iranian": "Iran",
    "iraqi": "Iraq",
    "republic of ireland": "Ireland",
    "irish": "Ireland",
    "israeli": "Israel",
    "italian": "Italy",
    "jamaican": "Jamaica",
    "japanese": "Japan",
    "jordanian": "Jordan",
    "kazakhstani": "Kazakhstan",
    "kazakh": "Kazakhstan",
    "kenyan": "Kenya",
    "i-kiribati": "Kiribati",
    "kosovar": "Kosovo",
    "kuwaiti": "Kuwait",
    "kyrgyz": "Kyrgyzstan",
    "lao people's democratic republic": "Laos",
    "lao": "Laos",
    "laotian": "Laos",
    "latvian": "Latvia",
    "lebanese": "Lebanon",
    "basotho": "Lesotho",
    "liberian": "Liberia",
    "libyan": "Libya",
    "liechtensteiner": "Liechtenstein",
    "lithuanian": "Lithuania",
    "luxembourgish": "Luxembourg",
    "luxembourger": "Luxembourg",
    "macao": "Macau",
    "macao sar china": "Macau",
    "macanese": "Macau",
    "malagasy": "Madagascar",
    "malawian": "Malawi",
    "malaysian": "Malaysia",
    "maldivian": "Maldives",
    "malian": "Mali",
    "maltese": "Malta",
    "marshallese": "Marshall Islands",
    "mauritanian": "Mauritania",
    "mauritian": "Mauritius",
    "mexican": "Mexico",
    "micronesia, federated states of": "Micronesia",
    "micronesian": "Micronesia",
    "moldova, republic of": "Moldova",
    "republic of moldova": "Moldova",
    "moldovan": "Moldova",
    "monegasque": "Monaco",
    "mongolian": "Mongolia",
    "montenegrin": "Montenegro",
    "moroccan": "Morocco",
    "mozambican": "Mozambique",
    "burma": "Myanmar",
    "burmese": "Myanmar",
    "namibian": "Namibia",
    "nauruan": "Nauru",
    "nepalese": "Nepal",
    "nepali": "Nepal",
    "the netherlands": "Netherlands",
    "holland": "Netherlands",
    "dutch": "Netherlands",
    "new zealander": "New Zealand",
    "nicaraguan": "Nicaragua",
    "nigerien": "Niger",
    "nigerian": "Nigeria",
    "korea, democratic people's republic of": "North Korea",
    "democratic people's republic of korea": "North Korea",
    "north korean": "North Korea",
    "macedonia": "North Macedonia",
    "macedonian": "North Macedonia",
    "norwegian": "Norway",
    "omani": "Oman",
    "pakistani": "Pakistan",
    "palauan": "Palau",
    "palestine, state of": "Palestine",
    "state of palestine": "Palestine",
    "palestinian territory": "Palestine",
    "palestinian": "Palestine",
    "panamanian": "Panama",
    "papua new guinean": "Papua New Guinea",
    "paraguayan": "Paraguay",
    "peruvian": "Peru",
    "the philippines": "Philippines",
    "filipino": "Philippines",
    "philippine": "Philippines",
    "polish": "Poland",
    "portuguese": "Portugal",
    "puerto rican": "Puerto Rico",
    "qatari": "Qatar",
    "romanian": "Romania",
    "russian federation": "Russia",
    "russian": "Russia",
    "rwandan": "Rwanda",
    "kittitian": "Saint Kitts and Nevis",
    "saint lucian": "Saint Lucia",
    "vincentian": "Saint Vincent and the Grenadines",
    "samoan": "Samoa",
    "sammarinese": "San Marino",
    "são tomé and príncipe": "Sao Tome and Principe",
    "santomean": "Sao Tome and Principe",
    "saudi": "Saudi Arabia",
    "saudi arabian": "Saudi Arabia",
    "senegalese": "Senegal",
    "serbian": "Serbia",
    "seychellois": "Seychelles",
    "sierra leonean": "Sierra Leone",
    "singaporean": "Singapore",
    "slovak republic": "Slovakia",
    "slovak": "Slovakia",
    "slovenian": "Slovenia",
    "slovene": "Slovenia",
    "solomon islander": "Solomon Islands",
    "somali": "Somalia",
    "south african": "South Africa",
    "korea, republic of": "South Korea",
    "republic of korea": "South Korea",
    "korea": "South Korea",
    "korean": "South Korea",
    "south korean": "South Korea",
    "south sudanese": "South Sudan",
    "spanish": "Spain",
    "spaniard": "Spain",
    "sri lankan": "Sri Lanka",
    "sudanese": "Sudan",
    "surinamese": "Suriname",
    "swedish": "Sweden",
    "swede": "Sweden",
    "swiss": "Switzerland",
    "syrian arab republic": "Syria",
    "syrian": "Syria",
    "taiwan, province of china": "Taiwan",
    "taiwanese": "Taiwan",
    "tajik": "Tajikistan",
    "tanzania, united republic of": "Tanzania",
    "united republic of tanzania": "Tanzania",
    "tanzanian": "Tanzania",
    "thai": "Thailand",
    "east timor": "Timor-Leste",
    "timorese": "Timor-Leste",
    "togolese": "Togo",
    "tongan": "Tonga",
    "trinidadian": "Trinidad and Tobago",
    "tobagonian": "Trinidad and Tobago",
    "tunisian": "Tunisia",
    "türkiye": "Turkey",
    "turkiye": "Turkey",
    "turkish": "Turkey",
    "turkmen": "Turkmenistan",
    "tuvaluan": "Tuvalu",
    "ugandan": "Uganda",
    "ukrainian": "Ukraine",
    "uae": "United Arab Emirates",
    "emirati": "United Arab Emirates",
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "great britain": "United Kingdom",
    "britain": "United Kingdom",
    "british": "United Kingdom",
    "england": "United Kingdom",
    "scotland": "United Kingdom",
    "wales": "United Kingdom",
    "northern ireland": "United Kingdom",
    "english": "United Kingdom",
    "scottish": "United Kingdom",
    "welsh": "United Kingdom",
    "united states of america": "United States",
    "usa": "United States",
    "u.s.a.": "United States",
    "us": "United States",
    "u.s.": "United States",
    "america": "United States",
    "american": "United States",
    "uruguayan": "Uruguay",
    "uzbek": "Uzbekistan",
    "ni-vanuatu": "Vanuatu",
    "holy see": "Vatican City",
    "holy see (vatican city state)": "Vatican City",
    "venezuela, bolivarian republic of": "Venezuela",
    "venezuelan": "Venezuela",
    "viet nam": "Vietnam",
    "vietnamese": "Vietnam",
    "yemeni": "Yemen",
    "zambian": "Zambia",
    "zimbabwean": "Zimbabwe",
}

def nationality_canonical(value: str) -> str:
    """The country an older free-text nationality ("Indian") names, or the value as-is."""
    text = (value or "").strip()
    return NATIONALITY_LEGACY.get(text.lower(), text)


# Free-text answers saved before these were dropdowns, mapped onto the option
# that says the same thing. Only unambiguous ones: "Not a protected veteran" is
# left alone because a non-protected veteran says that too.
EEO_LEGACY = {
    "gender": {"male": "Cisgender man", "man": "Cisgender man",
               "female": "Cisgender woman", "woman": "Cisgender woman",
               "non-binary": "Non-binary", "nonbinary": "Non-binary"},
    "race_ethnicity": {"asian indian": "South Asian", "indian": "South Asian",
                       "white / european": "White", "caucasian": "White",
                       "american indian or alaska native": "American Indian or Alaskan Native",
                       "two or more": "Two or More Races", "multiracial": "Two or More Races"},
    "veteran_status": {"not a veteran": "I have never served in the military",
                       "i am not a veteran": "I have never served in the military",
                       "never served": "I have never served in the military",
                       "protected veteran": "I identify as a protected veteran",
                       "i identify as one or more of the classifications of protected veteran":
                           "I identify as a protected veteran"},
    "disability_status": {"no disability": "No, I don't have a disability",
                          "no": "No, I don't have a disability",
                          "not disabled": "No, I don't have a disability",
                          "no, i do not have a disability": "No, I don't have a disability",
                          "yes": "Yes, I have a disability (or previously had a disability)",
                          "yes, i have a disability":
                              "Yes, I have a disability (or previously had a disability)"},
    "gender_pronouns": {"he/him/his": "He/him", "she/her/hers": "She/her",
                        "they/them/theirs": "They/them"},
    "lgbtq_identity": {},
}


def eeo_canonical(column: str, value: str) -> str:
    """The dropdown option an older free-text EEO answer means, or the value as-is."""
    text = (value or "").strip()
    return EEO_LEGACY.get(column, {}).get(text.lower(), text)


@dataclass
class Spec:
    key: str                 # form / JSON key
    column: str              # UserApplyProfile column ('' = not stored there)
    label: str
    kind: str = "text"       # text | textarea | select | phone | readonly | checkbox
    options: list = field(default_factory=list)
    placeholder: str = ""
    help: str = ""
    wide: bool = False
    max_len: int = 200


SECTIONS: list[tuple[str, str, list[Spec]]] = [
    ("name", "Legal name", [
        Spec("nameTitle", "name_title", "Title", kind="select", options=TITLE_OPTIONS,
             help="For forms that ask Mr. / Ms. / Dr. Left empty, those stay blank.", max_len=20),
        Spec("firstName", "first_name", "First name", max_len=80),
        Spec("middleName", "middle_name", "Middle name", placeholder="Leave empty if you have none",
             max_len=80),
        Spec("lastName", "last_name", "Last name", max_len=80),
    ]),
    ("contact", "Contact", [
        Spec("email", "", "Email", kind="readonly",
             help="Your account email. Change it in account settings."),
        Spec("phone", "phone", "Phone", kind="phone",
             help="Country code and number are kept separate, so forms with their own "
                  "country-code field get just the number."),
        Spec("linkedinUrl", "linkedin_url", "LinkedIn", placeholder="linkedin.com/in/…", max_len=300),
        Spec("githubUrl", "github_url", "GitHub", placeholder="github.com/…", max_len=300),
        Spec("portfolioUrl", "portfolio_url", "Portfolio / website", placeholder="https://…",
             max_len=300),
    ]),
    ("address", "Address", [
        Spec("addressLine1", "address_line1", "Address line 1", placeholder="House / flat, street",
             wide=True),
        Spec("addressLine2", "address_line2", "Address line 2", placeholder="Area, landmark (optional)",
             wide=True),
        Spec("city", "city", "City", max_len=100),
        Spec("state", "state", "State / region", max_len=100,
             help="Forms often call this “Region”."),
        Spec("postalCode", "postal_code", "Postal code", max_len=20),
        Spec("country", "country", "Country", max_len=80),
        Spec("location", "location", "Location (one line)", placeholder="City, Country",
             help="Used for “Where are you based?” when the parts above are empty.", max_len=160),
    ]),
    ("work", "Work experience", [
        # Every job, in the shape Workday's My Experience asks for. The current
        # title / company and previous company that single-box forms ask for
        # are read from this list.
        Spec("workExperience", "work_experience", "Jobs", kind="experience", wide=True,
             help="Most recent first. Dates as MM/YYYY, the way Workday asks for them.",
             max_len=60000),
        Spec("yearsExperience", "years_experience", "Years of experience", placeholder="e.g. 3",
             max_len=20),
        Spec("skills", "skills", "Key skills", kind="textarea", wide=True,
             placeholder="Comma-separated", max_len=2000),
    ]),
    ("education", "Education", [
        # Every school, in the shape Workday's Education section asks for. The
        # single University / Degree / Major boxes other forms have are read
        # from the first (most recent) entry.
        Spec("educationHistory", "education_history", "Schools", kind="education", wide=True,
             help="Most recent first, as Workday's Education section asks: school, degree, "
                  "field of study, overall result (GPA), and years — “To” can be your expected "
                  "graduation year.",
             max_len=20000),
        Spec("gpa", "gpa", "GPA / CGPA / percentage", placeholder="e.g. 8.7/10 or 85%",
             help="For forms with a single GPA box. Also used for your first school when "
                  "its own GPA is empty.", max_len=20),
    ]),
    ("eligibility", "Work eligibility", [
        Spec("workAuthorized", "work_authorized", "Authorized to work in the job's country?",
             kind="select", options=YES_NO,
             help="Only ever filled from this answer — never guessed."),
        Spec("requiresSponsorship", "requires_sponsorship", "Need visa sponsorship?",
             kind="select", options=YES_NO),
        Spec("visaStatus", "visa_status", "Visa status", max_len=60),
        Spec("nationality", "nationality", "Country of citizenship",
             kind="select", options=COUNTRY_OPTIONS,
             help="Citizenship and nationality questions are answered from this — "
                  "“Are you a citizen of …?” by comparing with it. Never guessed from "
                  "your address or phone number.", max_len=80),
        Spec("citizenshipStatus", "citizenship_status", "U.S. immigration status (only if it applies)",
             kind="select", options=CITIZENSHIP_OPTIONS,
             help="Leave empty unless you hold U.S. citizenship, a green card, refugee or "
                  "asylee status, or DACA. Left empty, US forms are answered from your "
                  "country of citizenship.", max_len=80),
        Spec("governmentOfficial", "government_official",
             "Are you, or have you ever been, a government official?",
             kind="select", options=YES_NO,
             help="Includes any employee of a government department or agency, a "
                  "state-owned or government-controlled company, a public international "
                  "organisation, a political party or its officials, and candidates for "
                  "political office. Filled only from this answer — never guessed."),
        Spec("familyGovernmentOfficial", "family_government_official",
             "Is anyone in your family a government official, now or in the past?",
             kind="select", options=YES_NO,
             help="Immediate family or other relatives — same definition as above."),
        Spec("criminalHistory", "criminal_history",
             "Have you ever been convicted of any crime, or do you have criminal charges pending?",
             kind="select", options=YES_NO,
             help="Felonies and misdemeanours, in any country. “No” is filled on every "
                  "criminal-history question; with “Yes” you answer each one yourself. "
                  "Questions asking you to consent to a background check are never "
                  "answered from this."),
        Spec("willingToRelocate", "willing_to_relocate", "Willing to relocate?",
             kind="select", options=YES_NO),
        Spec("remotePreference", "remote_preference", "Work arrangement", kind="select",
             options=REMOTE),
    ]),
    # Workday's Voluntary Disclosures ask these. Filled only from here by the
    # extension; never part of what any model is shown (PRIVATE_KEYS).
    ("birth", "Date & place of birth", [
        Spec("dateOfBirth", "date_of_birth", "Date of birth", kind="date",
             help="Only for forms that ask. Filled from here, never sent to the AI.", max_len=10),
        Spec("countryOfBirth", "country_of_birth", "Country of birth", kind="select",
             options=COUNTRY_OPTIONS,
             help="Left empty, forms get your country of citizenship.", max_len=80),
        Spec("cityOfBirth", "city_of_birth", "City of birth", max_len=100,
             help="Only for forms that ask. Never sent to the AI."),
    ]),
    ("availability", "Availability & compensation", [
        Spec("noticePeriod", "notice_period", "Notice period", placeholder="e.g. 30 days",
             max_len=60),
        Spec("availableStartDate", "available_start_date", "Earliest start date",
             placeholder="e.g. 01/09/2026", max_len=60),
        Spec("expectedSalary", "expected_salary", "Expected salary",
             help="Only ever filled from this answer — never guessed.", max_len=60),
    ]),
    ("answers", "Common questions", [
        Spec("whyThisRole", "why_this_role", "Why do you want this role?", kind="textarea",
             wide=True, help="Offered for review on each form, never submitted unread.",
             max_len=2000),
    ]),
    ("eeo", "Voluntary self-identification", [
        Spec("gender", "gender", "Gender identity", kind="select", options=GENDER_OPTIONS,
             help="Also answers plain Male / Female questions.", max_len=60),
        Spec("raceEthnicity", "race_ethnicity", "Race / ethnicity", kind="select",
             options=RACE_OPTIONS,
             help="Forms with broader groups get the group yours belongs to "
                  "(South Asian → Asian).", max_len=80),
        Spec("veteranStatus", "veteran_status", "Military / veteran status", kind="select",
             options=VETERAN_OPTIONS,
             help="“Never served” also answers “I am not a protected veteran”.", max_len=80),
        Spec("disabilityStatus", "disability_status", "Disability status", kind="select",
             options=DISABILITY_OPTIONS, max_len=80),
        Spec("genderPronouns", "gender_pronouns", "Pronouns", kind="select",
             options=PRONOUN_OPTIONS, max_len=40),
        Spec("lgbtqIdentity", "lgbtq_identity", "LGBTQ+ identity", kind="select",
             options=LGBTQ_OPTIONS, max_len=60),
    ]),
    ("consent", "Permissions", [
        Spec("agreeToEmployerTerms", "agreed_to_employer_terms",
             "Agree to employers' terms / privacy policies when a form asks", kind="checkbox",
             wide=True),
        Spec("consent", "", "Allow TailorCV to submit applications for me (server auto-apply only)",
             kind="checkbox", wide=True,
             help="Not needed for the Chrome extension, which never submits."),
    ]),
]

ALL_SPECS = {s.key: s for _, _, specs in SECTIONS for s in specs}
EEO_COLUMNS = {"gender", "race_ethnicity", "veteran_status", "disability_status",
               "gender_pronouns", "lgbtq_identity"}
SELECT_VALUES = {s.key: {v for v, _ in s.options} for s in ALL_SPECS.values() if s.kind == "select"}


def _require_user(request: Request, db):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


# ── what autofill will actually use ───────────────────────────────────────

async def _effective(db, user, prof) -> dict:
    """The value each field resolves to at fill time, by the same code path the
    extension uses — so "suggested" on the page means exactly what a form gets.

    Never parses the resume here: the page must load instantly, and the facts
    are parsed (once) by the extension's first autofill. Until then education
    and work come from the resume text only if already cached.
    """
    from auto_apply import resume_facts as rf
    from auto_apply.profile import build_applicant_profile, split_phone
    from routers.extension_autofill import _context_snapshot

    facts = rf.load_cached_facts(db, user) or rf.empty_facts()
    p = await build_applicant_profile(_context_snapshot(user, prof, facts), narrative=False)
    code, number = split_phone(p.phone)
    return {
        "firstName": p.first_name, "middleName": p.middle_name, "lastName": p.last_name,
        "email": p.email,
        "phone": {"code": code, "number": number},
        "linkedinUrl": p.linkedin, "githubUrl": p.github, "portfolioUrl": p.portfolio,
        "addressLine1": p.address_line1, "addressLine2": p.address_line2,
        "city": p.address_city, "state": p.address_state, "postalCode": p.postal_code,
        "country": p.address_country, "location": p.location,
        "workExperience": p.work_experience,
        "educationHistory": p.education_entries,
        "currentTitle": p.current_title, "currentCompany": p.current_company,
        "previousCompany": p.previous_company, "yearsExperience": p.years_experience,
        "university": p.university, "degree": p.degree, "major": p.major,
        "graduationDate": p.graduation_date, "gpa": p.gpa,
        "skills": ", ".join(p.top_skills),
        "noticePeriod": p.notice_period, "availableStartDate": p.available_start_date,
        "expectedSalary": p.expected_salary,
        "whyThisRole": p.why_this_role,
    }


def _stored(prof, user) -> dict:
    """What is actually saved, per field. Empty string = nothing saved."""
    from auto_apply.profile import parse_saved_education, parse_saved_experience, split_phone

    out = {}
    for key, spec in ALL_SPECS.items():
        if key == "email":
            out[key] = user.email or ""
        elif key == "consent":
            out[key] = bool(prof and prof.auto_apply_consent_at)
        elif spec.kind == "checkbox":
            out[key] = bool(prof and getattr(prof, spec.column, False))
        elif key == "phone":
            code, number = split_phone(getattr(prof, "phone", "") if prof else "")
            out[key] = {"code": code, "number": number}
        elif spec.kind == "experience":
            out[key] = parse_saved_experience(getattr(prof, spec.column, "") if prof else "")
        elif spec.kind == "education":
            out[key] = parse_saved_education(getattr(prof, spec.column, "") if prof else "")
        else:
            out[key] = str((getattr(prof, spec.column, "") if prof else "") or "")
    return out


def _page_model(stored: dict, effective: dict, facts_cached: bool) -> dict:
    """Per-field view: the value to show, and whether it is saved or suggested."""
    fields = {}
    for key, spec in ALL_SPECS.items():
        s = stored.get(key)
        e = effective.get(key, s)
        if spec.column in EEO_COLUMNS:
            # Shown as saved or empty — the "Decline" fallback is explained by the
            # empty option, not written into the box as though the user chose it.
            # An older free-text answer is shown as the option it means, marked
            # Suggested until saved; one with no clear option stays as it was.
            canon = eeo_canonical(spec.column, s)
            fields[key] = {"value": canon,
                           "source": "saved" if s and canon == s else ("suggested" if s else "")}
            continue
        if spec.column == "nationality":
            # An older free-text "Indian" is shown as India, Suggested until saved.
            canon = nationality_canonical(s)
            fields[key] = {"value": canon,
                           "source": "saved" if s and canon == s else ("suggested" if s else "")}
            continue
        # Choices the user makes (yes/no answers, permissions) are only ever what
        # they saved — there is nothing to suggest.
        if spec.kind in ("checkbox", "readonly", "select"):
            fields[key] = {"value": s, "source": "saved" if s else ""}
            continue
        if key == "phone":
            saved = bool(s.get("number"))
            fields[key] = {"value": s if saved else e, "source": "saved" if saved
                           else ("suggested" if e.get("number") else "")}
            continue
        if s:
            fields[key] = {"value": s, "source": "saved"}
        elif e:
            fields[key] = {"value": e, "source": "suggested"}
        else:
            fields[key] = {"value": "", "source": ""}
    return {"fields": fields, "factsCached": facts_cached}


# ── routes ────────────────────────────────────────────────────────────────

@router.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login?next=/profile", status_code=302)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return RedirectResponse(url="/login?next=/profile", status_code=302)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()
        from auto_apply import resume_facts as rf

        model = _page_model(_stored(prof, user), await _effective(db, user, prof),
                            rf.load_cached_facts(db, user) is not None)
        return templates.TemplateResponse(request, "profile.html", {
            "request": request,
            "sections": SECTIONS,
            "degree_groups": DEGREE_GROUPS,
            "field_options": FIELD_OF_STUDY_OPTIONS,
            "today_iso": date.today().isoformat(),
            "model": model,
            "user_name": user.name or "",
            "has_resume": bool(user.base_resume_path and await document_store.ensure_file_async(user.base_resume_path)),
        })
    finally:
        db.close()


@router.get("/api/profile")
async def get_profile(request: Request):
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()
        from auto_apply import resume_facts as rf

        return _page_model(_stored(prof, user), await _effective(db, user, prof),
                           rf.load_cached_facts(db, user) is not None)
    finally:
        db.close()


EXPERIENCE_LIMITS = {"title": 160, "company": 160, "location": 160, "from": 7, "to": 7,
                     "description": 5000}
MAX_JOBS = 20


def _validated_experience(raw) -> list:
    """The job list as sent by the page, checked. Raises 422 with a message that
    names the job and the box, since the page shows it as-is."""
    from auto_apply.profile import MONTH_YEAR_RE, parse_saved_experience

    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Work experience must be a list of jobs.")
    jobs = parse_saved_experience(raw)
    if len(jobs) > MAX_JOBS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_JOBS} jobs can be saved.")
    for n, job in enumerate(jobs, 1):
        for fld, limit in EXPERIENCE_LIMITS.items():
            if len(job[fld]) > limit and fld not in ("from", "to"):
                raise HTTPException(status_code=422,
                                    detail=f"Job {n}: {fld} is too long (max {limit}).")
        for fld, name in (("from", "From"), ("to", "To")):
            if job[fld] and not MONTH_YEAR_RE.match(job[fld]):
                raise HTTPException(status_code=422,
                                    detail=f"Job {n}: {name} should look like 01/2026.")
    return jobs


EDUCATION_LIMITS = {"school": 200, "degree": 120, "field": 120, "gpa": 20}
MAX_SCHOOLS = 10


def _validated_education(raw) -> list:
    """The school list as sent by the page, checked; 422 names the school and box."""
    from auto_apply.profile import YEAR_RE, parse_saved_education

    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Education must be a list of schools.")
    schools = parse_saved_education(raw)
    if len(schools) > MAX_SCHOOLS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_SCHOOLS} schools can be saved.")
    for n, school in enumerate(schools, 1):
        for fld, limit in EDUCATION_LIMITS.items():
            if len(school[fld]) > limit:
                raise HTTPException(status_code=422,
                                    detail=f"School {n}: {fld} is too long (max {limit}).")
        for fld, name in (("from", "From"), ("to", "To")):
            if school[fld] and not YEAR_RE.match(school[fld]):
                raise HTTPException(status_code=422,
                                    detail=f"School {n}: {name} should be a year, like 2023.")
        if school["from"] and school["to"] and school["from"] > school["to"]:
            raise HTTPException(status_code=422,
                                detail=f"School {n}: From is after To.")
    return schools


class ProfileSave(BaseModel):
    """Only keys present change. Unknown keys are refused rather than ignored,
    so a typo in the page cannot silently drop a value."""
    values: dict = Field(default_factory=dict)


@router.post("/api/profile")
async def save_profile(request: Request, payload: ProfileSave):
    from datetime import datetime

    from auto_apply.profile import join_phone

    values = payload.values or {}
    unknown = [k for k in values if k not in ALL_SPECS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown field(s): {', '.join(unknown)}")

    db = SessionLocal()
    try:
        user = _require_user(request, db)
        prof = db.query(UserApplyProfile).filter(UserApplyProfile.user_id == user.id).first()
        if not prof:
            prof = UserApplyProfile(user_id=user.id)
            db.add(prof)

        for key, raw in values.items():
            spec = ALL_SPECS[key]
            if spec.kind == "readonly":
                continue
            if key == "consent":
                if raw and not prof.auto_apply_consent_at:
                    prof.auto_apply_consent_at = datetime.utcnow()
                elif not raw:
                    prof.auto_apply_consent_at = None
                continue
            if spec.kind == "checkbox":
                setattr(prof, spec.column, bool(raw))
                continue
            if key == "phone":
                raw = raw if isinstance(raw, dict) else {}
                phone = join_phone(raw.get("code", ""), raw.get("number", ""))
                if len(phone) > 40:
                    raise HTTPException(status_code=422, detail="Phone number is too long.")
                prof.phone = phone
                continue
            if spec.kind == "experience":
                jobs = _validated_experience(raw)
                prof.work_experience = json.dumps(jobs, ensure_ascii=False) if jobs else None
                continue
            if spec.kind == "education":
                schools = _validated_education(raw)
                prof.education_history = json.dumps(schools, ensure_ascii=False) if schools else None
                continue
            text = str(raw if raw is not None else "").strip()
            if len(text) > spec.max_len:
                raise HTTPException(status_code=422,
                                    detail=f"{spec.label} is too long (max {spec.max_len}).")
            if spec.column in EEO_COLUMNS:
                text = eeo_canonical(spec.column, text)
                # An older free-text answer with no matching option may be sent
                # back unchanged; anything else must be one of the options.
                if text not in SELECT_VALUES[key] and text != (getattr(prof, spec.column, "") or ""):
                    raise HTTPException(status_code=422, detail=f"Invalid choice for {spec.label}.")
                setattr(prof, spec.column, text)
                continue
            if spec.kind == "date" and text:
                # ISO, as <input type="date"> sends it: a real day, in the past.
                try:
                    when = date.fromisoformat(text)
                except ValueError:
                    raise HTTPException(status_code=422, detail=f"{spec.label} must be a date.")
                if len(text) != 10 or when >= date.today() or when.year < 1900:
                    raise HTTPException(status_code=422, detail=f"{spec.label} must be a past date.")
            if spec.column == "nationality":
                text = nationality_canonical(text)
                # An older answer naming no listed country may be sent back unchanged.
                if text not in SELECT_VALUES[key] and text != (getattr(prof, spec.column, "") or ""):
                    raise HTTPException(status_code=422, detail=f"Invalid choice for {spec.label}.")
                setattr(prof, spec.column, text)
                continue
            if spec.kind == "select" and text not in SELECT_VALUES[key]:
                raise HTTPException(status_code=422, detail=f"Invalid choice for {spec.label}.")
            setattr(prof, spec.column, text)

        db.commit()
        db.refresh(prof)
        from auto_apply import resume_facts as rf

        return {"ok": True, **_page_model(_stored(prof, user), await _effective(db, user, prof),
                                          rf.load_cached_facts(db, user) is not None)}
    finally:
        db.close()


# ── saved answers ─────────────────────────────────────────────────────────

class AnswerEdit(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
    # One kind of list's answer (UserApplyQA.variants): its index, and the
    # answer this page showed for it, so a list changed elsewhere since is
    # never edited blind.
    variant: int | None = None
    was: str | None = None


def _variants_out(row) -> list[dict]:
    from auto_apply.qa_store import decode_variants

    return [{"index": i, "answer": v["answer"], "options": v["options"][:12]}
            for i, v in enumerate(decode_variants(row.variants))]


@router.get("/api/profile/answers")
async def list_answers(request: Request):
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        rows = (db.query(UserApplyQA).filter(UserApplyQA.user_id == user.id)
                .order_by(UserApplyQA.updated_at.desc()).all())
        return {"answers": [{"id": r.id, "question": r.question_text, "answer": r.answer,
                             "variants": _variants_out(r),
                             "updatedAt": r.updated_at.isoformat() if r.updated_at else None}
                            for r in rows]}
    finally:
        db.close()


def _own_answer(db, user, answer_id: int):
    row = (db.query(UserApplyQA)
           .filter(UserApplyQA.id == answer_id, UserApplyQA.user_id == user.id).first())
    if not row:
        raise HTTPException(status_code=404, detail="Answer not found")
    return row


@router.put("/api/profile/answers/{answer_id}")
async def edit_answer(request: Request, answer_id: int, payload: AnswerEdit):
    from auto_apply.match_guard import is_never_store

    db = SessionLocal()
    try:
        user = _require_user(request, db)
        row = _own_answer(db, user, answer_id)
        answer = payload.answer.strip()
        # The same refusal the extension's save path applies: a secret-shaped
        # value does not belong in a store that is replayed into forms.
        if is_never_store(row.question_text, answer):
            raise HTTPException(status_code=422,
                                detail="That answer can't be stored as a reusable answer.")
        if payload.variant is not None:
            # A form reads the answer kept for its kind of list, not `answer`:
            # editing only that showed here and never reached a form.
            from auto_apply.qa_store import edit_variant

            try:
                edit_variant(row, payload.variant, payload.was or "", answer)
            except ValueError:
                raise HTTPException(status_code=409,
                                    detail="This answer changed since the page loaded — refresh and try again.")
        else:
            row.answer = answer   # the question is unchanged, so its embedding still holds
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.delete("/api/profile/answers/{answer_id}")
async def delete_answer(request: Request, answer_id: int, variant: int | None = None, was: str | None = None):
    """Forget one saved answer — or, with `variant`, only its answer for that
    kind of list (the row goes with its last one)."""
    db = SessionLocal()
    try:
        user = _require_user(request, db)
        row = _own_answer(db, user, answer_id)
        last = True
        if variant is not None:
            from auto_apply.qa_store import delete_variant

            try:
                last = delete_variant(row, variant, was or "")
            except ValueError:
                raise HTTPException(status_code=409,
                                    detail="This answer changed since the page loaded — refresh and try again.")
        if last:
            db.delete(row)
        db.commit()
        return {"ok": True}
    finally:
        db.close()
