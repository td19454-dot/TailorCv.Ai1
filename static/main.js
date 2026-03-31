
// File upload handling
document.addEventListener('DOMContentLoaded', function() {
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

    // Optimize button handler
    const optimizeBtn = document.getElementById('optimize-btn');
    if (optimizeBtn) {
        optimizeBtn.addEventListener('click', handleResumeOptimization);
    }
});

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

// Display ATS Results
function displayATSResults(data) {
    const atsContent = document.getElementById('ats-content');
    
    // Determine score color
    let scoreColor = '#ef4444'; // red
    if (data.match_rate >= 80) scoreColor = '#10b981'; // green
    else if (data.match_rate >= 60) scoreColor = '#f59e0b'; // yellow
    else if (data.match_rate >= 40) scoreColor = '#f97316'; // orange

    const html = `
        <div class="ats-score-display">
            <div class="score-circle" style="background: ${scoreColor};">
                ${data.match_rate}%
            </div>
            <div class="match-level">Match Level: ${data.match_level}</div>
        </div>

        <div class="score-section">
            <div class="score-section-title">Hard Skills</div>
            ${data.hard_skills.matched.length > 0 ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.hard_skills.matched.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
            ${data.hard_skills.missing.length > 0 ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.hard_skills.missing.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Soft Skills</div>
            ${data.soft_skills.matched.length > 0 ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.soft_skills.matched.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
            ${data.soft_skills.missing.length > 0 ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.soft_skills.missing.map(skill => `<span class="item-tag">${skill}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Keywords</div>
            ${data.keywords.matched.length > 0 ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.keywords.matched.map(keyword => `<span class="item-tag">${keyword}</span>`).join('')}
                </div>
            ` : ''}
            ${data.keywords.missing.length > 0 ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.keywords.missing.map(keyword => `<span class="item-tag">${keyword}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Tools & Technologies</div>
            ${data.tools_and_technologies.matched.length > 0 ? `
                <div class="matched-items">
                    <strong>Matched:</strong>
                    ${data.tools_and_technologies.matched.map(tool => `<span class="item-tag">${tool}</span>`).join('')}
                </div>
            ` : ''}
            ${data.tools_and_technologies.missing.length > 0 ? `
                <div class="missing-items">
                    <strong>Missing:</strong>
                    ${data.tools_and_technologies.missing.map(tool => `<span class="item-tag">${tool}</span>`).join('')}
                </div>
            ` : ''}
        </div>

        <div class="score-section">
            <div class="score-section-title">Experience Match</div>
            <p><strong>Job Requirement:</strong> ${data.experience.job_requirement || 'Not specified'}</p>
            <p><strong>Your Experience:</strong> ${data.experience.resume_experience || 'Not specified'}</p>
            <p><strong>Match Status:</strong> <span style="color: ${data.experience.match_status === 'Strong' ? '#10b981' : data.experience.match_status === 'Partial' ? '#f59e0b' : '#ef4444'}">${data.experience.match_status}</span></p>
        </div>

        <div class="score-section">
            <div class="score-section-title">Job Title Match</div>
            <p><strong>Job Title:</strong> ${data.job_title_match.job_title_in_jd || 'Not specified'}</p>
            <p><strong>Your Titles:</strong> ${data.job_title_match.resume_titles.join(', ') || 'Not specified'}</p>
            <p><strong>Match Status:</strong> <span style="color: ${data.job_title_match.match_status === 'Strong' ? '#10b981' : data.job_title_match.match_status === 'Partial' ? '#f59e0b' : '#ef4444'}">${data.job_title_match.match_status}</span></p>
        </div>

        <div class="score-section">
            <div class="score-section-title">Searchability Score</div>
            <p><strong>Score:</strong> ${data.searchability.score}%</p>
            ${data.searchability.issues && data.searchability.issues.length > 0 ? `
                <div style="margin-top: 1rem;">
                    <strong>Issues:</strong>
                    <ul style="margin-top: 0.5rem; padding-left: 1.5rem;">
                        ${data.searchability.issues.map(issue => `<li>${issue}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>

        ${data.recruiter_tips && data.recruiter_tips.length > 0 ? `
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

    // Show loading state
    optimizeBtn.disabled = true;
    optimizeBtn.querySelector('.btn-text').textContent = 'Optimizing...';
    optimizeBtn.querySelector('.btn-loader').style.display = 'inline-block';

    // Prepare form data
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const jdString = encodeURIComponent(jdInput.value.trim());

    try {
        const response = await fetch(`/get-optimised-resume?jd_string=${jdString}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Failed to optimize resume');
        }

        // Get the PDF blob
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        // Display success message with download link
        displayOptimizeResults(url);
        resultsSection.style.display = 'block';
        optimizeResults.style.display = 'block';
        
        // Scroll to results
        optimizeResults.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('Error:', error);
        alert('Error optimizing resume: ' + error.message);
    } finally {
        // Reset button state
        optimizeBtn.disabled = false;
        optimizeBtn.querySelector('.btn-text').textContent = 'Optimize Resume';
        optimizeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

// Display Optimize Results
function displayOptimizeResults(pdfUrl) {
    const optimizeContent = document.getElementById('optimize-content');
    
    const html = `
        <div class="optimize-success">
            <div class="optimize-success-icon">✅</div>
            <div class="optimize-success-title">Resume Optimized Successfully!</div>
            <div class="optimize-success-message">
                Your resume has been tailored to match the job description. 
                Click the button below to download your optimized resume.
            </div>
            <a href="${pdfUrl}" download="optimized_resume.pdf" class="download-btn">
                📥 Download Optimized Resume
            </a>
        </div>
    `;

    optimizeContent.innerHTML = html;
}

// Close results
function closeResults(resultId) {
    const resultElement = document.getElementById(resultId);
    if (resultElement) {
        resultElement.style.display = 'none';
    }
}
