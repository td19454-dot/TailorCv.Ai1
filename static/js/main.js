// Global state
let selectedTemplate = null;
let selectedStyle = null;
console.log('[main.js] Script loaded');

// Template and Style Options
const templates = [
    { id: 1, name: 'Template 1', icon: '📄' },
    { id: 2, name: 'Template 2', icon: '📋' },
    { id: 3, name: 'Template 3', icon: '📑' },
    { id: 4, name: 'Template 4', icon: '📃' },
    { id: 5, name: 'Template 5', icon: '🗂️' }
];

const styles = [
    { id: 1, name: 'Modern', color: '#6366f1' },
    { id: 2, name: 'Professional', color: '#2563eb' },
    { id: 3, name: 'Clean', color: '#059669' }
];

// Initialization
function init() {
    console.log('[main.js] init() called, DOM ready');

    const fileInput = document.getElementById('resume-file');
    const fileName = document.getElementById('file-name');
    
    console.log('[main.js] File input found:', !!fileInput);
    console.log('[main.js] File name element found:', !!fileName);
    
    if (fileInput && fileName) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                fileName.textContent = e.target.files[0].name;
            } else {
                fileName.textContent = 'No file chosen';
            }
        });
        console.log('[main.js] File change listener attached');
    }

    // Analyze button handler
    const analyzeBtn = document.getElementById('analyze-btn');
    console.log('[main.js] Analyze button found:', !!analyzeBtn);
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', handleATSAnalysis);
        console.log('[main.js] Analyze button listener attached');
    }

    // Optimize button handler
    const optimizeBtn = document.getElementById('optimize-btn');
    console.log('[main.js] Optimize button found:', !!optimizeBtn);
    if (optimizeBtn) {
        optimizeBtn.addEventListener('click', handleResumeOptimizationClick);
        console.log('[main.js] Optimize button listener attached - will call handleResumeOptimizationClick');
    } else {
        console.error('[main.js] Optimize button with id="optimize-btn" NOT FOUND in DOM');
    }
    
    console.log('[main.js] init() completed');
}

