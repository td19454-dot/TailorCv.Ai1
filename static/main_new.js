document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('resume-file');
    const fileName = document.getElementById('file-name');
    const optimizeBtn = document.getElementById('optimize-btn');
    const analyzeBtn = document.getElementById('analyze-btn');

    if (fileInput && fileName) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                fileName.textContent = e.target.files[0].name;
            } else {
                fileName.textContent = 'No file chosen';
            }
        });
    }

    if (optimizeBtn) {
        optimizeBtn.addEventListener('click', handleResumeOptimization);
    }

    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', handleATSAnalysis);
    }
});

function closeResults(resultId) {
    const element = document.getElementById(resultId);
    if (element) {
        element.style.display = 'none';
    }
}

async function handleATSAnalysis() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resultsSection = document.getElementById('results-section');
    const atsResults = document.getElementById('ats-results');

    if (!fileInput.files[0]) {
        alert('Please upload a resume file');
        return;
    }

    if (!jdInput.value.trim()) {
        alert('Please paste the job description');
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

        if (!response.ok) {
            let errorMessage = 'ATS analysis failed';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorMessage;
            } catch (_) {
                const errorText = await response.text();
                if (errorText) {
                    errorMessage = errorText;
                }
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        displayATSResults(data);
        resultsSection.style.display = 'block';
        atsResults.style.display = 'block';
        atsResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        alert(`ATS analysis failed: ${error.message}`);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.querySelector('.btn-text').textContent = 'Get ATS Score';
        analyzeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

function displayATSResults(data) {
    const atsContent = document.getElementById('ats-content');
    const scoreColor = data.match_rate >= 80 ? '#10b981' : (data.match_rate >= 60 ? '#f59e0b' : '#ef4444');

    atsContent.innerHTML = `
        <div class="ats-score-display">
            <div class="score-circle" style="background: ${scoreColor};">${data.match_rate || 0}%</div>
            <div class="match-level">Match Level: ${data.match_level || 'Not rated'}</div>
        </div>
        ${data.recruiter_tips ? `
            <div class="recruiter-tips">
                <div class="recruiter-tips-title">Recruiter Tips</div>
                <ul>${data.recruiter_tips.map(tip => `<li>${tip}</li>`).join('')}</ul>
            </div>
        ` : ''}
    `;
}

async function handleResumeOptimization() {
    const fileInput = document.getElementById('resume-file');
    const jdInput = document.getElementById('job-description');
    const optimizeBtn = document.getElementById('optimize-btn');
    const resultsSection = document.getElementById('results-section');
    const optimizeResults = document.getElementById('optimize-results');

    if (!fileInput.files[0]) {
        alert('Please upload a resume file');
        return;
    }

    if (!jdInput.value.trim()) {
        alert('Please paste the job description');
        return;
    }

    optimizeBtn.disabled = true;
    optimizeBtn.querySelector('.btn-text').textContent = 'Optimizing...';
    optimizeBtn.querySelector('.btn-loader').style.display = 'inline-block';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    const jdString = encodeURIComponent(jdInput.value.trim());

    try {
        const response = await fetch(`/get-optimised-resume?jd_string=${jdString}`, {
            method: 'POST',
            headers: {
                'X-Return-Meta': 'true'
            },
            body: formData
        });

        if (!response.ok) {
            let errorMessage = 'Optimization failed';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorMessage;
            } catch (_) {
                const errorText = await response.text();
                if (errorText) {
                    errorMessage = errorText;
                }
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        displayOptimizeResults(data);
        resultsSection.style.display = 'block';
        optimizeResults.style.display = 'block';
        optimizeResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        alert(`Optimization failed: ${error.message}`);
    } finally {
        optimizeBtn.disabled = false;
        optimizeBtn.querySelector('.btn-text').textContent = 'Optimize Resume';
        optimizeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

function getScoreColor(score) {
    return score >= 80 ? '#10b981' : (score >= 60 ? '#f59e0b' : '#ef4444');
}

function renderScoreCard(title, data) {
    const score = data?.match_rate || 0;
    const tips = Array.isArray(data?.recruiter_tips) ? data.recruiter_tips : [];
    return `
        <div class="ats-score-card" style="flex: 1; min-width: 220px; padding: 16px; border-radius: 16px; background: linear-gradient(145deg, #0c3f88 0%, #112b7a 52%, #31105a 100%); border: 1px solid rgba(219, 234, 254, 0.22); color: #ffffff; box-shadow: 0 18px 40px rgba(10, 30, 84, 0.34);">
            <div class="ats-score-card-title" style="font-weight: 700; margin-bottom: 12px; color: #ffffff;">${title}</div>
            <div class="ats-score-card-header" style="display: flex; align-items: center; gap: 14px; margin-bottom: 10px;">
                <div class="score-circle" style="background: ${getScoreColor(score)}; width: 72px; height: 72px; font-size: 1rem;">${score}%</div>
                <div class="ats-score-card-level" style="font-weight: 600; color: #eef4ff;">${data?.match_level || 'Not rated'}</div>
            </div>
            ${tips.length ? `
                <div class="recruiter-tips" style="background: rgba(255, 255, 255, 0.08); border-left: 4px solid #b8d7ff; color: #ffffff;">
                    <div class="recruiter-tips-title" style="color: #ffffff;">Top Tips</div>
                    <ul>${tips.slice(0, 3).map(tip => `<li>${tip}</li>`).join('')}</ul>
                </div>
            ` : ''}
        </div>
    `;
}

function displayOptimizeResults(result) {
    const optimizeContent = document.getElementById('optimize-content');
    const originalScore = result?.original_ats?.match_rate || 0;
    const optimizedScore = result?.optimized_ats?.match_rate || 0;
    const delta = optimizedScore - originalScore;
    const deltaPrefix = delta > 0 ? '+' : '';
    const downloadUrl = result?.download_url || '#';
    optimizeContent.innerHTML = `
        <div class="optimize-success">
            <div class="optimize-success-icon">OK</div>
            <div class="optimize-success-title">Resume Optimized Successfully!</div>
            <div class="optimize-success-message">
                Your resume has been tailored to match the job description.
                ATS was scored on both the original resume and the optimized content.
            </div>
            <div class="score-change-banner" style="margin: 18px 0; padding: 14px 18px; border-radius: 14px; background: linear-gradient(135deg, #0f4ea3 0%, #183a9e 45%, #3c1361 100%); color: #ffffff; font-weight: 700; box-shadow: 0 14px 34px rgba(15, 78, 163, 0.28);">
                Score Change: ${deltaPrefix}${delta} points
            </div>
            <div class="comparison-grid" style="display: flex; gap: 16px; flex-wrap: wrap; margin: 18px 0 22px;">
                ${renderScoreCard('Original Resume ATS', result.original_ats)}
                ${renderScoreCard('Optimized Resume ATS', result.optimized_ats)}
            </div>
            <a href="${downloadUrl}" download="optimized_resume.pdf" class="download-btn">Download Optimized Resume</a>
        </div>
    `;
}
