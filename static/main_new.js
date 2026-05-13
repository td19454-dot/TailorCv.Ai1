// Global state
let selectedTemplate = null;
let selectedStyle = 1; // Default to style 1 (Modern)

// Template and Style Options
const templates = [
    { id: 1, name: 'Modern Professional', image: 'pic1.jpg' },
    { id: 2, name: 'Executive Minimal', image: 'pic2.jpg' },
    { id: 3, name: 'Creative Tech', image: 'pic3.jpg' },
    { id: 4, name: 'Classic Academic', image: 'pic4.jpg' },
    { id: 5, name: 'Modern Elegant', image: 'pic5.jpg' },
    { id: 6, name: 'Professional Classic', image: 'pic6.jpg' },
    { id: 7, name: 'Navy Sidebar', image: 'pic7.jpg' },
    { id: 8, name: 'Teal Sidebar', image: 'pic8.jpg'},
    { id: 9, name: 'Burgundy Sidebar', image: 'pic9.jpg' },
    { id: 10, name: 'Slate Sidebar', image: 'pic10.jpg' },
    { id: 11, name: 'Forest Sidebar', image: 'pic11.jpg' },
    { id: 12, name: 'Skyline Blue', image: 'pic12.jpg' },
    { id: 13, name: 'Gray Executive Panel', image: 'pic13.png' },
    { id: 14, name: 'Olive Timeline Pro', image: 'pic14.png' },
    { id: 15, name: 'Aqua Timeline Modern', image: 'pic15.png' },
    { id: 16, name: 'Navy Rail Editorial', image: 'pic16.png' },
    { id: 17, name: 'Executive Gray Board', image: 'pic17.png' },
    { id: 18, name: 'Classic Gray Professional', image: 'pic18.png' }
];

const styles = [
    { id: 1, name: 'Modern', color: '#6366f1' },
    { id: 2, name: 'Professional', color: '#2563eb' },
    { id: 3, name: 'Clean', color: '#059669' }
];

// LocalStorage helpers for persistent inputs
const LS_KEYS = {
    jobDescription: 'tailorcv_jobDescription',
    resumeFile: 'tailorcv_resumeFile',
    selectedTemplate: 'tailorcv_selected_template',
    optimizedEditorPayload: 'tailorcv_optimized_editor_payload'
};

function saveJobDescription(value) {
    localStorage.setItem(LS_KEYS.jobDescription, value);
}

function getJobDescription() {
    return localStorage.getItem(LS_KEYS.jobDescription) || '';
}

function saveResumeFile(fileDataUrl, fileName, fileType) {
    localStorage.setItem(LS_KEYS.resumeFile, JSON.stringify({
        data: fileDataUrl,
        name: fileName,
        type: fileType
    }));
}

function getResumeFile() {
    try {
        const raw = localStorage.getItem(LS_KEYS.resumeFile);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function clearStoredInputs() {
    localStorage.removeItem(LS_KEYS.jobDescription);
    localStorage.removeItem(LS_KEYS.resumeFile);
}

function dataUrlToFile(dataUrl, filename, mimeType) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mimeType || mime });
}

function getResumeFileForUpload() {
    const fileInput = document.getElementById('resume-file');
    if (fileInput && fileInput.files[0]) return fileInput.files[0];
    const stored = getResumeFile();
    if (stored) {
        return dataUrlToFile(stored.data, stored.name, stored.type);
    }
    return null;
}

function updateStoredFileUI(name) {
    const info = document.getElementById('stored-file-info');
    const nameEl = document.getElementById('stored-file-name');
    if (info && nameEl) {
        nameEl.textContent = name;
        info.style.display = 'block';
    }
}

function hideStoredFileUI() {
    const info = document.getElementById('stored-file-info');
    if (info) info.style.display = 'none';
}

function restoreSavedInputs() {
    const jdInput = document.getElementById('job-description');
    if (jdInput) {
        const savedJD = getJobDescription();
        if (savedJD) jdInput.value = savedJD;
    }
    const storedFile = getResumeFile();
    if (storedFile) {
        updateStoredFileUI(storedFile.name);
        const fileName = document.getElementById('file-name');
        if (fileName) fileName.textContent = storedFile.name;
    }
}

function getTemplateIdFromNavigation() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = Number(params.get('template'));
    if (Number.isInteger(fromQuery) && templates.some(t => Number(t.id) === fromQuery)) {
        return fromQuery;
    }

    if (window.location.pathname !== '/optimize') {
        return null;
    }

    const fromStorage = Number(localStorage.getItem(LS_KEYS.selectedTemplate));
    if (Number.isInteger(fromStorage) && templates.some(t => Number(t.id) === fromStorage)) {
        return fromStorage;
    }
    return null;
}