if (document.readyState === 'loading') {
    console.log('[main.js] Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM already loaded
    console.log('[main.js] DOM already ready, running init immediately');
    init();
}

// Generate template selection grid
function generateTemplateGrid() {
    console.log('[main.js] generateTemplateGrid() called');
    const gridContainer = document.querySelector('.template-grid');
    console.log('[main.js] gridContainer found:', !!gridContainer, gridContainer);
    if (!gridContainer) {
        console.warn('[main.js] .template-grid container not found in DOM');
        return;
    }

    templates.forEach(template => {
        styles.forEach(style => {
            const card = document.createElement('div');
            card.className = 'template-option';
            card.dataset.templateId = template.id;
            card.dataset.styleId = style.id;
            card.innerHTML = `
                <div class="template-option-icon">${template.icon}</div>
                <div class="template-option-name">${template.name}</div>
                <div class="template-option-style">${style.name} Style</div>
            `;
            
            card.addEventListener('click', () => selectTemplate(template, style, card));
            gridContainer.appendChild(card);
        });
    });
    console.log('[main.js] Successfully created and appended', gridContainer.children.length, 'template cards');
}

// Handle template selection
function selectTemplate(template, style, cardElement) {
    // Remove previous selection
    document.querySelectorAll('.template-option').forEach(card => {
        card.classList.remove('selected');
    });

    // Mark as selected
    cardElement.classList.add('selected');
    selectedTemplate = template;
    selectedStyle = style;

    // Show the "Proceed with Selected Template" button
    const proceedBtn = document.getElementById('confirm-template-btn');
    if (proceedBtn) {
        proceedBtn.style.display = 'block';
    }
}

// Show template modal when Optimize button is clicked
function handleResumeOptimizationClick() {
    console.log('[main.js] handleResumeOptimizationClick() called');
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');

    console.log('[main.js] Resume file:', fileInput?.value || 'not found');
    console.log('[main.js] JD input found:', !!jdInput);

    // Validation
    if (!fileInput.files[0]) {
        console.warn('[main.js] No resume file selected');
        alert('Please upload a resume file');
        return;
    }

    if (!jdInput.value.trim()) {
        console.warn('[main.js] No job description provided');
        alert('Please paste the job description');
        return;
    }

    console.log('[main.js] Validation passed, showing template modal');
    // Show the template modal
    showTemplateModal();
}

// Show the template selection modal
function showTemplateModal() {
    console.log('[main.js] Showing template modal');
    const modal = document.getElementById('template-modal');
    console.log('[main.js] Modal element found:', !!modal, modal);
    
    if (!modal) {
        console.error('[main.js] Template modal element not found!');
        alert('Template selection UI not available');
        return;
    }
    
    const gridContainer = modal.querySelector('.template-grid');
    console.log('[main.js] Grid container found:', !!gridContainer, gridContainer);
    
    if (!gridContainer) {
        console.error('[main.js] Template grid container not found!');
        alert('Template grid UI not available');
        return;
    }
    
    // Clear previous grid
    gridContainer.innerHTML = '';
    console.log('[main.js] Cleared previous grid');
    
    // Generate template options in the modal
    templates.forEach(template => {
        styles.forEach(style => {
            const card = document.createElement('div');
            card.className = 'template-option';
            card.dataset.templateId = template.id;
            card.dataset.styleId = style.id;
            card.innerHTML = `
                <div class="template-option-icon">${template.icon}</div>
                <div class="template-option-name">${template.name}</div>
                <div class="template-option-style">${style.name} Style</div>
            `;
            
            card.addEventListener('click', () => selectTemplate(template, style, card));
            gridContainer.appendChild(card);
        });
    });
    
    console.log('[main.js] Created', gridContainer.children.length, 'template cards');
    
    // Reset selection state
    selectedTemplate = null;
    selectedStyle = null;
    const proceedBtn = document.getElementById('confirm-template-btn');
    if (proceedBtn) {
        proceedBtn.style.display = 'none';
    }
    
    // Show modal
    modal.style.display = 'block';
    console.log('[main.js] Template modal displayed, current display:', modal.style.display);
}

// Close the template modal
function closeTemplateModal() {
    console.log('[main.js] closeTemplateModal() called');
    const modal = document.getElementById('template-modal');
    if (modal) {
        modal.style.display = 'none';
        console.log('[main.js] Template modal hidden');
    } else {
        console.warn('[main.js] Template modal element not found');
    }
}

// Proceed with the selected template
function proceedWithTemplate() {
    if (!selectedTemplate || !selectedStyle) {
        alert('Please select a template first');
        return;
    }

    console.log('[main.js] Proceeding with template:', selectedTemplate.id, 'style:', selectedStyle.id);
    
    // Close the modal
    closeTemplateModal();
    
    // Call the resume optimization with the selected template
    handleResumeOptimization();
}

// Handle ATS Score Analysis
async function handleATSAnalysis() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resultsSection = document.getElementById('results-section');
    const atsResults = document.getElementById('ats-results');
    const atsContent = document.getElementById('ats-content');

    // Validation
    if (!fileInput.files[0]) {
        alert('Please upload a resume file');
        return;
    }

    if (!jdInput.value.trim()) {
        alert('Please paste the job description');
        return;
    }

    // Show loading state
    analyzeBtn.disabled = true;
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing...';
    analyzeBtn.querySelector('.btn-loader').style.display = 'inline-block';

    // Prepare form data
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const jdString = encodeURIComponent(jdInput.value.trim());

    try {
        const response = await fetch(`/get-ats-score?jd_string=${jdString}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Failed to get ATS score');
        }

        const data = await response.json();
        
        // Display results
        displayATSResults(data);
        resultsSection.style.display = 'block';
        atsResults.style.display = 'block';
        
        // Scroll to results
        atsResults.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('Error:', error);
        alert('Error analyzing resume: ' + error.message);
    } finally {
        // Reset button state
        analyzeBtn.disabled = false;
        analyzeBtn.querySelector('.btn-text').textContent = 'Get ATS Score';
        analyzeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

// Display ATS Results (updated for detailed JSON schema)
function displayATSResults(data) {
    const atsContent = document.getElementById('ats-content');

    // Safeguard against missing fields
    const safe = (value, fallback = 'Not specified') =>
        value === undefined || value === null || value === '' ? fallback : value;

    // Determine score color
    let scoreColor = '#ef4444'; // red
    if (data.match_rate >= 80) scoreColor = '#10b981'; // green
    else if (data.match_rate >= 60) scoreColor = '#f59e0b'; // orange;

    const exp = data.experience || {};
    const jt = data.job_title_match || {};
    const search = data.searchability || {};
    const contact = search.contact_information || {};
    const summary = search.professional_summary || {};
    const sections = search.section_headings || {};
    const chronology = search.chronology || {};
    const spelling = search.spelling_grammar || {};
    const links = search.links || {};
    const cliches = data.cliches || {};
    const formatting = data.formatting || {};

    const html = `
        <div class="ats-score-display">
            <div class="score-circle" style="background: ${scoreColor};">
                ${safe(data.match_rate, 0)}%
            </div>
            <div class="match-level">Match Level: ${safe(data.match_level, 'Not rated')}</div>
        </div>

        <div class="score-section">
            <div class="score-section-title">Hard Skills</div>
            ${data.hard_skills?.matched?.length ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.hard_skills.matched.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
            ${data.hard_skills?.missing?.length ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.hard_skills.missing.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Soft Skills</div>
            ${data.soft_skills?.matched?.length ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.soft_skills.matched.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
            ${data.soft_skills?.missing?.length ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.soft_skills.missing.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Keywords</div>
            ${data.keywords?.matched?.length ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.keywords.matched.map(keyword => `<span class="item-tag">${keyword}</span>`).join('')}
                </div>
            ` : ''}
            ${data.keywords?.missing?.length ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.keywords.missing.map(keyword => `<span class="item-tag">${keyword}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Tools & Technologies</div>
            ${data.tools_and_technologies?.matched?.length ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.tools_and_technologies.matched.map(tool => `<span class="item-tag">${tool}</span>`).join('')}
                </div>
            ` : ''}
            ${data.tools_and_technologies?.missing?.length ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.tools_and_technologies.missing.map(tool => `<span class="item-tag">${tool}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Experience Match</div>
            <p><strong>Job Requirement:</strong> ${safe(exp.job_requirement)}</p>
            <p><strong>Your Experience:</strong> ${safe(exp.resume_experience)}</p>
            <p><strong>Match Status:</strong>
                <span class="status-badge ${exp.match_status === 'Strong' ? 'status-ok' : exp.match_status === 'Partial' ? 'status-warn' : 'status-bad'}">
                    ${safe(exp.match_status, 'Not rated')}
                </span>
            </p>
            <p><strong>Relevance Score:</strong> ${safe(exp.relevance_score, 0)}%</p>
            ${exp.notes ? `<p class="status-notes">${exp.notes}</p>` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Job Title Match</div>
            <p><strong>Job Title in JD:</strong> ${safe(jt.job_title_in_jd)}</p>
            <p><strong>Your Titles:</strong> ${jt.resume_titles?.length ? jt.resume_titles.join(', ') : 'Not specified'}</p>
            <p><strong>Match Status:</strong>
                <span class="status-badge ${jt.match_status === 'Strong' ? 'status-ok' : jt.match_status === 'Partial' ? 'status-warn' : 'status-bad'}">
                    ${safe(jt.match_status, 'Not rated')}
                </span>
            </p>
        </div>

        <div class="score-section">
            <div class="score-section-title">Searchability & Structure</div>
            <p><strong>Searchability Score:</strong> ${safe(search.score, 0)}%</p>

            <div class="status-grid">
                <div class="status-item">
                    <div class="status-label">Contact Info</div>
                    <div class="status-badges">
                        <span class="status-badge ${contact.has_name ? 'status-ok' : 'status-bad'}">Name</span>
                        <span class="status-badge ${contact.has_email ? 'status-ok' : 'status-bad'}">Email</span>
                        <span class="status-badge ${contact.has_phone ? 'status-ok' : 'status-bad'}">Phone</span>
                    </div>
                </div>
                <div class="status-item">
                    <div class="status-label">Professional Summary</div>
                    <div class="status-badges">
                        <span class="status-badge ${summary.is_present ? 'status-ok' : 'status-bad'}">Present</span>
                        <span class="status-badge ${summary.is_clear_and_concise ? 'status-ok' : 'status-warn'}">Clear</span>
                        <span class="status-badge ${summary.is_relevant_to_jd ? 'status-ok' : 'status-warn'}">Relevant</span>
                    </div>
                </div>
                <div class="status-item">
                    <div class="status-label">Section Headings</div>
                    <div class="status-badges">
                        <span class="status-badge ${sections.has_work_experience ? 'status-ok' : 'status-bad'}">Work Exp</span>
                        <span class="status-badge ${sections.has_education ? 'status-ok' : 'status-bad'}">Education</span>
                        <span class="status-badge ${sections.has_skills ? 'status-ok' : 'status-bad'}">Skills</span>
                        <span class="status-badge ${sections.has_projects ? 'status-ok' : 'status-warn'}">Projects</span>
                    </div>
                    ${sections.missing_sections?.length ? `
                        <div class="status-notes">
                            Missing: ${sections.missing_sections.join(', ')}
                        </div>
                    ` : ''}
                </div>
                <div class="status-item">
                    <div class="status-label">Chronology</div>
                    <div class="status-badges">
                        <span class="status-badge ${chronology.is_chronological ? 'status-ok' : 'status-bad'}">
                            ${chronology.is_chronological ? 'Chronological' : 'Out of order'}
                        </span>
                    </div>
                    ${chronology.issues?.length ? `
                        <div class="status-notes">
                            ${chronology.issues.join('; ')}
                        </div>
                    ` : ''}
                </div>
                <div class="status-item">
                    <div class="status-label">Spelling & Grammar</div>
                    <div class="status-badges">
                        <span class="status-badge ${spelling.has_spelling_or_grammar_errors ? 'status-bad' : 'status-ok'}">
                            ${spelling.has_spelling_or_grammar_errors ? 'Issues found' : 'No major issues'}
                        </span>
                    </div>
                    ${spelling.examples?.length ? `
                        <div class="status-notes">
                            Examples: ${spelling.examples.join('; ')}
                        </div>
                    ` : ''}
                </div>
                <div class="status-item">
                    <div class="status-label">Links</div>
                    <div class="status-badges">
                        <span class="status-badge ${links.has_relevant_links ? 'status-ok' : 'status-warn'}">
                            ${links.has_relevant_links ? 'Relevant links present' : 'Links could be stronger'}
                        </span>
                    </div>
                    ${links.missing_recommended_links?.length ? `
                        <div class="status-notes">
                            Suggested links: ${links.missing_recommended_links.join(', ')}
                        </div>
                    ` : ''}
                </div>
            </div>

            ${search.issues?.length ? `
                <div class="status-notes">
                    <strong>Overall Searchability Issues:</strong>
                    <ul class="status-list">
                        ${search.issues.map(issue => `<li>${issue}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Clichés & Buzzwords</div>
            <p>
                <strong>Has clichés:</strong>
                <span class="status-badge ${cliches.has_cliches ? 'status-bad' : 'status-ok'}">
                    ${cliches.has_cliches ? 'Yes' : 'No major clichés'}
                </span>
            </p>
            ${cliches.examples?.length ? `
                <div class="status-notes">
                    Examples: ${cliches.examples.join('; ')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Formatting & Design</div>
            <div class="status-grid">
                <div class="status-item">
                    <div class="status-label">Photos / Graphics</div>
                    <span class="status-badge ${formatting.is_photo_free ? 'status-ok' : 'status-bad'}">
                        ${formatting.is_photo_free ? 'No photos' : 'Has photos/watermarks'}
                    </span>
                </div>
                <div class="status-item">
                    <div class="status-label">Layout</div>
                    <span class="status-badge ${formatting.is_single_column ? 'status-ok' : 'status-bad'}">
                        ${formatting.is_single_column ? 'Single column' : 'Multi-column'}
                    </span>
                </div>
                <div class="status-item">
                    <div class="status-label">Color & Design</div>
                    <span class="status-badge ${formatting.has_minimal_color_and_design ? 'status-ok' : 'status-warn'}">
                        ${formatting.has_minimal_color_and_design ? 'ATS-friendly' : 'Too much design'}
                    </span>
                </div>
                <div class="status-item">
                    <div class="status-label">Unnecessary Sections</div>
                    <span class="status-badge ${formatting.unnecessary_sections_present ? 'status-warn' : 'status-ok'}">
                        ${formatting.unnecessary_sections_present ? 'Present' : 'None'}
                    </span>
                </div>
            </div>
            ${formatting.unnecessary_sections?.length ? `
                <div class="status-notes">
                    Unnecessary sections: ${formatting.unnecessary_sections.join(', ')}
                </div>
            ` : ''}
        </div>

        ${data.recruiter_tips?.length ? `
            <div class="recruiter-tips">
                <div class="recruiter-tips-title">💡 Recruiter Tips</div>
                <ul>
                    ${data.recruiter_tips.map(tip => `<li>${tip}</li>`).join('')}
                </ul>
            </div>
        ` : ''}
    `;

    atsContent.innerHTML = html;
}

// Handle Resume Optimization
async function handleResumeOptimization() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const optimizeBtn = document.getElementById('optimize-btn');
    const resultsSection = document.getElementById('results-section');
    const optimizeResults = document.getElementById('optimize-results');
    const optimizeContent = document.getElementById('optimize-content');

    // Validation
    if (!fileInput.files[0]) {
        alert('Please upload a resume file');
        return;
    }

    if (!jdInput.value.trim()) {
        alert('Please paste the job description');
        return;
    }

    if (!selectedTemplate || !selectedStyle) {
        alert('Please select a template first');
        return;
    }

    // Show loading state
    optimizeBtn.disabled = true;
    optimizeBtn.querySelector('.btn-text').textContent = 'Optimizing...';
    optimizeBtn.querySelector('.btn-loader').style.display = 'inline-block';

    // Prepare form data
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const jdString = encodeURIComponent(jdInput.value.trim());
    const templateId = selectedTemplate.id;
    const styleId = selectedStyle.id;

    try {
        const response = await fetch(`/get-optimised-resume?jd_string=${jdString}&template_id=${templateId}&style_id=${styleId}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const serverDetail = await response.text();
            let message = serverDetail;
            try {
                const parsed = JSON.parse(serverDetail);
                if (parsed?.detail) message = parsed.detail;
            } catch (e) {
                // non‑JSON body; leave as-is
            }
            throw new Error(message || `HTTP error ${response.status}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        displayOptimizeResults(url);
        optimizeResults.style.display = 'block';
        resultsSection.style.display = 'block';
        optimizeResults.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('Error:', error);
        alert(`Optimization failed: ${error.message}`);
    } finally {
        optimizeBtn.disabled = false;
        optimizeBtn.querySelector('.btn-text').textContent = 'Optimize Resume';
        optimizeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

// Display Optimize Results
function displayOptimizeResults(pdfUrl) {
    const optimizeContent = document.getElementById('optimize-content');
    optimizeContent.innerHTML = `
        <div class="optimize-success">
            <div class="optimize-success-icon">✅</div>
            <div class="optimize-success-title">Resume Optimized!</div>
            <div class="optimize-success-message">
                Your resume has been optimized and is ready for download.
            </div>
            <a href="${pdfUrl}" download="optimized_resume.pdf" class="download-btn">Download Optimized Resume</a>
        </div>
    `;
}

// Close results
function closeResults(resultId) {
    const element = document.getElementById(resultId);
    if (element) {
        element.style.display = 'none';
    }
}
