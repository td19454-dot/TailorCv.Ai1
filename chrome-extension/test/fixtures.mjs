// Realistic application-form markup, one per ATS.
//
// Copied in shape (not content) from the real thing: Greenhouse's react-select
// wrappers and its file input hidden behind an Attach button, Lever's flat
// name="cards[...]" fields, Workday's data-automation-id attributes and nameless
// radiogroups, Ashby's ARIA-heavy custom comboboxes. The point is that the
// discovery and write layers meet the shapes they will actually meet — a form
// built from tidy <label for> + <input> pairs would prove very little.

export const GREENHOUSE = `
<div class="application-container">
  <h1>Senior Backend Engineer</h1>
  <form id="application-form">
    <div class="field">
      <label for="first_name">First Name <abbr title="required">*</abbr></label>
      <input type="text" id="first_name" name="first_name" required>
    </div>
    <div class="field">
      <label for="last_name">Last Name <abbr title="required">*</abbr></label>
      <input type="text" id="last_name" name="last_name" required>
    </div>
    <div class="field">
      <label for="email">Email <abbr title="required">*</abbr></label>
      <input type="email" id="email" name="email" required>
    </div>
    <div class="field">
      <label for="phone">Phone</label>
      <input type="tel" id="phone" name="phone">
    </div>

    <!-- The real input is hidden; the page shows an "Attach" button instead. -->
    <div class="field">
      <label for="resume">Resume/CV <abbr title="required">*</abbr></label>
      <button type="button" class="attach-button">Attach</button>
      <input type="file" id="resume" name="resume" style="display:none" required>
    </div>
    <div class="field">
      <label for="cover_letter">Cover Letter</label>
      <button type="button" class="attach-button">Attach</button>
      <input type="file" id="cover_letter" name="cover_letter" style="display:none">
    </div>

    <div class="field">
      <label for="q_linkedin">LinkedIn Profile</label>
      <input type="text" id="q_linkedin" name="question_linkedin">
    </div>

    <!-- react-select: the committed value renders into the wrapper and the
         inner input is cleared, so the probe must read the wrapper. -->
    <div class="field">
      <label for="q_based">Where are you currently based? <abbr title="required">*</abbr></label>
      <div class="select__container">
        <div class="select__control">
          <div class="select__placeholder">Select...</div>
          <input role="combobox" id="q_based" aria-haspopup="listbox" aria-autocomplete="list">
        </div>
        <input type="hidden" name="question_based" value="">
      </div>
    </div>

    <div class="field">
      <label for="q_auth">Are you legally authorized to work in the United States? <abbr title="required">*</abbr></label>
      <select id="q_auth" name="question_work_auth" required>
        <option value="">Select...</option>
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </div>
    <div class="field">
      <label for="q_sponsor">Will you now or in the future require sponsorship? <abbr title="required">*</abbr></label>
      <select id="q_sponsor" name="question_sponsorship" required>
        <option value="">Select...</option>
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </div>
    <div class="field">
      <label for="q_salary">What are your salary expectations?</label>
      <input type="text" id="q_salary" name="question_salary">
    </div>
    <div class="field">
      <label for="q_why">Why do you want to work here? <abbr title="required">*</abbr></label>
      <textarea id="q_why" name="question_why" required></textarea>
    </div>
    <div class="field">
      <label for="q_product">Have you used our developer platform? <abbr title="required">*</abbr></label>
      <select id="q_product" name="question_product" required>
        <option value="">Select...</option>
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </div>

    <fieldset class="eeo">
      <legend>Voluntary Self-Identification</legend>
      <div class="field">
        <label for="eeo_gender">Gender</label>
        <select id="eeo_gender" name="eeo_gender">
          <option value="">Select...</option>
          <option value="m">Male</option>
          <option value="f">Female</option>
          <option value="d">Decline To Self Identify</option>
        </select>
      </div>
      <div class="field">
        <label for="eeo_vet">Veteran Status</label>
        <select id="eeo_vet" name="eeo_veteran">
          <option value="">Select...</option>
          <option value="1">I identify as one or more of the classifications of a protected veteran</option>
          <option value="2">I am not a protected veteran</option>
          <option value="3">I don't wish to answer</option>
        </select>
      </div>
    </fieldset>

    <div class="field">
      <label><input type="checkbox" name="consent_marketing"> I'd like to receive updates about future roles</label>
    </div>

    <button type="submit" id="submit_app">Submit Application</button>
  </form>
</div>`;