function showTemplateSelectionSection() {
    const templateSection = document.getElementById('template-selection-section');
    if (!templateSection) return;
    templateSection.style.display = 'block';
}

function applyTemplateFromNavigation() {
    const templateId = getTemplateIdFromNavigation();
    if (!templateId) return;

    selectedTemplate = templates.find(t => Number(t.id) === Number(templateId)) || null;
    showTemplateSelectionSection();
    generateTemplateGrid();

    const card = document.querySelector(`.template-card[data-template-id="${templateId}"]`);
    if (card && selectedTemplate) {
        card.classList.add('selected');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
// File upload handler
    const fileInput = document.getElementById('resume-file');
    const fileName = document.getElementById('file-name');
    
    if (fileInput && fileName) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                fileName.textContent = file.name;
                const reader = new FileReader();
                reader.onload = function(evt) {
                    saveResumeFile(evt.target.result, file.name, file.type);
                    updateStoredFileUI(file.name);
                };
                reader.readAsDataURL(file);
            } else {
                fileName.textContent = 'No file chosen';
            }
        });
    }

    // Ensure job description textarea is paste-enabled (safety fix)
    const jdInput = document.getElementById('job-description');
    if (jdInput) {
        jdInput.removeAttribute('readonly');
        jdInput.style.userSelect = 'text';
        jdInput.style.webkitUserSelect = 'text';
        jdInput.style.pointerEvents = 'auto';
        
        // Debug paste events
        jdInput.addEventListener('paste', function(e) {
            console.log('Paste event on job-description textarea:', e.clipboardData.getData('text'));
        });
        
        // Save job description as user types
        jdInput.addEventListener('input', function() {
            saveJobDescription(jdInput.value);
        });
        
        console.log('Job description textarea paste-ready');
    }

    // Clear stored inputs button
    const clearStoredBtn = document.getElementById('clear-stored-btn');
    if (clearStoredBtn) {
        clearStoredBtn.addEventListener('click', function() {
            clearStoredInputs();
            const fileInput = document.getElementById('resume-file');
            const fileName = document.getElementById('file-name');
            const jdInput = document.getElementById('job-description');
            if (fileInput) fileInput.value = '';
            if (fileName) fileName.textContent = 'No file chosen';
            if (jdInput) jdInput.value = '';
            hideStoredFileUI();
        });
    }

    // Restore previously saved inputs on load
    restoreSavedInputs();
    applyTemplateFromNavigation();

    // Analyze button handler
    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', handleATSAnalysis);
    }

    // Optimize button handler - SHOW TEMPLATES FIRST
    const optimizeBtn = document.getElementById('optimize-btn');
    if (optimizeBtn) {
        optimizeBtn.addEventListener('click', function() {
            // Validate inputs first
            const fileInput = document.getElementById('resume-file');
            const jdInput = document.getElementById('job-description');
            
            if (!getResumeFileForUpload()) {
                alert('Please upload a resume file');
                return;
            }
            
            if (!jdInput.value.trim()) {
                alert('Please paste the job description');
                return;
            }
            
            optimizeBtn.classList.add('loading', 'animate-shimmer');
            optimizeBtn.querySelector('.btn-text').textContent = 'Loading templates...';
            // Show template selection
            const templateSection = document.getElementById('template-selection-section');
            if (templateSection) {
                templateSection.style.display = 'block';
                generateTemplateGrid();
                templateSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            setTimeout(() => {
                optimizeBtn.classList.remove('loading', 'animate-shimmer');
                optimizeBtn.querySelector('.btn-text').textContent = 'Select Template & Optimize';
            }, 1200);
        });
    }

    // Confirm button handler - ACTUALLY OPTIMIZE
    const confirmBtn = document.getElementById('confirm-optimize-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            if (!selectedTemplate) {
                alert('Please select a template from the list above');
                return;
            }
            handleResumeOptimization();
        });
    }
});

// Generate template selection grid
function generateTemplateGrid() {
    const grid = document.getElementById('templates-grid');
    if (!grid) return;

    grid.innerHTML = templates.map(temp => `
        <div class="template-card ${selectedTemplate && Number(selectedTemplate.id) === Number(temp.id) ? 'selected' : ''}" data-template-id="${temp.id}" onclick="selectTemplate(${temp.id}, this)">
            <div class="template-image-container">
                <img src="/static/${temp.image}?v=8" alt="${temp.name}" class="template-img">
                <div class="template-overlay">
                    <span>Click to Select</span>
                </div>
            </div>
            <div class="template-info">
                <p>${temp.name}</p>
            </div>
        </div>
    `).join('');
}

