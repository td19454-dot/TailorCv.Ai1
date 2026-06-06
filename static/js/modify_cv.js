(function () {
    const MODIFY_DRAFT_KEY = "tailorcv_modify_draft";
    const sidebarSections = [
        { id: "personal-info", label: "Personal Info" },
        { id: "education", label: "Education" },
        { id: "experience", label: "Experience" },
        { id: "projects", label: "Projects" },
        { id: "skills", label: "Skills" },
        { id: "extracurriculars", label: "Extracurricular Activity" },
        { id: "certifications", label: "Certifications" },
        { id: "awards", label: "Awards" },
        { id: "publications", label: "Publications" },
        { id: "templates", label: "Templates" },
    ];

    function createEmptyCvData() {
        return {
            personalInfo: {
                name: "",
                headline: "",
                email: "",
                phone: "",
                location: "",
                linkedin: "",
                kaggle: "",
                github: "",
                portfolio: "",
                googleScholar: "",
                leetcode: "",
                summary: ""
            },
            education: [],
            experience: [],
            projects: [],
            skills: [],
            extracurriculars: [],
            certifications: [],
            awards: [],
            publications: []
        };
    }

    let cvData = createEmptyCvData();

    let selectedTemplate = null;
    let templates = [];

    function getTemplatePreviewSrc(templateId) {
        const id = Number(templateId);
        const previewMap = {
            1: "pic1.webp",
            2: "pic2.webp",
            3: "pic3.webp",
            4: "pic4.webp",
            5: "pic5.webp",
            6: "pic6.webp",
            7: "pic7.webp",
            8: "pic8.webp",
            9: "pic9.webp",
            10: "pic10.webp",
            11: "pic11.webp",
            12: "pic12.webp",
            13: "pic13.webp",
            14: "pic14.webp",
            15: "pic15.webp",
            16: "pic16.webp",
            17: "pic17.webp",
            18: "pic18.webp",
            19: "pic19.webp",
            20: "pic20.webp",
            21: "pic21.webp",
            22: "pic22.webp",
        };
        const filename = previewMap[id] || `pic${id}.jpg`;
        return `/static/${filename}?v=9`;
    }

    function createInput(label, value, onInput, placeholder = "") {
        const isDetails = label === "Details";
        if (isDetails) {
            return `
                <label class="form-label">${label}</label>
                <textarea class="section-textarea" data-oninput="${onInput}" rows="4" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || "")}</textarea>
            `;
        }
        return `
            <label class="form-label">${label}</label>
            <input class="section-input" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}" data-oninput="${onInput}" />
        `;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function normalizeIncomingCvData(incoming) {
        const data = incoming && typeof incoming === "object" ? incoming : {};
        const personalInfo = data.personalInfo && typeof data.personalInfo === "object" ? data.personalInfo : {};

        const normalizeArray = (value) => (Array.isArray(value) ? value : []);
        const toString = (value) => (value == null ? "" : String(value).trim());

        const normalizeAwards = (awards) =>
            normalizeArray(awards)
                .map((item) => {
                    if (item && typeof item === "object") {
                        return { title: toString(item.title || item.name || item.text || item.label) };
                    }
                    return { title: toString(item) };
                })
                .filter((item) => item.title);

        return {
            personalInfo: {
                name: toString(personalInfo.name),
                headline: toString(personalInfo.headline),
                email: toString(personalInfo.email),
                phone: toString(personalInfo.phone),
                location: toString(personalInfo.location),
                linkedin: toString(personalInfo.linkedin),
                kaggle: toString(personalInfo.kaggle),
                github: toString(personalInfo.github),
                portfolio: toString(personalInfo.portfolio),
                googleScholar: toString(personalInfo.googleScholar),
                leetcode: toString(personalInfo.leetcode),
                summary: toString(personalInfo.summary),
            },
            education: normalizeArray(data.education),
            experience: normalizeArray(data.experience),
            projects: normalizeArray(data.projects),
            skills: normalizeArray(data.skills),
            extracurriculars: normalizeArray(data.extracurriculars),
            certifications: normalizeArray(data.certifications),
            awards: normalizeAwards(data.awards),
            publications: normalizeArray(data.publications),
        };
    }

    function Sidebar() {
        return `
            <div class="sidebar-title">Modify Sections</div>
            ${sidebarSections
                .map(
                    (section) => `<button type="button" class="sidebar-nav-btn" data-scroll-to="${section.id}">${section.label}</button>`
                )
                .join("")}
        `;
    }

    function PersonalInfoForm() {
        const info = cvData.personalInfo || {};
        return `
            <section id="personal-info" class="form-card section-card">
                <h2 class="form-title">Personal Info</h2>
                <div class="section-row">
                    <div>${createInput("Full Name", info.name, "personalInfo.name", "Jane Doe")}</div>
                    <div>${createInput("Headline", info.headline, "personalInfo.headline", "Software Engineer")}</div>
                    <div>${createInput("Email", info.email, "personalInfo.email", "you@example.com")}</div>
                    <div>${createInput("Phone", info.phone, "personalInfo.phone", "+1 555 123 4567")}</div>
                    <div>${createInput("Location", info.location, "personalInfo.location", "City, Country")}</div>
                    <div>${createInput("LinkedIn", info.linkedin, "personalInfo.linkedin", "linkedin.com/in/username")}</div>
                    <div>${createInput("Kaggle", info.kaggle, "personalInfo.kaggle", "kaggle.com/username")}</div>
                    <div>${createInput("GitHub", info.github, "personalInfo.github", "github.com/username")}</div>
                    <div>${createInput("Portfolio", info.portfolio, "personalInfo.portfolio", "yourportfolio.com")}</div>
                    <div>${createInput("Google Scholar", info.googleScholar, "personalInfo.googleScholar", "scholar.google.com/citations?user=...")}</div>
                    <div>${createInput("LeetCode", info.leetcode, "personalInfo.leetcode", "leetcode.com/username")}</div>
                </div>
                <label class="form-label">Summary</label>
                <textarea class="section-textarea" data-oninput="personalInfo.summary">${escapeHtml(info.summary || "")}</textarea>
            </section>
        `;
    }

    function listSectionCard(id, title, fields, data, emptyItemFactory) {
        if (!Array.isArray(data) || data.length === 0) {
            cvData[id] = [emptyItemFactory()];
        }
        const items = cvData[id];
        return `
            <section id="${id}" class="form-card section-card">
                <h2 class="form-title">${title}</h2>
                ${items
                    .map((item, index) => {
                        return `
                            <div class="entry-card">
                                <div class="section-row">
                                    ${fields
                                        .map((field) => {
                                            const path = `${id}.${index}.${field.key}`;
                                            return `<div>${createInput(field.label, item[field.key], path, field.placeholder || "")}</div>`;
                                        })
                                        .join("")}
                                </div>

                                <div class="section-controls">
                                    <button type="button" class="small-btn" data-remove-entry="${id}" data-index="${index}">Remove</button>
                                </div>
                            </div>
                        `;
                    })
                    .join("")}
                <div class="section-controls">
                    <button type="button" class="small-btn" data-add-entry="${id}">+ Add ${title.slice(0, -1)}</button>
                </div>
            </section>
        `;
    }

    function EducationSection() {
        return listSectionCard(
            "education",
            "Education",
            [
                { key: "school", label: "School", placeholder: "University Name" },
                { key: "degree", label: "Degree", placeholder: "B.Tech Computer Science" },
                { key: "year", label: "Year", placeholder: "2021 - 2025" },
                { key: "score", label: "Score", placeholder: "CGPA 8.8" },
            ],
            cvData.education,
            () => ({ school: "", degree: "", year: "", score: "" })
        );
    }

    function ExperienceSection() {
        return listSectionCard(
            "experience",
            "Experience",
            [
                { key: "company", label: "Company", placeholder: "Tech Corp" },
                { key: "title", label: "Title", placeholder: "Frontend Developer" },
                { key: "dates", label: "Dates", placeholder: "Jan 2024 - Present" },
                { key: "location", label: "Location", placeholder: "Remote" },
                { key: "details", label: "Details", placeholder: "• Bullet point achievements and responsibilities...\n• Use bullet points for each item" },
            ],
            cvData.experience,
            () => ({ company: "", title: "", dates: "", location: "", details: "" })
        );
    }

    function ProjectsSection() {
        return listSectionCard(
            "projects",
            "Projects",
            [
                { key: "name", label: "Project Name", placeholder: "TailorCV.ai" },
                { key: "subtitle", label: "Subtitle", placeholder: "React, FastAPI" },
                { key: "dates", label: "Dates", placeholder: "Jan 2025 - Mar 2025" },
                { key: "url", label: "Live URL", placeholder: "https://..." },
                { key: "github_link", label: "GitHub URL", placeholder: "https://github.com/..." },
                { key: "details", label: "Details", placeholder: "• Key features implemented\n• Technologies and tools used\n• Results and impact achieved" },
            ],
            cvData.projects,
            () => ({ name: "", subtitle: "", dates: "", url: "", github_link: "", details: "" })
        );
    }

    function SkillsSection() {
        const skills = cvData.skills.length ? cvData.skills : [{ name: ""}];
        return `
            <section id="skills" class="form-card section-card">
                <h2 class="form-title">Skills</h2>
                ${skills
                    .map(
                        (skill, index) => `
                        <div class="entry-card">
                            <label class="form-label">Skill / Category</label>
                            <input class="section-input" value="${escapeHtml(skill.name || "")}" data-oninput="skills.${index}.name" placeholder="Languages: JavaScript, Python" />
                            <div class="section-controls">
                                <button type="button" class="small-btn" data-remove-entry="skills" data-index="${index}">Remove</button>
                            </div>
                        </div>
                    `
                    )
                    .join("")}
                <div class="section-controls">
                    <button type="button" class="small-btn" data-add-entry="skills">+ Add Skill</button>
                </div>
            </section>
        `;
    }

    function PublicationsSection() {
        return listSectionCard(
            "publications",
            "Publications",
            [
                { key: "title", label: "Title", placeholder: "Research Paper Title" },
                { key: "publisher", label: "Publisher", placeholder: "IEEE / ACM / Journal" },
                { key: "year", label: "Year", placeholder: "2024" },
                { key: "url", label: "URL", placeholder: "https://..." },
            ],
            cvData.publications,
            () => ({ title: "", publisher: "", year: "", url: ""})
        );
    }

    function ExtracurricularSection() {
        return listSectionCard(
            "extracurriculars",
            "Extracurriculars",
            [
                { key: "role", label: "Role", placeholder: "Core Team Member" },
                { key: "organization", label: "Organization", placeholder: "Coding Club" },
                { key: "dates", label: "Dates", placeholder: "2023 - 2024" },
                { key: "url", label: "URL", placeholder: "https://..." },
                { key: "details", label: "Details", placeholder: "• Led weekly coding workshops\n• Organised annual hackathon" },
            ],
            cvData.extracurriculars,
            () => ({ role: "", organization: "", dates: "", url: "", details: "" })
        );
    }

    function CertificationsSection() {
        return listSectionCard(
            "certifications",
            "Certifications",
            [
                { key: "name", label: "Certification Name", placeholder: "AWS Cloud Practitioner" },
                { key: "issuer", label: "Issuer", placeholder: "Amazon Web Services" },
                { key: "year", label: "Year", placeholder: "2025" },
                { key: "url", label: "URL", placeholder: "https://..." },
            ],
            cvData.certifications,
            () => ({ name: "", issuer: "", year: "", url: "", details: "" })
        );
    }

    function AwardsSection() {
        const awards = Array.isArray(cvData.awards) && cvData.awards.length
            ? cvData.awards
            : [{ title: "" }];
        cvData.awards = awards;
        return `
            <section id="awards" class="form-card section-card">
                <h2 class="form-title">Awards</h2>
                ${awards
                    .map(
                        (award, index) => `
                        <div class="entry-card">
                            <label class="form-label">Award</label>
                            <input class="section-input" value="${escapeHtml(award.title || "")}" data-oninput="awards.${index}.title" placeholder="Hackathon Winner - 1st Place" />
                            <div class="section-controls">
                                <button type="button" class="small-btn" data-remove-entry="awards" data-index="${index}">Remove</button>
                            </div>
                        </div>
                    `
                    )
                    .join("")}
                <div class="section-controls">
                    <button type="button" class="small-btn" data-add-entry="awards">+ Add Award</button>
                </div>
            </section>
        `;
    }

    function TemplateGridSection() {
        return `
            <section id="templates" class="form-card section-card">
                <h2 class="form-title">Templates</h2>
                <p class="manual-cv-description">Choose one of the existing resume templates.</p>
                <div class="template-grid">
                    ${templates
                        .map(
                            (template) => `
                            <div class="template-card-mini ${selectedTemplate === template.id ? "selected" : ""}" data-template-id="${template.id}">
<div class="template-thumb">
    <img src="${getTemplatePreviewSrc(template.id)}" alt="Template ${template.id} Preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
    <div style="display:none; grid-area:1/1/1/1; place-items:center; color:#eff6ff; font-size:0.95rem;">Preview ${template.id}</div>
</div>
                                <div class="template-name">Template ${template.id}</div>
                            </div>
                        `
                        )
                        .join("")}
                </div>
            </section>
        `;
    }

    function renderAll() {
        const sidebarContainer = document.getElementById("modify-cv-sidebar");
        const sectionsContainer = document.getElementById("sections-container");
        if (!sidebarContainer || !sectionsContainer) {
            return;
        }
        sidebarContainer.innerHTML = Sidebar();
        sectionsContainer.innerHTML = `
            ${PersonalInfoForm()}
            ${EducationSection()}
            ${ExperienceSection()}
            ${ProjectsSection()}
            ${SkillsSection()}
            ${ExtracurricularSection()}
            ${CertificationsSection()}
            ${AwardsSection()}
            ${PublicationsSection()}
            ${TemplateGridSection()}
        `;
        bindInteractions();
    }

    function setValueByPath(path, value) {
        const parts = path.split(".");
        let target = cvData;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            const nextKey = parts[i + 1];
            const numeric = Number.isInteger(Number(key)) ? Number(key) : key;

            if (target[numeric] === undefined) {
                target[numeric] = Number.isInteger(Number(nextKey)) ? [] : {};
            }
            target = target[numeric];
        }
        target[parts[parts.length - 1]] = value;
    }

    function persistDraft() {
        localStorage.setItem(MODIFY_DRAFT_KEY, JSON.stringify({ cvData, selectedTemplate }));
    }

    function addEntry(section) {
        const factories = {
            education: () => ({ school: "", degree: "", year: "", score: ""}),
            experience: () => ({ company: "", title: "", dates: "", location: "", details: "" }),
            projects: () => ({ name: "", subtitle: "", dates: "", url: "", github_link: "", details: "" }),
            skills: () => ({ name: "" }),
            extracurriculars: () => ({ role: "", organization: "", dates: "", url: "" }),
            certifications: () => ({ name: "", issuer: "", year: "", url: ""}),
            awards: () => ({ title: "" }),
            publications: () => ({ title: "", publisher: "", year: "", url: ""}),
        };
        if (!cvData[section]) return;
        cvData[section].push(factories[section]());
        renderAll();
        debouncedPreview();
        persistDraft();
    }

    function removeEntry(section, index) {
        if (!cvData[section]) return;
        cvData[section].splice(index, 1);
        renderAll();
        debouncedPreview();
        persistDraft();
    }

    async function loadTemplates() {
        const response = await fetch("/api/resume-templates");
        const data = await response.json();
        templates = data.templates || [];
    }

    // Scale the iframe to fit the scaler container as a miniature A4 model.
    function applyPreviewScale() {
        const scaler = document.getElementById("preview-frame-scaler");
        const frame = document.getElementById("template-preview-frame");
        if (!scaler || !frame) return;

        const A4_WIDTH = 794;
        const availableWidth = scaler.clientWidth;
        if (availableWidth <= 0) return;

        const scale = availableWidth / A4_WIDTH;

        // Measure actual content height; fall back to A4 aspect ratio.
        let contentHeight = Math.round(A4_WIDTH * 1.4142);
        try {
            const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
            if (doc && doc.documentElement) {
                const h = doc.documentElement.scrollHeight;
                if (h > 100) contentHeight = h;
            }
        } catch (_) {}

        frame.style.width = A4_WIDTH + "px";
        frame.style.height = contentHeight + "px";
        frame.style.transform = "scale(" + scale + ")";
        scaler.style.height = Math.ceil(contentHeight * scale) + "px";
    }

    async function updatePreview() {
        const frame = document.getElementById("template-preview-frame");
        const scaler = document.getElementById("preview-frame-scaler");
        const emptyState = document.getElementById("preview-empty-state");
        if (!frame || !emptyState || !selectedTemplate) {
            return;
        }
        try {
            const response = await fetch("/api/render-template-preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    templateId: selectedTemplate,
                    cvData
                })
            });
            const data = await response.json();
            frame.srcdoc = data.html || "";
            frame.style.display = "block";
            if (scaler) scaler.style.display = "block";
            emptyState.style.display = "none";
            // Scale once the iframe content has rendered.
            frame.onload = () => {
                applyPreviewScale();
                // Re-measure after fonts/images settle.
                setTimeout(applyPreviewScale, 400);
            };
        } catch (error) {
            console.error("Preview rendering failed", error);
        }
    }

    // Debounce utility to prevent input blocking from rapid API calls
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    let debouncedPreview = debounce(updatePreview, 300);
    let debouncedPersistDraft = debounce(persistDraft, 500);
    window.addEventListener("resize", debounce(applyPreviewScale, 120));

    function bindInteractions() {
        document.querySelectorAll("[data-scroll-to]").forEach((button) => {
            button.addEventListener("click", () => {
                document.querySelectorAll(".sidebar-nav-btn").forEach((btn) => btn.classList.remove("active"));
                button.classList.add("active");
                const target = document.getElementById(button.dataset.scrollTo);
                if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });

        document.querySelectorAll("[data-oninput]").forEach((input) => {
            const eventType = input.tagName === "TEXTAREA" ? "input" : "input";
            input.readOnly = false; // Ensure editable
            input.addEventListener(eventType, (event) => {
                event.preventDefault();
                setValueByPath(input.dataset.oninput, event.target.value);
                debouncedPreview();
                debouncedPersistDraft();
            });
        });

        document.querySelectorAll("[data-add-entry]").forEach((button) => {
            button.addEventListener("click", () => addEntry(button.dataset.addEntry));
        });

        document.querySelectorAll("[data-remove-entry]").forEach((button) => {
            button.addEventListener("click", () => removeEntry(button.dataset.removeEntry, Number(button.dataset.index)));
        });

        document.querySelectorAll("[data-template-id]").forEach((card) => {
            card.addEventListener("click", () => {
                selectedTemplate = Number(card.dataset.templateId);
                renderAll();
                debouncedPreview();
                persistDraft();
            });
        });
    }

    function setupActionButtons() {
        const saveBtn = document.getElementById("save-draft-btn");
        const downloadBtn = document.getElementById("download-pdf-btn");
        const reoptBtn = document.getElementById("reoptimize-btn");

        function redirectToLogin() {
            const nextUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
            window.location.href = `/login?next=${nextUrl}`;
        }

        if (saveBtn) {
            saveBtn.textContent = "Saved automatically";
            saveBtn.addEventListener("click", () => {
                persistDraft();
                alert("Your CV is already auto-saved while you type.");
            });
        }

        if (downloadBtn) {
            downloadBtn.addEventListener("click", async () => {
                if (!selectedTemplate) {
                    alert("Select a template first.");
                    return;
                }
                try {
                    const response = await fetch("/api/download-cv-pdf", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ templateId: selectedTemplate, cvData })
                    });
                    if (!response.ok) {
                        let detail = "Primary download route failed";
                        try {
                            const payload = await response.json();
                            detail = payload?.detail || payload?.error || detail;
                        } catch {}
                        const error = new Error(detail);
                        error.status = response.status;
                        throw error;
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "custom_cv.pdf";
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    setTimeout(() => window.URL.revokeObjectURL(url), 2000);
                    return;
                } catch (error) {
                    const message = (error?.message || "").toLowerCase();
                    const blockedByAuth = error?.status === 401 || error?.status === 403 || message.includes("not logged in") || message.includes("login");
                    if (blockedByAuth) {
                        redirectToLogin();
                        return;
                    }
                    console.warn("Primary download failed, using fallback.", error);
                }

                const form = document.createElement("form");
                form.method = "POST";
                form.action = "/api/download-cv-pdf-browser";
                form.style.display = "none";

                const templateInput = document.createElement("input");
                templateInput.type = "hidden";
                templateInput.name = "template_id";
                templateInput.value = String(selectedTemplate);
                form.appendChild(templateInput);

                const cvDataInput = document.createElement("input");
                cvDataInput.type = "hidden";
                cvDataInput.name = "cv_data_json";
                cvDataInput.value = JSON.stringify(cvData);
                form.appendChild(cvDataInput);

                document.body.appendChild(form);
                form.submit();
                form.remove();
            });
        }

        if (reoptBtn) {
            reoptBtn.addEventListener("click", () => {
                window.location.href = "/solutions";
            });
        }
    }

    function hydrateDraft() {
        const raw = localStorage.getItem(MODIFY_DRAFT_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            const incoming = parsed.cvData || parsed.resumeData;
            if (incoming) {
                cvData = normalizeIncomingCvData(incoming);
            }
            if (parsed.selectedTemplate) {
                selectedTemplate = Number(parsed.selectedTemplate);
            }
        } catch (error) {
            console.warn("Could not parse draft", error);
        }
    }

    function hydrateSelectedTemplateFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const templateParam = Number(params.get("template"));
        if (!Number.isInteger(templateParam) || templateParam <= 0) {
            return;
        }
        if (!templates.some((template) => Number(template.id) === templateParam)) {
            return;
        }
        selectedTemplate = templateParam;
        persistDraft();
    }

    function mapLinkedInDataToCv(parsed) {
        const data = parsed && typeof parsed === "object" ? parsed : {};
        const toText = (value) => (value == null ? "" : String(value).trim());
        const asArray = (value) => (Array.isArray(value) ? value : []);

        const mapped = createEmptyCvData();
        mapped.personalInfo.name = toText(data.full_name);
        mapped.personalInfo.headline = toText(data.headline);
        mapped.personalInfo.location = toText(data.location);
        mapped.personalInfo.email = toText(data.email);
        mapped.personalInfo.phone = toText(data.phone);
        mapped.personalInfo.summary = toText(data.summary);
        mapped.personalInfo.linkedin = toText(data.linkedin_url || data.profile_url);

        mapped.experience = asArray(data.experience).map((exp) => {
            const start = toText(exp?.start_date);
            const end = toText(exp?.end_date);
            const dates = [start, end].filter(Boolean).join(" - ");
            return {
                company: toText(exp?.company),
                title: toText(exp?.title),
                dates,
                location: toText(exp?.location),
                details: toText(exp?.description),
            };
        }).filter((exp) => exp.company || exp.title || exp.details);

        mapped.education = asArray(data.education).map((edu) => {
            const degree = [toText(edu?.degree), toText(edu?.field)].filter(Boolean).join(" - ");
            const year = [toText(edu?.start_year), toText(edu?.end_year)].filter(Boolean).join(" - ");
            return {
                school: toText(edu?.institution),
                degree,
                year,
                score: "",
            };
        }).filter((edu) => edu.school || edu.degree);

        mapped.skills = asArray(data.skills)
            .map((skill) => {
                const name = skill && typeof skill === "object"
                    ? toText(skill.name || skill.skill || Object.values(skill)[0])
                    : toText(skill);
                return { name };
            })
            .filter((skill) => skill.name);

        mapped.certifications = asArray(data.certifications).map((cert) => ({
            name: toText(cert?.name),
            issuer: toText(cert?.issuer),
            year: toText(cert?.date),
            url: "",
        })).filter((cert) => cert.name || cert.issuer);

        mapped.projects = asArray(data.projects).map((project) => ({
            name: toText(project?.name),
            subtitle: "",
            dates: "",
            url: toText(project?.url),
            github_link: "",
            details: toText(project?.description),
        })).filter((project) => project.name || project.details);

        return mapped;
    }

    function setupCvUploadImport() {
        const openBtn = document.getElementById("cv-upload-import-btn");
        const overlay = document.getElementById("cv-upload-modal-overlay");
        const closeBtn = document.getElementById("cv-upload-modal-close");
        const cancelBtn = document.getElementById("cv-upload-cancel-btn");
        const submitBtn = document.getElementById("cv-upload-submit-btn");
        const fileInput = document.getElementById("cv-upload-file-input");
        const dropzone = document.getElementById("cv-upload-dropzone");
        const dropzoneLabel = document.getElementById("cv-upload-dropzone-label");
        const errorDiv = document.getElementById("cv-upload-error");
        const loadingDiv = document.getElementById("cv-upload-loading");
        const footer = document.getElementById("cv-upload-modal-footer");

        if (!openBtn || !overlay || !fileInput) return;

        let selectedFile = null;

        function resetModal() {
            overlay.style.display = "none";
            fileInput.value = "";
            selectedFile = null;
            submitBtn.disabled = true;
            dropzoneLabel.textContent = "Click to choose a PDF";
            errorDiv.style.display = "none";
            loadingDiv.style.display = "none";
            footer.style.display = "flex";
            submitBtn.disabled = true;
            dropzone.style.borderColor = "rgba(16,185,129,0.4)";
        }

        function showImportBanner(message, isError) {
            const host = document.querySelector(".modify-cv-main");
            if (!host) return;
            const existing = document.getElementById("cv-upload-import-banner");
            if (existing) existing.remove();
            const banner = document.createElement("div");
            banner.id = "cv-upload-import-banner";
            banner.className = `form-card ${isError ? "linkedin-import-banner-error" : "linkedin-import-banner-success"}`;
            banner.style.marginBottom = "12px";
            banner.textContent = message;
            host.insertBefore(banner, host.firstChild);
        }

        function onFileSelected(file) {
            const isPdf = file && (
                file.type === "application/pdf" ||
                file.type === "" ||
                (file.name && file.name.toLowerCase().endsWith(".pdf"))
            );
            if (!file || !isPdf) {
                errorDiv.textContent = "Please select a PDF file.";
                errorDiv.style.display = "block";
                selectedFile = null;
                submitBtn.disabled = true;
                return;
            }
            errorDiv.style.display = "none";
            selectedFile = file;
            dropzoneLabel.textContent = file.name;
            dropzone.style.borderColor = "rgba(16,185,129,0.85)";
            submitBtn.disabled = false;
        }

        openBtn.addEventListener("click", () => { overlay.style.display = "flex"; });
        closeBtn.addEventListener("click", resetModal);
        cancelBtn.addEventListener("click", resetModal);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) resetModal(); });

        fileInput.addEventListener("change", () => {
            if (fileInput.files && fileInput.files[0]) onFileSelected(fileInput.files[0]);
        });

        // Drag and drop
        dropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropzone.style.borderColor = "rgba(16,185,129,0.85)";
            dropzone.style.background = "rgba(16,185,129,0.12)";
        });
        dropzone.addEventListener("dragleave", () => {
            if (!selectedFile) dropzone.style.borderColor = "rgba(16,185,129,0.4)";
            dropzone.style.background = "rgba(16,185,129,0.04)";
        });
        dropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropzone.style.background = "rgba(16,185,129,0.04)";
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) onFileSelected(file);
        });

        submitBtn.addEventListener("click", async () => {
            if (!selectedFile) return;
            errorDiv.style.display = "none";
            loadingDiv.style.display = "block";
            footer.style.display = "none";
            submitBtn.disabled = true;

            try {
                const formData = new FormData();
                formData.append("file", selectedFile);
                const response = await fetch("/api/extract-cv-from-pdf", {
                    method: "POST",
                    body: formData,
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.detail || result.error || "Extraction failed. Please try again.");
                }
                const cvPayload = result.cvData || result;
                if (!cvPayload || typeof cvPayload !== "object") {
                    throw new Error("Could not read CV data from the response.");
                }
                cvData = normalizeIncomingCvData(cvPayload);
                renderAll();
                persistDraft();
                if (selectedTemplate) await updatePreview();
                resetModal();
                const expCount = Array.isArray(cvData.experience) ? cvData.experience.length : 0;
                const eduCount = Array.isArray(cvData.education) ? cvData.education.length : 0;
                const skillCount = Array.isArray(cvData.skills) ? cvData.skills.length : 0;
                showImportBanner(
                    `CV imported successfully. Found ${expCount} experience, ${eduCount} education, ${skillCount} skills. Review and edit each section below.`,
                    false
                );
                document.getElementById("sections-container").scrollIntoView({ behavior: "smooth", block: "start" });
            } catch (error) {
                loadingDiv.style.display = "none";
                footer.style.display = "flex";
                submitBtn.disabled = false;
                errorDiv.textContent = error.message || "Import failed. Please try again.";
                errorDiv.style.display = "block";
            }
        });
    }

    function setupLinkedInImport() {
        const openBtn  = document.getElementById("linkedin-import-btn");
        const overlay  = document.getElementById("linkedin-modal-overlay");
        const closeBtn = document.getElementById("linkedin-modal-close");
        const cancelBtn = document.getElementById("linkedin-cancel-btn");
        const submitBtn = document.getElementById("linkedin-import-submit-btn");
        const urlInput  = document.getElementById("linkedin-url-input");
        const errorDiv  = document.getElementById("linkedin-error");
        const loadingDiv = document.getElementById("linkedin-loading");
        const footer    = document.getElementById("linkedin-modal-footer");

        if (!openBtn || !overlay) return;

        async function applyLinkedInData(parsedData) {
            cvData = normalizeIncomingCvData(mapLinkedInDataToCv(parsedData));
            renderAll();
            persistDraft();
            if (selectedTemplate) await updatePreview();
        }

        function showImportBanner(message, isError) {
            const host = document.querySelector(".modify-cv-main");
            if (!host) return;
            const existing = document.getElementById("linkedin-import-banner");
            if (existing) existing.remove();
            const banner = document.createElement("div");
            banner.id = "linkedin-import-banner";
            banner.className = `form-card ${isError ? "linkedin-import-banner-error" : "linkedin-import-banner-success"}`;
            banner.style.marginBottom = "12px";
            banner.textContent = message;
            host.insertBefore(banner, host.firstChild);
        }

        function resetModal() {
            overlay.style.display = "none";
            if (urlInput)   { urlInput.value = ""; urlInput.disabled = false; }
            if (errorDiv)   errorDiv.style.display = "none";
            if (loadingDiv) loadingDiv.style.display = "none";
            footer.style.display = "flex";
            submitBtn.disabled = false;
        }

        openBtn.addEventListener("click", () => { overlay.style.display = "flex"; });
        closeBtn.addEventListener("click", resetModal);
        cancelBtn.addEventListener("click", resetModal);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) resetModal(); });

        submitBtn.addEventListener("click", async () => {
            const url = (urlInput ? urlInput.value : "").trim();
            if (errorDiv) errorDiv.style.display = "none";

            if (!url || !url.includes("linkedin.com/in/")) {
                if (errorDiv) {
                    errorDiv.textContent = "Please enter a valid LinkedIn URL (e.g. https://www.linkedin.com/in/your-name)";
                    errorDiv.style.display = "block";
                }
                return;
            }

            if (loadingDiv) loadingDiv.style.display = "block";
            footer.style.display = "none";
            if (urlInput) urlInput.disabled = true;
            submitBtn.disabled = true;

            try {
                const response = await fetch("/api/linkedin-import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url }),
                });
                const result = await response.json();
                if (!response.ok || !result?.success) {
                    throw new Error(result?.detail || result?.error || "Import failed. Make sure your profile is Public and try again.");
                }
                await applyLinkedInData(result.data);
                resetModal();
                const expCount   = Array.isArray(cvData.experience) ? cvData.experience.length : 0;
                const eduCount   = Array.isArray(cvData.education)  ? cvData.education.length  : 0;
                const skillCount = Array.isArray(cvData.skills)     ? cvData.skills.length     : 0;
                showImportBanner(`LinkedIn profile imported. Found ${expCount} experience, ${eduCount} education, ${skillCount} skills. Review and edit below.`, false);
                document.getElementById("sections-container").scrollIntoView({ behavior: "smooth", block: "start" });
            } catch (err) {
                if (loadingDiv) loadingDiv.style.display = "none";
                footer.style.display = "flex";
                if (urlInput) urlInput.disabled = false;
                submitBtn.disabled = false;
                if (errorDiv) {
                    errorDiv.textContent = err?.message || "Import failed. Make sure your profile is Public and try again.";
                    errorDiv.style.display = "block";
                }
            }
        });
    }

    document.addEventListener("DOMContentLoaded", async () => {
        try {
            await loadTemplates();
            hydrateDraft();
            hydrateSelectedTemplateFromQuery();
            renderAll();
            setupActionButtons();
            setupCvUploadImport();
        setupLinkedInImport();
            if (selectedTemplate) {
                await updatePreview();
            }
        } catch (error) {
            console.error("Failed to initialize Modify CV page", error);
        }
    });
})();
