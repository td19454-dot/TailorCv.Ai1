// Global state
let selectedTemplate = null;
let selectedStyle = 1; // Default to style 1 (Modern)

// Template and Style Options
const templates = [
    { id: 1, name: 'Modern Professional', image: 'temp1.jpg' },
    { id: 2, name: 'Executive Minimal', image: 'temp1.jpg' },
    { id: 3, name: 'Creative Tech', image: 'temp3.jpg' },
    { id: 4, name: 'Classic Academic', image: 'temp1.jpg' },
    { id: 5, name: 'Modern Elegant', image: 'temp1.jpg' }
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
                <img src="${temp.image}" alt="${temp.name}" class="template-img">
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

// Handle Resume Optimization
async function handleResumeOptimization() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const confirmBtn = document.getElementById('confirm-optimize-btn');
    const optimizeResults = document.getElementById('optimize-results');
    const templateSection = document.getElementById('template-selection-section');
    const resultsSection = document.getElementById('results-section');

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Generating PDF...';

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
        
        displayOptimizeResults(url);
        
        templateSection.style.display = 'none';
        resultsSection.style.display = 'block';
        optimizeResults.style.display = 'block';
        optimizeResults.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
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
            <a href="${pdfUrl}" download="optimized_resume.pdf" class="download-btn">Download Optimized Resume</a>
        </div>
    `;
}