// Handle template selection visuals
function selectTemplate(id, element) {
    selectedTemplate = templates.find(t => t.id === id);
    localStorage.setItem(LS_KEYS.selectedTemplate, String(id));
    
    // Remove 'selected' class from all cards
    document.querySelectorAll('.template-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Add 'selected' class to the clicked one
    element.classList.add('selected');
    console.log('Template Selected:', selectedTemplate.name);
}

// Close results or template selection
function closeResults(resultId) {
    const element = document.getElementById(resultId);
    if (element) {
        element.style.display = 'none';
    }
}

// Handle ATS Score Analysis
async function handleATSAnalysis() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resumeFile = getResumeFileForUpload();

    if (!isUserLoggedIn()) {
        redirectToLogin();
        return;
    }

    if (!resumeFile || !jdInput.value.trim()) {
        alert('Please provide both a resume and a job description');
        return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('loading', 'animate-shimmer');
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing...';
    analyzeBtn.querySelector('.btn-loader').style.display = 'inline-block';
    displayATSLoading();
    const atsProgressSection = document.getElementById('ats-progress-section');
    if (atsProgressSection) {
        atsProgressSection.style.display = 'block';
        atsProgressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const atsProgressController = startATSProgress();
    const progressStartTime = Date.now();

    // Ensure the browser paints the progress UI before network work begins.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const formData = new FormData();
    formData.append('file', resumeFile);
    const jdString = encodeURIComponent(jdInput.value.trim());

    try {
        const response = await fetch(`/get-ats-score?jd_string=${jdString}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            let detail = 'Analysis failed';
            try {
                const payload = await response.json();
                detail = payload?.detail || payload?.error || detail;
            } catch {}
            const error = new Error(detail);
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        const analysisPayload = transformATSDataForPage(data, jdInput.value.trim());
        sessionStorage.setItem('atsAnalysisPayload', JSON.stringify(analysisPayload));

        // Keep progress visible for a short minimum duration for clear UX feedback.
        const elapsed = Date.now() - progressStartTime;
        const minVisibleMs = 1600;
        if (elapsed < minVisibleMs) {
            await new Promise((resolve) => setTimeout(resolve, minVisibleMs - elapsed));
        }

        atsProgressController.complete();
        setTimeout(() => {
            window.location.href = '/ats-analysis';
        }, 380);

    } catch (error) {
        atsProgressController.stop();
        if (atsProgressSection) {
            atsProgressSection.style.display = 'none';
        }
        const message = (error.message || '').toLowerCase();
        if (error.status === 401 || error.status === 403 || message.includes('not logged in') || message.includes('login')) {
            redirectToLogin();
        } else {
            alert('Error analyzing resume: ' + error.message);
        }
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.classList.remove('loading', 'animate-shimmer');
        analyzeBtn.querySelector('.btn-text').textContent = 'Get ATS Score';
        analyzeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

const atsStepsData = [
    { step: 1, text: 'Uploading resume...', percent: 20 },
    { step: 2, text: 'Scanning keyword match...', percent: 45 },
    { step: 3, text: 'Checking ATS compatibility...', percent: 70 },
    { step: 4, text: 'Preparing score report...', percent: 92 }
];

function displayATSLoading() {
    const atsContent = document.getElementById('ats-progress-content');
    if (!atsContent) return;
    atsContent.innerHTML = `
        <div class="optimize-progress-container">
            <div class="optimize-floating-dots">
                <div class="optimize-dot"></div>
                <div class="optimize-dot"></div>
                <div class="optimize-dot"></div>
            </div>
            <div class="optimize-status-text" id="ats-status-text">Uploading resume...</div>
            <div class="optimize-steps">
                <div class="optimize-step active" data-ats-step="1">
                    <div class="optimize-step-icon">1</div>
                    <div class="optimize-step-label">Upload</div>
                </div>
                <div class="optimize-step" data-ats-step="2">
                    <div class="optimize-step-icon">2</div>
                    <div class="optimize-step-label">Keywords</div>
                </div>
                <div class="optimize-step" data-ats-step="3">
                    <div class="optimize-step-icon">3</div>
                    <div class="optimize-step-label">ATS Check</div>
                </div>
                <div class="optimize-step" data-ats-step="4">
                    <div class="optimize-step-icon">4</div>
                    <div class="optimize-step-label">Report</div>
                </div>
            </div>
            <div class="optimize-progress-bar">
                <div class="optimize-progress-fill" id="ats-progress-fill">
                    <div class="optimize-shimmer"></div>
                </div>
                <div class="optimize-percentage" id="ats-percentage">0%</div>
            </div>
        </div>
    `;
}

function updateATSProgress(percent) {
    const progressFill = document.getElementById('ats-progress-fill');
    const percentage = document.getElementById('ats-percentage');
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (percentage) percentage.textContent = `${percent}%`;
}

function updateATSStatus(text) {
    const statusText = document.getElementById('ats-status-text');
    if (statusText) statusText.textContent = text;
}

function updateATSStep(stepNumber) {
    const steps = document.querySelectorAll('[data-ats-step]');
    steps.forEach((stepEl) => {
        const current = Number(stepEl.getAttribute('data-ats-step'));
        stepEl.classList.remove('active', 'completed');
        if (current < stepNumber) {
            stepEl.classList.add('completed');
        } else if (current === stepNumber) {
            stepEl.classList.add('active');
        }
    });
}

function startATSProgress() {
    let timer = null;
    let percent = 0;
    let stepIndex = 0;

    const tick = () => {
        if (stepIndex < atsStepsData.length) {
            const step = atsStepsData[stepIndex];
            if (percent < step.percent) {
                percent += 1;
                updateATSProgress(percent);
            } else {
                updateATSStep(step.step);
                updateATSStatus(step.text);
                stepIndex += 1;
            }
        }
    };

    updateATSStep(1);
    updateATSStatus(atsStepsData[0].text);
    timer = setInterval(tick, 80);

    return {
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
        complete() {
            this.stop();
            updateATSStep(4);
            updateATSStatus('Analysis completed! Redirecting...');
            updateATSProgress(100);
        }
    };
}

function transformATSDataForPage(data, jdString) {
    const getArray = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
    const roleFromJD = inferRoleAndCompany(jdString);
    const keywordMatched = getArray(data?.keywords?.matched);
    const keywordMissing = getArray(data?.keywords?.missing);
    const hardMatched = getArray(data?.hard_skills?.matched);
    const hardMissing = getArray(data?.hard_skills?.missing);
    const softMatched = getArray(data?.soft_skills?.matched);
    const softMissing = getArray(data?.soft_skills?.missing);
    const expScore = Number(data?.experience?.relevance_score || 0);
    const searchScore = Number(data?.searchability?.score || 0);
    const summaryPresent = !!data?.searchability?.professional_summary?.is_present;

    const matchedKeywords = [...new Set([...keywordMatched, ...hardMatched, ...softMatched])];
    const missingKeywords = [...new Set([...keywordMissing, ...hardMissing, ...softMissing])];
    const bulletPoints = Number(data?.bullet_points || 0);
    const metricsUsed = Number(data?.metrics_used || 0);
    const wordCount = Number(data?.word_count || 0);
    const pages = Number(data?.pages || 1);

    const tips = getArray(data?.recruiter_tips).slice(0, 6).map((tip) => {
        const text = String(tip);
        let priority = 'medium';
        if (/missing|must|urgent|critical|improve/i.test(text)) priority = 'high';
        else if (/good|optional|consider/i.test(text)) priority = 'low';
        return {
            priority,
            text,
            reason: priority === 'high'
                ? 'High-impact gap for ATS ranking.'
                : priority === 'low'
                    ? 'Helpful polish after core gaps are fixed.'
                    : 'Improves ranking quality and readability.'
        };
    });

    return {
        score: Number(data?.match_rate || 0),
        jobTitle: data?.job_title_match?.job_title_in_jd || roleFromJD.jobTitle,
        company: roleFromJD.company,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        breakdown: [
            { category: 'Keyword match', score: percentageFromRatio(keywordMatched.length, keywordMatched.length + keywordMissing.length) },
            { category: 'Skills alignment', score: percentageFromRatio(hardMatched.length + softMatched.length, hardMatched.length + softMatched.length + hardMissing.length + softMissing.length) },
            { category: 'Experience fit', score: expScore },
            { category: 'Format & structure', score: searchScore },
            { category: 'Quantified impact', score: metricsUsed > 0 ? Math.min(100, metricsUsed * 10) : 0 },
            { category: 'Summary section', score: summaryPresent ? 100 : 'none' },
        ],
        matchedKeywords,
        missingKeywords,
        resumeStats: { wordCount, pages, bulletPoints, metricsUsed },
        tips: tips.length ? tips : [{
            priority: 'medium',
            text: 'Add measurable impact and role-specific keywords.',
            reason: 'No detailed recruiter tips were returned.'
        }],
    };
}

function percentageFromRatio(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
}

function inferRoleAndCompany(jdText) {
    const lines = String(jdText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 8);

    const titleLine = lines.find((line) => /engineer|developer|manager|analyst|scientist|designer/i.test(line));
    let company = 'Target Company';
    const companyLine = lines.find((line) => /company|at\s+[A-Z][\w&.-]+/i.test(line));
    if (companyLine) {
        const atMatch = companyLine.match(/at\s+([A-Za-z0-9&.\- ]+)/i);
        if (atMatch && atMatch[1]) {
            company = atMatch[1].trim();
        }
    }
    return {
        jobTitle: titleLine || 'Target Role',
        company,
    };
}

function displayOptimizeLoading() {
    const optimizeContent = document.getElementById('optimize-content');
    optimizeContent.innerHTML = `
        <div class="optimize-progress-container">
            <div class="optimize-floating-dots">
                <div class="optimize-dot"></div>
                <div class="optimize-dot"></div>
                <div class="optimize-dot"></div>
            </div>
            <div class="optimize-status-text" id="optimize-status-text">Upload your resume...</div>
            <div class="optimize-steps" id="optimize-steps">
                <div class="optimize-step active" data-step="1">
                    <div class="optimize-step-icon">1</div>
                    <div class="optimize-step-label">Upload</div>
                </div>
                <div class="optimize-step" data-step="2">
                    <div class="optimize-step-icon">2</div>
                    <div class="optimize-step-label">Analyzing</div>
                </div>
                <div class="optimize-step" data-step="3">
                    <div class="optimize-step-icon">3</div>
                    <div class="optimize-step-label">Optimizing</div>
                </div>
                <div class="optimize-step" data-step="4">
                    <div class="optimize-step-icon">4</div>
                    <div class="optimize-step-label">Completed</div>
                </div>
            </div>
            <div class="optimize-progress-bar">
                <div class="optimize-progress-fill" id="optimize-progress-fill">
                    <div class="optimize-shimmer"></div>
                </div>
                <div class="optimize-percentage" id="optimize-percentage">0%</div>
            </div>
        </div>
    `;
}

const optimizeStepsData = [
    { step: 1, text: 'Uploading resume...', percent: 15 },
    { step: 2, text: 'Parsing resume structure...', percent: 25 },
    { step: 3, text: 'Analyzing your experience...', percent: 35 },
    { step: 4, text: 'Extracting relevant keywords...', percent: 45 },
    { step: 5, text: 'Matching with job description...', percent: 60 },
    { step: 6, text: 'Optimizing bullet points...', percent: 75 },
    { step: 7, text: 'Enhancing ATS compatibility...', percent: 90 },
    { step: 8, text: 'Optimization completed! 🎉', percent: 100 }
];

function updateOptimizeProgress(percent) {
    const progressFill = document.getElementById('optimize-progress-fill');
    const percentage = document.getElementById('optimize-percentage');
    
    if (progressFill) progressFill.style.width = percent + '%';
    if (percentage) percentage.textContent = percent + '%';
}

function updateOptimizeStep(stepIndex) {
    const steps = document.querySelectorAll('.optimize-step');
    
    steps.forEach((step, index) => {
        step.classList.remove('active', 'completed');
        if (index < stepIndex) {
            step.classList.add('completed');
        } else if (index === stepIndex) {
            step.classList.add('active');
        }
    });
}

function updateOptimizeStatus(text) {
    const statusText = document.getElementById('optimize-status-text');
    if (statusText) statusText.textContent = text;
}

async function animateToOptimizeStep(stepData) {
    return new Promise(resolve => {
        updateOptimizeStep(stepData.step - 1);
        updateOptimizeStatus(stepData.text);
        
        const startPercent = parseInt(document.getElementById('optimize-percentage')?.textContent || '0');
        const targetPercent = stepData.percent;
        
const duration = 12000;
        const startTime = performance.now();
        
        function animate(time) {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            
            const currentPercent = startPercent + (targetPercent - startPercent) * easeProgress;
            updateOptimizeProgress(Math.round(currentPercent));
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                resolve();
            }
        }
        
        requestAnimationFrame(animate);
    });
}

function startOptimizeProgress() {
    return {
        async startDemo() {
            for (let i = 0; i < optimizeStepsData.length; i++) {
                await animateToOptimizeStep(optimizeStepsData[i]);
                if (i < optimizeStepsData.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }
        },
        stop() {
            // No interval to clear, just stop
        }
    };
}

function triggerPdfDownload(pdfUrl, filename) {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function redirectToLogin() {
    const nextUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
    window.location.href = `/login?next=${nextUrl}`;
}

async function downloadPdfFromEditorPayload() {
    const raw = sessionStorage.getItem(LS_KEYS.optimizedEditorPayload);
    if (!raw) {
        throw new Error('No optimized editor payload found');
    }
    const payload = JSON.parse(raw);
    if (!payload || !payload.html) {
        throw new Error('Optimized payload is missing HTML');
    }
    const response = await fetch("/api/download-html-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: payload.html, pdf_scale: 1 })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to generate PDF");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "optimized_resume.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

function isUserLoggedIn() {
    try {
        const user = JSON.parse(localStorage.getItem('tailorcv_user') || 'null');
        return !!(user && (user.email || user.name));
    } catch (error) {
        return false;
    }
}

// Handle Resume Optimization
async function handleResumeOptimization() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const confirmBtn = document.getElementById('confirm-optimize-btn');
    const optimizeResults = document.getElementById('optimize-results');
    const optimizeContent = document.getElementById('optimize-content');
    const templateSection = document.getElementById('template-selection-section');
    const resultsSection = document.getElementById('results-section');

    confirmBtn.disabled = true;
    confirmBtn.classList.add('loading', 'animate-shimmer');
    confirmBtn.textContent = 'Generating PDF...';

    templateSection.style.display = 'none';
    resultsSection.style.display = 'block';
    optimizeResults.style.display = 'block';
    displayOptimizeLoading();
    optimizeResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const progressController = startOptimizeProgress();
    // Start advanced step animation
    setTimeout(() => {
        progressController.startDemo().catch(console.error);
    }, 800);

    const resumeFile = getResumeFileForUpload();
    const formData = new FormData();
    formData.append('file', resumeFile);
    formData.append('jd_string', jdInput.value.trim());
    
    // Using ID 1 for style as default if not explicitly selected
    const templateId = selectedTemplate.id;
    const styleId = selectedStyle; 
    formData.append('template_id', templateId);
    formData.append('style_id', styleId);
    formData.append('editor_mode', 'true');

    try {
        const response = await fetch(`/get-optimised-resume`, {
            method: 'POST',
            headers: {
                'X-Editor-Mode': 'true'
            },
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(text || 'Optimization failed');
            error.status = response.status;
            throw error;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            const payload = await response.json();
            if (!payload || !payload.html) {
                throw new Error('Optimization completed but preview payload is missing');
            }
            sessionStorage.setItem(LS_KEYS.optimizedEditorPayload, JSON.stringify(payload));
            displayOptimizeResults(null, true);
            try {
                await downloadPdfFromEditorPayload();
            } catch (error) {
                console.warn('Auto-download failed after optimization:', error);
            }
            return;
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        displayOptimizeResults(url, false);
        triggerPdfDownload(url, 'optimized_resume.pdf');

    } catch (error) {
        progressController.stop();
        optimizeContent.innerHTML = '';
        optimizeResults.style.display = 'none';
        resultsSection.style.display = 'none';
        templateSection.style.display = 'block';
        const message = (error.message || '').toLowerCase();
        if (error.status === 401 || error.status === 403 || message.includes('not logged in') || message.includes('login')) {
            redirectToLogin();
        } else {
            alert(`Optimization failed: ${error.message}`);
        }
    } finally {
        confirmBtn.classList.remove('loading', 'animate-shimmer');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Generate PDF';
    }
}

function displayOptimizeResults(pdfUrl, hasEditorPayload = false) {
    const optimizeContent = document.getElementById('optimize-content');

    // Step 1: trigger auto-download immediately
    if (hasEditorPayload) {
        downloadPdfFromEditorPayload().catch(err => {
            console.warn('Auto-download failed:', err);
        });
    } else if (pdfUrl) {
        triggerPdfDownload(pdfUrl, 'optimized_resume.pdf');
    }
showOptimizedAlert(() => {
    let secs = 4;
    const countdownEl = document.getElementById('optdone-countdown');
    const timer = setInterval(() => {
        secs -= 1;
        if (countdownEl) {
            countdownEl.textContent = secs > 0
                ? `Opening editor in ${secs}s…`
                : 'Opening editor…';
        }
        if (secs <= 0) {
            clearInterval(timer);
            window.location.href = '/optimized-editor';
        }
    }, 1000);
});
    // Step 2: show animated success overlay
    optimizeContent.innerHTML = `
        <div class="optdone-overlay" id="optdone-overlay">
            <div class="optdone-ring">
                <svg viewBox="0 0 80 80" width="80" height="80">
                    <circle class="optdone-track" cx="40" cy="40" r="34" fill="none" stroke-width="5"/>
                    <circle class="optdone-circle" cx="40" cy="40" r="34" fill="none" stroke-width="5"
                        stroke-dasharray="213" stroke-dashoffset="213"/>
                    <polyline class="optdone-check" points="24,41 35,52 56,30"
                        fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <h2 class="optdone-title">Resume Optimized!</h2>
            <p class="optdone-line1">Your PDF is downloading now.</p>
            <p class="optdone-line2">
                You can adjust font size to fit everything on one page.<br>
                <span class="optdone-hint">No buttons needed — editor opens automatically.</span>
            </p>
            <div class="optdone-bar-wrap">
                <div class="optdone-bar" id="optdone-bar"></div>
            </div>
            <p class="optdone-countdown" id="optdone-countdown">Opening editor in 4s…</p>
        </div>
    `;

    // Step 3: inject styles
    if (!document.getElementById('optdone-styles')) {
        const style = document.createElement('style');
        style.id = 'optdone-styles';
        style.textContent = `
            .optdone-overlay {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 2.5rem 1.5rem 2rem;
                text-align: center;
                animation: optdone-fadein 0.5s ease both;
            }
            @keyframes optdone-fadein {
                from { opacity: 0; transform: translateY(18px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .optdone-ring {
                margin-bottom: 1.2rem;
            }
            .optdone-track {
                stroke: rgba(148,163,184,0.18);
            }
            .optdone-circle {
                stroke: #22c55e;
                stroke-linecap: round;
                transform-origin: center;
                transform: rotate(-90deg);
                animation: optdone-ring 0.7s 0.2s cubic-bezier(0.4,0,0.2,1) forwards;
            }
            @keyframes optdone-ring {
                to { stroke-dashoffset: 0; }
            }
            .optdone-check {
                stroke: #22c55e;
                stroke-dasharray: 50;
                stroke-dashoffset: 50;
                animation: optdone-tick 0.4s 0.85s ease forwards;
            }
            @keyframes optdone-tick {
                to { stroke-dashoffset: 0; }
            }
            .optdone-title {
                margin: 0 0 0.5rem;
                font-size: 1.6rem;
                font-weight: 700;
                color: #e2e8f0;
            }
            .optdone-line1 {
                margin: 0 0 0.4rem;
                font-size: 1.05rem;
                color: #86efac;
            }
            .optdone-line2 {
                margin: 0 0 1.6rem;
                font-size: 0.97rem;
                color: #94a3b8;
                line-height: 1.55;
            }
            .optdone-hint {
                display: inline-block;
                margin-top: 0.25rem;
                color: #60a5fa;
                font-size: 0.88rem;
            }
            .optdone-bar-wrap {
                width: min(340px, 90%);
                height: 5px;
                background: rgba(148,163,184,0.15);
                border-radius: 999px;
                overflow: hidden;
                margin-bottom: 0.7rem;
            }
            .optdone-bar {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #3b82f6, #22c55e);
                border-radius: 999px;
                animation: optdone-progress 4s 0.3s linear forwards;
            }
            @keyframes optdone-progress {
                to { width: 100%; }
            }
            .optdone-countdown {
                font-size: 0.88rem;
                color: #64748b;
                margin: 0;
            }
        `;
        document.head.appendChild(style);
    }

    // Step 4: live countdown then redirect
    let secs = 4;
    const countdownEl = document.getElementById('optdone-countdown');
    const timer = setInterval(() => {
        secs -= 1;
        if (countdownEl) {
            countdownEl.textContent = secs > 0
                ? `Opening editor in ${secs}s…`
                : 'Opening editor…';
        }
        if (secs <= 0) {
            clearInterval(timer);
            window.location.href = '/optimized-editor';
        }
    }, 1000);
}
function showOptimizedAlert(onClose) {
    const overlay = document.createElement('div');
    overlay.id = 'optdone-alert-overlay';
    overlay.innerHTML = `
        <div class="oalert-backdrop" id="oalert-backdrop"></div>
        <div class="oalert-modal" id="oalert-modal" role="dialog" aria-modal="true" aria-label="Resume Optimized">
            <div class="oalert-icon-wrap">
                <svg viewBox="0 0 80 80" width="72" height="72">
                    <circle class="oalert-track" cx="40" cy="40" r="34" fill="none" stroke-width="5"/>
                    <circle class="oalert-circle" cx="40" cy="40" r="34" fill="none" stroke-width="5"
                        stroke-dasharray="213" stroke-dashoffset="213"/>
                    <polyline class="oalert-check" points="24,41 35,52 56,30"
                        fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>

            <h2 class="oalert-title">Resume Optimized!</h2>

            <div class="oalert-rows">
                <div class="oalert-row" style="animation-delay:0.55s">
                    <span class="oalert-row-icon">📥</span>
                    <span class="oalert-row-text">Your PDF is <strong>downloading now</strong></span>
                </div>
                <div class="oalert-row" style="animation-delay:0.75s">
                    <span class="oalert-row-icon">✏️</span>
                    <span class="oalert-row-text">Use <strong>A+</strong> / <strong>A−</strong> in the editor to adjust font size and fit everything on one page</span>
                </div>
                <div class="oalert-row" style="animation-delay:0.95s">
                    <span class="oalert-row-icon">➡️</span>
                    <span class="oalert-row-text">Editor opens automatically — <strong>no buttons needed</strong></span>
                </div>
            </div>

            <button class="oalert-btn" id="oalert-btn" type="button">
                Got it, open editor
            </button>
        </div>
    `;

    // Inject styles once
    if (!document.getElementById('oalert-styles')) {
        const style = document.createElement('style');
        style.id = 'oalert-styles';
        style.textContent = `
            #optdone-alert-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .oalert-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(2, 8, 24, 0.72);
                backdrop-filter: blur(6px);
                animation: oalert-bgin 0.35s ease both;
            }
            @keyframes oalert-bgin {
                from { opacity: 0; }
                to   { opacity: 1; }
            }
            .oalert-modal {
                position: relative;
                z-index: 2;
                background: linear-gradient(160deg, #0d1f3c 0%, #0a1628 100%);
                border: 1px solid rgba(59, 130, 246, 0.35);
                border-radius: 20px;
                padding: 2.2rem 2rem 1.8rem;
                width: min(440px, 92vw);
                box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                animation: oalert-modal-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
            }
            @keyframes oalert-modal-in {
                from { opacity: 0; transform: scale(0.82) translateY(24px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            .oalert-icon-wrap {
                margin-bottom: 1.1rem;
            }
            .oalert-track {
                stroke: rgba(148,163,184,0.15);
            }
            .oalert-circle {
                stroke: #22c55e;
                stroke-linecap: round;
                transform-origin: center;
                transform: rotate(-90deg);
                animation: oalert-ring 0.8s 0.25s cubic-bezier(0.4,0,0.2,1) forwards;
            }
            @keyframes oalert-ring {
                to { stroke-dashoffset: 0; }
            }
            .oalert-check {
                stroke: #22c55e;
                stroke-dasharray: 50;
                stroke-dashoffset: 50;
                animation: oalert-tick 0.38s 1s ease forwards;
            }
            @keyframes oalert-tick {
                to { stroke-dashoffset: 0; }
            }
            .oalert-title {
                margin: 0 0 1.2rem;
                font-size: 1.55rem;
                font-weight: 700;
                color: #e2e8f0;
                letter-spacing: -0.01em;
            }
            .oalert-rows {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
                width: 100%;
                margin-bottom: 1.6rem;
            }
            .oalert-row {
                display: flex;
                align-items: flex-start;
                gap: 0.75rem;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 12px;
                padding: 0.75rem 0.9rem;
                text-align: left;
                opacity: 0;
                transform: translateX(-14px);
                animation: oalert-row-in 0.4s ease forwards;
            }
            @keyframes oalert-row-in {
                to { opacity: 1; transform: translateX(0); }
            }
            .oalert-row-icon {
                font-size: 1.2rem;
                flex-shrink: 0;
                margin-top: 1px;
            }
            .oalert-row-text {
                font-size: 0.95rem;
                color: #94a3b8;
                line-height: 1.5;
            }
            .oalert-row-text strong {
                color: #e2e8f0;
                font-weight: 600;
            }
            .oalert-btn {
                width: 100%;
                padding: 0.85rem 1.2rem;
                border-radius: 12px;
                border: none;
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
                color: #fff;
                font-size: 1rem;
                font-weight: 700;
                cursor: pointer;
                letter-spacing: 0.01em;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
                box-shadow: 0 4px 20px rgba(37,99,235,0.45);
                animation: oalert-btn-in 0.4s 1.1s ease both;
            }
            @keyframes oalert-btn-in {
                from { opacity: 0; transform: translateY(10px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .oalert-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 28px rgba(37,99,235,0.55);
            }
            .oalert-btn:active {
                transform: scale(0.97);
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(overlay);

    // Close on button click OR backdrop click
    const close = () => {
        const modal = document.getElementById('oalert-modal');
        const backdrop = document.getElementById('oalert-backdrop');
        if (modal) modal.style.animation = 'oalert-modal-out 0.25s ease forwards';
        if (backdrop) backdrop.style.animation = 'oalert-bgin 0.25s ease reverse forwards';

        // Add exit keyframe once
        if (!document.getElementById('oalert-exit-style')) {
            const s = document.createElement('style');
            s.id = 'oalert-exit-style';
            s.textContent = `
                @keyframes oalert-modal-out {
                    to { opacity: 0; transform: scale(0.9) translateY(16px); }
                }
            `;
            document.head.appendChild(s);
        }

        setTimeout(() => {
            overlay.remove();
            if (onClose) onClose();
        }, 260);
    };

    document.getElementById('oalert-btn').addEventListener('click', close);
    document.getElementById('oalert-backdrop').addEventListener('click', close);
}