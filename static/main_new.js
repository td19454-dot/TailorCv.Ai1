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
    { id: 12, name: 'Skyline Blue', image: 'pic12.jpg' }
];

const styles = [
    { id: 1, name: 'Modern', color: '#6366f1' },
    { id: 2, name: 'Professional', color: '#2563eb' },
    { id: 3, name: 'Clean', color: '#059669' }
];

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // File upload handler
    const fileInput = document.getElementById('resume-file');
    const fileName = document.getElementById('file-name');
    
    if (fileInput && fileName) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                fileName.textContent = e.target.files[0].name;
            } else {
                fileName.textContent = 'No file chosen';
            }
        });
    }

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
            
            if (!fileInput.files[0]) {
                alert('Please upload a resume file');
                return;
            }
            
            if (!jdInput.value.trim()) {
                alert('Please paste the job description');
                return;
            }
            
            // Show template selection
            const templateSection = document.getElementById('template-selection-section');
            if (templateSection) {
                templateSection.style.display = 'block';
                generateTemplateGrid();
                templateSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
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
        <div class="template-card" onclick="selectTemplate(${temp.id}, this)">
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
    const resultsSection = document.getElementById('results-section');
    const atsResults = document.getElementById('ats-results');

    if (!fileInput.files[0] || !jdInput.value.trim()) {
        alert('Please provide both a resume and a job description');
        return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing...';
    analyzeBtn.querySelector('.btn-loader').style.display = 'inline-block';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const jdString = encodeURIComponent(jdInput.value.trim());

    try {
        const response = await fetch(`/get-ats-score?jd_string=${jdString}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Analysis failed');

        const data = await response.json();
        displayATSResults(data);
        resultsSection.style.display = 'block';
        atsResults.style.display = 'block';
        atsResults.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        alert('Error analyzing resume: ' + error.message);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.querySelector('.btn-text').textContent = 'Get ATS Score';
        analyzeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

function displayATSResults(data) {
    const atsContent = document.getElementById('ats-content');
    let scoreColor = data.match_rate >= 80 ? '#10b981' : (data.match_rate >= 60 ? '#f59e0b' : '#ef4444');

    atsContent.innerHTML = `
        <div class="ats-score-display">
            <div class="score-circle" style="background: ${scoreColor};">
                ${data.match_rate || 0}%
            </div>
            <div class="match-level">Match Level: ${data.match_level || 'Not rated'}</div>
        </div>
        ${data.recruiter_tips ? `
            <div class="recruiter-tips">
                <div class="recruiter-tips-title">💡 Recruiter Tips</div>
                <ul>${data.recruiter_tips.map(tip => `<li>${tip}</li>`).join('')}</ul>
            </div>
        ` : ''}
    `;
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
    { step: 1, text: 'Uploading resume...', percent: 25 },
    { step: 2, text: 'Analyzing your experience...', percent: 50 },
    { step: 3, text: 'Optimizing for ATS systems...', percent: 75 },
    { step: 4, text: 'Optimization completed! 🎉', percent: 99 }
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
        
const duration = 5000;
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

function showLoginRequiredModal() {
    // Create once and reuse
    let overlay = document.getElementById('login-required-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'login-required-overlay';
        overlay.className = 'login-modal-overlay';
        overlay.innerHTML = `
            <div class="login-modal" role="dialog" aria-modal="true">
                <h3>Login Required</h3>
                <p>You need to log in before optimizing your resume. Please sign in to continue.</p>
                <div class="login-modal-actions">
                    <a class="btn-link btn-primary-link" href="/login">Go to Login</a>
                    <button type="button" class="btn-link btn-secondary-link" id="login-modal-close">Maybe Later</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector('#login-modal-close');
        closeBtn?.addEventListener('click', () => {
            overlay.remove();
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });
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

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('jd_string', jdInput.value.trim());
    
    // Using ID 1 for style as default if not explicitly selected
    const templateId = selectedTemplate.id;
    const styleId = selectedStyle; 
    formData.append('template_id', templateId);
    formData.append('style_id', styleId);

    try {
        const response = await fetch(`/get-optimised-resume`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            const error = new Error(text || 'Optimization failed');
            error.status = response.status;
            throw error;
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        // progressController.complete(); // Not needed for async demo
        displayOptimizeResults(url);
        triggerPdfDownload(url, 'optimized_resume.pdf');

    } catch (error) {
        progressController.stop();
        optimizeContent.innerHTML = '';
        optimizeResults.style.display = 'none';
        resultsSection.style.display = 'none';
        templateSection.style.display = 'block';
        const message = (error.message || '').toLowerCase();
        if (error.status === 401 || error.status === 403 || message.includes('not logged in') || message.includes('login')) {
            showLoginRequiredModal();
        } else {
            alert(`Optimization failed: ${error.message}`);
        }
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Generate PDF';
    }
}

function displayOptimizeResults(pdfUrl) {
    const optimizeContent = document.getElementById('optimize-content');
    optimizeContent.innerHTML = `
        <div class="optimize-success">
            <div class="optimize-success-icon">✅</div>
            <div class="optimize-success-title">Resume Optimized!</div>
            <div class="optimize-success-message">Your tailored resume is ready.</div>
            <div class="optimize-success-actions">
                <a href="${pdfUrl}" download="optimized_resume.pdf" class="download-btn">Download Optimized Resume</a>
            </div>
        </div>
    `;
}