export const LEVER = `
<div class="content">
  <form method="POST" class="application-form" id="lever-form">
    <div class="application-field">
      <label class="application-label"><span class="text">Full name</span><span class="required">✱</span></label>
      <input type="text" name="name" required>
    </div>
    <div class="application-field">
      <label class="application-label"><span class="text">Email</span><span class="required">✱</span></label>
      <input type="email" name="email" required>
    </div>
    <div class="application-field">
      <label class="application-label"><span class="text">Phone</span></label>
      <input type="tel" name="phone">
    </div>
    <div class="application-field">
      <label class="application-label"><span class="text">Current company</span></label>
      <input type="text" name="org">
    </div>
    <div class="application-field">
      <label class="application-label"><span class="text">LinkedIn URL</span></label>
      <input type="text" name="urls[LinkedIn]">
    </div>
    <div class="application-field">
      <label class="application-label"><span class="text">GitHub URL</span></label>
      <input type="text" name="urls[GitHub]">
    </div>
    <div class="application-field">
      <label class="application-label"><span class="text">Resume/CV</span><span class="required">✱</span></label>
      <input type="file" name="resume" required>
    </div>
    <ul class="application-question">
      <li class="application-question">
        <label class="application-label"><span class="text">
          Are you legally authorized to work in the United States?</span><span class="required">✱</span></label>
        <div class="application-field">
          <label><input type="radio" name="cards[auth][field0]" value="Yes" required> Yes</label>
          <label><input type="radio" name="cards[auth][field0]" value="No"> No</label>
        </div>
      </li>
      <li class="application-question">
        <label class="application-label"><span class="text">
          How did you hear about this role?</span></label>
        <input type="text" name="cards[source][field0]">
      </li>
    </ul>
    <button type="submit">Submit application</button>
  </form>
</div>`;

// Real Workday container IDs. An earlier version of this fixture used
// "jobApplicationPage" / "jobApplicationForm", which were invented — Workday
// actually wraps every step in applyFlowPage, with a per-step inner container
// (applyFlowMyInfoPage, applyFlowMyExpPage, ...). Because the invented IDs also
// happened to be matched by a generic selector, the tests passed while a real
// Workday page was never detected at all.
export const WORKDAY = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="applyFlowMyInfoPage" id="wd-form">
    <div data-automation-id="formField-legalNameSection_firstName">
      <label for="wd-first">First Name<abbr title="required">*</abbr></label>
      <input id="wd-first" data-automation-id="legalNameSection_firstName"
             name="legalNameSection_firstName" required>
    </div>
    <div data-automation-id="formField-legalNameSection_lastName">
      <label for="wd-last">Last Name<abbr title="required">*</abbr></label>
      <input id="wd-last" data-automation-id="legalNameSection_lastName"
             name="legalNameSection_lastName" required>
    </div>
    <div data-automation-id="formField-email">
      <label for="wd-email">Email Address<abbr title="required">*</abbr></label>
      <input id="wd-email" type="email" name="email" required>
    </div>
    <div data-automation-id="formField-addressSection_city">
      <label for="wd-city">City<abbr title="required">*</abbr></label>
      <input id="wd-city" name="addressSection_city" required>
    </div>
    <div data-automation-id="formField-addressSection_postalCode">
      <label for="wd-zip">Postal Code</label>
      <input id="wd-zip" name="addressSection_postalCode">
    </div>
    <div data-automation-id="formField-phone">
      <label for="wd-phone">Phone Number<abbr title="required">*</abbr></label>
      <div class="phone-group">
        <select name="phone_country" class="country-code-select">
          <option value="">Select</option><option value="IND">India (+91)</option>
          <option value="USA">United States of America (+1)</option>
        </select>
        <input id="wd-phone" type="tel" name="phone_number" required>
      </div>
    </div>
    <!-- Workday renders radio groups with no shared name at all. -->
    <div data-automation-id="formField-sponsorship">
      <div role="radiogroup" aria-label="Will you now or in the future require sponsorship?">
        <label><input type="radio" data-automation-id="sponsorYes" value="Yes"> Yes</label>
        <label><input type="radio" data-automation-id="sponsorNo" value="No"> No</label>
      </div>
    </div>
    <div data-automation-id="formField-resume">
      <label for="wd-resume">Resume/CV<abbr title="required">*</abbr></label>
      <input id="wd-resume" type="file" name="resume" required>
    </div>
    <button data-automation-id="bottom-navigation-next-button">Save and Continue</button>
  </div>
