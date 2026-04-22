(function () {
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

    let cvData = {
        personalInfo: {},
        education: [],
        experience: [],
        projects: [],
        skills: [],
        extracurriculars: [],
        certifications: [],
        awards: [],
        publications: []
    };

    let selectedTemplate = null;
    let templates = [];

    function createInput(label, value, onInput, placeholder = "") {
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
                                <label class="form-label">Details</label>
                                <textarea class="section-textarea" data-oninput="${id}.${index}.details">${escapeHtml(item.details || "")}</textarea>
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
            () => ({ school: "", degree: "", year: "", score: "", details: "" })
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
            ],
            cvData.projects,
            () => ({ name: "", subtitle: "", dates: "", url: "", github_link: "", details: "" })
        );
    }

    function SkillsSection() {
        const skills = cvData.skills.length ? cvData.skills : [{ name: "", details: "" }];
        return `
            <section id="skills" class="form-card section-card">
                <h2 class="form-title">Skills</h2>
                ${skills
                    .map(
                        (skill, index) => `
                        <div class="entry-card">
                            <label class="form-label">Skill / Category</label>
                            <input class="section-input" value="${escapeHtml(skill.name || "")}" data-oninput="skills.${index}.name" placeholder="Languages: JavaScript, Python" />
                            <label class="form-label">Details</label>
                            <textarea class="section-textarea" data-oninput="skills.${index}.details">${escapeHtml(skill.details || "")}</textarea>
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
            () => ({ title: "", publisher: "", year: "", url: "", details: "" })
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
                                <div class="template-thumb">Preview ${template.id}</div>
                                <div class="template-name">${template.name}</div>
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

    function addEntry(section) {
        const factories = {
            education: () => ({ school: "", degree: "", year: "", score: "", details: "" }),
            experience: () => ({ company: "", title: "", dates: "", location: "", details: "" }),
            projects: () => ({ name: "", subtitle: "", dates: "", url: "", github_link: "", details: "" }),
            skills: () => ({ name: "", details: "" }),
            extracurriculars: () => ({ role: "", organization: "", dates: "", url: "", details: "" }),
            certifications: () => ({ name: "", issuer: "", year: "", url: "", details: "" }),
            awards: () => ({ title: "" }),
            publications: () => ({ title: "", publisher: "", year: "", url: "", details: "" }),
        };
        if (!cvData[section]) return;
        cvData[section].push(factories[section]());
        renderAll();
        debouncedPreview();
    }

    function removeEntry(section, index) {
        if (!cvData[section]) return;
        cvData[section].splice(index, 1);
        renderAll();
        debouncedPreview();
    }

    async function loadTemplates() {
        const response = await fetch("/api/resume-templates");
        const data = await response.json();
        templates = data.templates || [];
    }

async function updatePreview() {
        const frame = document.getElementById("template-preview-frame");
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
            emptyState.style.display = "none";
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
                setValueByPath(input.dataset.oninput, event.target.value);
                debouncedPreview();
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
            });
        });
    }

    function setupActionButtons() {
        const saveBtn = document.getElementById("save-draft-btn");
        const downloadBtn = document.getElementById("download-pdf-btn");
        const reoptBtn = document.getElementById("reoptimize-btn");

        if (saveBtn) {
            saveBtn.addEventListener("click", () => {
                localStorage.setItem("tailorcv_modify_draft", JSON.stringify({ cvData, selectedTemplate }));
                alert("Draft saved locally.");
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
                        throw new Error("Primary download route failed");
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
        const raw = localStorage.getItem("tailorcv_modify_draft");
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            const incoming = parsed.cvData || parsed.resumeData;
            if (incoming) {
                cvData = {
                    personalInfo: incoming.personalInfo || {},
                    education: incoming.education || [],
                    experience: incoming.experience || [],
                    projects: incoming.projects || [],
                    skills: incoming.skills || [],
                    extracurriculars: incoming.extracurriculars || [],
                    certifications: incoming.certifications || [],
                    awards: incoming.awards || [],
                    publications: incoming.publications || [],
                };
            }
            if (parsed.selectedTemplate) {
                selectedTemplate = Number(parsed.selectedTemplate);
            }
        } catch (error) {
            console.warn("Could not parse draft", error);
        }
    }

    document.addEventListener("DOMContentLoaded", async () => {
        try {
            await loadTemplates();
            hydrateDraft();
            renderAll();
            setupActionButtons();
            if (selectedTemplate) {
                await updatePreview();
            }
        } catch (error) {
            console.error("Failed to initialize Modify CV page", error);
        }
    });
})();
