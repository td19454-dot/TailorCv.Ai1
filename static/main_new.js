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
    { id: 10, name: 'Slate Sidebar', image: 'template10.svg' },
    { id: 11, name: 'Forest Sidebar', image: 'template11.svg' },
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
        <div class="optimize-loading">
            <div class="optimize-loading-title">Optimizing your resume...</div>
            <div class="optimize-loading-message">
                Please wait while we tailor your resume to the selected job description.
            </div>
            <div class="progress-meta">
                <span class="progress-label">Processing</span>
                <span class="progress-value" id="progress-value">0%</span>
            </div>
            <div class="progress-shell">
                <div class="progress-bar" id="progress-bar"></div>
            </div>
        </div>
    `;
}

function startOptimizeProgress() {
    const progressBar = document.getElementById('progress-bar');
    const progressValue = document.getElementById('progress-value');
    let progress = 0;

    const intervalId = window.setInterval(() => {
        if (progress >= 99) {
            window.clearInterval(intervalId);
            return;
        }

        if (progress < 35) {
            progress += 4;
        } else if (progress < 65) {
            progress += 3;
        } else if (progress < 82) {
            progress += 2;
        } else if (progress < 92) {
            progress += 1;
        } else {
            progress += 0.5;
        }

        progress = Math.min(progress, 99);
        const roundedProgress = Math.floor(progress);

        if (progressBar) {
            progressBar.style.width = `${roundedProgress}%`;
        }

        if (progressValue) {
            progressValue.textContent = `${roundedProgress}%`;
        }
    }, 300);

    return {
        complete() {
            window.clearInterval(intervalId);
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            if (progressValue) {
                progressValue.textContent = '100%';
            }
        },
        stop() {
            window.clearInterval(intervalId);
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

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const jdString = encodeURIComponent(jdInput.value.trim());
    
    // Using ID 1 for style as default if not explicitly selected
    const templateId = selectedTemplate.id;
    const styleId = selectedStyle; 

    try {
        const response = await fetch(`/get-optimised-resume?jd_string=${jdString}&template_id=${templateId}&style_id=${styleId}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Optimization failed');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        progressController.complete();
        displayOptimizeResults(url);
        triggerPdfDownload(url, 'optimized_resume.pdf');

    } catch (error) {
        progressController.stop();
        optimizeContent.innerHTML = '';
        optimizeResults.style.display = 'none';
        resultsSection.style.display = 'none';
        templateSection.style.display = 'block';
        alert(`Optimization failed: ${error.message}`);
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