</div>`;

// The "My Information" step as it actually renders — modelled on the Citi
// tenant (citi.wd5.myworkdayjobs.com) where autofill failed to appear. The
// shapes that matter, none of which the fixture above has:
//
//   * No <form> element anywhere. The root is data-automation-id="applyFlowPage".
//   * Dropdowns are <button aria-haspopup="listbox">, not <select>. The current
//     value is the button's own text; "Select One" means empty. The options
//     only exist in a portal listbox after the button is pressed.
//   * "How Did You Hear About Us?" is a multiselect prompt: a search box whose
//     committed values render as separate selectedItem nodes. Typing into the
//     box is NOT an answer, so a writer that types and reads the input back
//     reports success for an empty field.
//   * Radio groups use a <fieldset> whose <legend> holds the question.
//   * Dates are three separate spinbutton inputs.
//   * Labels use label[for] pointing at generated ids ("input-5").
export const WORKDAY_MYINFO = `
<div data-automation-id="applyFlowPage">
  <div data-automation-id="applyFlowMyInfoPage">
    <div data-automation-id="formField-sourcePrompt">
      <label for="input-2">How Did You Hear About Us?<abbr title="required">*</abbr></label>
      <div data-automation-id="multiSelectContainer">
        <ul data-automation-id="selectedItemList"></ul>
        <div data-automation-id="multiselectInputContainer">
          <input data-automation-id="searchBox" id="input-2" type="text" placeholder="Search"
                 aria-required="true">
        </div>
      </div>
    </div>

    <fieldset data-automation-id="formField-candidateIsPreviousWorker">
      <legend>
        <label>Have you ever been employed by Citi or any of its predecessor companies
          (including but not limited to Citibank, Citicorp, Banamex, Salomon Brothers, or
          Smith Barney) whether as an employee or via an agency or as a contractor,
          temporary worker or consultant?<abbr title="required">*</abbr></label>
      </legend>
      <div><input type="radio" id="radio-yes" name="candidateIsPreviousWorker" value="true">
        <label for="radio-yes">Yes</label></div>
      <div><input type="radio" id="radio-no" name="candidateIsPreviousWorker" value="false">
        <label for="radio-no">No</label></div>
    </fieldset>

    <div data-automation-id="formField-countryDropdown">
      <label for="input-4">Country<abbr title="required">*</abbr></label>
      <button type="button" aria-haspopup="listbox" id="input-4"
              data-automation-id="countryDropdown" aria-label="Country Select One Required">Select One</button>
    </div>

    <div data-automation-id="formField-legalNameSection_firstName">
      <label for="input-5">Given Name(s)<abbr title="required">*</abbr></label>
      <input data-automation-id="legalNameSection_firstName" id="input-5" type="text"
             aria-required="true">
    </div>
    <div data-automation-id="formField-legalNameSection_lastName">
      <label for="input-6">Family Name<abbr title="required">*</abbr></label>
      <input data-automation-id="legalNameSection_lastName" id="input-6" type="text"
             aria-required="true">
    </div>

    <div data-automation-id="formField-addressSection_city">
      <label for="input-8">City<abbr title="required">*</abbr></label>
      <input data-automation-id="addressSection_city" id="input-8" type="text" aria-required="true">
    </div>

    <div data-automation-id="formField-email">
      <label for="input-9">Email Address<abbr title="required">*</abbr></label>
      <input data-automation-id="email" id="input-9" type="text" aria-required="true">
    </div>

    <div data-automation-id="formField-availableStartDate">
      <label id="date-label">Available Start Date</label>
      <div data-automation-id="dateInputWrapper" aria-labelledby="date-label">
        <input data-automation-id="dateSectionMonth-input" role="spinbutton" type="text"
               aria-label="Month" placeholder="MM">
        <input data-automation-id="dateSectionDay-input" role="spinbutton" type="text"
               aria-label="Day" placeholder="DD">
        <input data-automation-id="dateSectionYear-input" role="spinbutton" type="text"
               aria-label="Year" placeholder="YYYY">
      </div>
    </div>
  </div>
  <div data-automation-id="pageFooter">
    <button data-automation-id="bottom-navigation-next-button" type="button">Save and Continue</button>
  </div>
</div>
<div data-automation-id="activeListContainer" id="wd-portal"></div>`;

/**
 * Give WORKDAY_MYINFO its widget behaviour, the way Workday's own JS would.
 *
 * Kept next to the markup so the tests and the browser fixture page wire it
 * identically. Faithful in the ways that broke real autofills: options exist only
 * after a press, they render into a portal outside the field, the button commits
 * on MOUSEDOWN, and the multiselect only records an answer as a selectedItem.
 */
export function wireWorkday(doc) {
  const portal = doc.getElementById('wd-portal');
  const COUNTRIES = ['India', 'United States of America', 'United Kingdom', 'Canada'];
  const SOURCES = ['Company Website', 'Job Board', 'Employee Referral', 'Social Media'];

  const clearPortal = () => { portal.innerHTML = ''; };
  const renderOptions = (options, onPick) => {
    portal.innerHTML = '<ul role="listbox">' + options.map(o =>
      `<li role="option" data-automation-id="promptOption" data-automation-label="${o}">${o}</li>`)
      .join('') + '</ul>';
    for (const li of portal.querySelectorAll('[role=option]')) {
      li.addEventListener('mousedown', () => { onPick(li.textContent); clearPortal(); });
    }
  };

  const button = doc.querySelector('[data-automation-id=countryDropdown]');
  if (button) {
    button.addEventListener('mousedown', () => renderOptions(COUNTRIES, (value) => {
      button.textContent = value;
      button.setAttribute('aria-label', `Country ${value} Required`);
    }));
  }

  const search = doc.querySelector('[data-automation-id=searchBox]');
  if (search) {
    const list = doc.querySelector('[data-automation-id=selectedItemList]');
    const show = () => {
      const q = (search.value || '').toLowerCase();
      renderOptions(SOURCES.filter(s => s.toLowerCase().includes(q)), (value) => {
        list.innerHTML += `<li><div data-automation-id="selectedItem">${value}</div></li>`;
        search.value = '';
      });
    };
    search.addEventListener('mousedown', show);
    search.addEventListener('input', show);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') show(); });
  }

  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearPortal(); });
}

export const ASHBY = `
<div data-ui="application-form" id="ashby-form">
  <div class="_fieldEntry">
    <label for="a-name">Name<span aria-hidden="true">*</span></label>
    <input id="a-name" name="_systemfield_name" required>
  </div>
  <div class="_fieldEntry">
    <label for="a-email">Email<span aria-hidden="true">*</span></label>
    <input id="a-email" type="email" name="_systemfield_email" required>
  </div>
  <div class="_fieldEntry">
    <label for="a-resume">Resume<span aria-hidden="true">*</span></label>
    <input id="a-resume" type="file" name="_systemfield_resume" required>
  </div>
  <div class="_fieldEntry">
    <label for="a-loc">Location</label>
    <div class="_container">
      <input id="a-loc" role="combobox" aria-expanded="false" aria-controls="a-loc-list"
             aria-autocomplete="list" autocomplete="off">
      <input type="hidden" name="_systemfield_location" value="">
    </div>
  </div>
  <div class="_fieldEntry">
    <label for="a-degree">Highest level of education</label>
    <select id="a-degree" name="q_education">
      <option value="">Select an option</option>
      <option value="hs">High School</option>
      <option value="ba">Bachelor's Degree</option>
      <option value="ma">Master's Degree</option>
      <option value="phd">Doctorate</option>
    </select>
  </div>
  <div class="_fieldEntry">
    <label for="a-start">Earliest start date</label>
    <input id="a-start" type="date" name="q_start_date">
  </div>
  <button type="button">Submit Application</button>
</div>`;

export const GENERIC = `
<main>
  <h1>Careers at Acme — Apply</h1>
  <form id="careers-form" action="/careers/apply" method="post">
    <p><label for="g-name">Your name</label><input id="g-name" name="applicant_name" required></p>
    <p><label for="g-email">Email address</label><input id="g-email" type="email" name="applicant_email" required></p>
    <p><label for="g-phone">Contact number</label><input id="g-phone" type="tel" name="applicant_phone"></p>
    <p><label for="g-uni">University</label><input id="g-uni" name="university"></p>
    <p><label for="g-major">Field of study</label><input id="g-major" name="major"></p>
    <p><label for="g-grad">Graduation year</label><input id="g-grad" name="grad_year" placeholder="YYYY"></p>
    <p><label for="g-gpa">GPA</label><input id="g-gpa" name="gpa"></p>
    <p><label for="g-notes">Anything else?</label><textarea id="g-notes" name="notes"></textarea></p>
    <p><label><input type="checkbox" name="terms" required> I accept the privacy policy</label></p>
    <p><button type="submit">Send application</button></p>
  </form>
</main>`;

// A search box, a newsletter signup and a login form on one page: none of these
// is an application, and each is a shape the detector has to reject.
export const DECOYS = `
<header>
  <form role="search" action="/search"><input type="search" name="q"><input name="loc">
    <button type="submit">Search jobs</button></form>
</header>
<aside>
  <form class="newsletter"><input name="email" type="email"><input name="name">
    <button type="submit">Subscribe</button></form>
  <form id="login"><input name="email" type="email"><input name="password" type="password">
    <button type="submit">Sign in</button></form>
</aside>`;

export const ALL = { GREENHOUSE, LEVER, WORKDAY, WORKDAY_MYINFO, ASHBY, GENERIC };
