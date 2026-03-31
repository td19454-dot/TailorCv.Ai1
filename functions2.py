from openai import OpenAI
from markdown import markdown
from weasyprint import HTML
from dotenv import load_dotenv
import pdfplumber
load_dotenv()

def create_prompt(resume_string,jd_string):
    """Creates a detailed prompt for AI-powered resume optimization based on a job description.

    This function generates a structured prompt that guides the AI to:
    - Tailor the resume to match job requirements
    - Optimize for ATS systems
    - Provide actionable improvement suggestions
    - Format the output in clean Markdown

    Args:
        resume_string (str): The input resume text
        jd_string (str): The target job description text

    Returns:
        str: A formatted prompt string containing instructions for resume optimization"""
    
    return f"""
Your objective is to generate a professional, 1-page, compelling resume tailored to the provided job description, maximizing interview chances by integrating best practices in content quality, keyword optimization, measurable achievements, and proper formatting.



If a tool, framework or skill doesn't match the ones mentioned in the Job description but a similar skill is mentioned, replace the tool/skill/framework with that keyword to match the JD. For example, if Tableau is mentioned but the requirement asks for PowerBI, replace it with PowerBI. Be ethical, don't replace if it is not logical.



Guidelines to Follow:



Keyword and Skill Optimization:

Analyze the job description and identify relevant keywords (hard and soft skills).

Match at least 80% of the job description’s keywords to align with applicant tracking systems (ATS).

Prioritize industry-relevant hard skills and soft skills in dedicated sections and throughout bullet points.

Incorporate Measurable Metrics:



Quantify achievements using the XYZ formula: Accomplished X, measured by Y, by doing Z.

Include at least five measurable results that clearly demonstrate impact.

Avoid vague statements; use metrics to highlight value and effectiveness.



Resume Length and Structure:

Keep the resume between 400-500 words for optimal readability and engagement.

Maintain a clean, organized structure with clear headings and bullet points.

Exceptions for roles requiring longer resumes (e.g., academia, federal jobs, C-suite) should be appropriately handled.

Content Quality and Language:



Eliminate buzzwords, clichés, and pronouns (e.g., “I,” “me,” “my”).

Use action-oriented, impactful language to emphasize accomplishments over duties.

Replace generic phrases with specific examples that showcase expertise and success.

Focus on selling professional experience, skills, and results, not merely summarizing past roles.

Additional Instructions:



Customize each section (Professional Summary, Experience, Skills, Education) to reflect relevance to the job.

Ensure consistent formatting, professional fonts, and appropriate use of whitespace.

Use concise bullet points, each starting with a strong action verb.

My Resume:
{resume_string}
Job Description:
{jd_string}


Generate the resume in markdown format to be further written to a PDF file. Return only the resume content and nothing else.Return raw Markdown only.
Do NOT wrap the output in ``` or ```markdown.

"""
def get_resume_response(prompt,model="gpt-4o-mini",temperature: float = 0.2):
    """
    Sends a resume optimization prompt to OpenAI's API and returns the optimized resume response.

    This function:
    - Initializes the OpenAI client
    - Makes an API call with the provided prompt
    - Returns the generated response

    Args:
        prompt (str): The formatted prompt containing resume and job description
        api_key (str): OpenAI API key for authentication
        model (str, optional): The OpenAI model to use. Defaults to "gpt-4-turbo-preview"
        temperature (float, optional): Controls randomness in the response. Defaults to 0.7

    Returns:
        str: The AI-generated optimized resume and suggestions

    Raises:
        OpenAIError: If there's an issue with the API call
    """
    #Setting up openAI client
    client=OpenAI()

    #Make call
    response=client.chat.completions.create(model=model,
                                            messages=[
                                                {'role':'system',"content":'Expert resume writer and reviewer'},
                                                {'role':'user','content':prompt}
                                            ],temperature=temperature)
    return response.choices[0].message.content

def ats_scoring(resume_string, jd_string):
    """Gives ats score for the resume highlignting strengths and weaknesses"""
    prompt=f"""You are a professional Applicant Tracking System (ATS) resume scanner similar to Jobscan.
    Your task is to analyze a resume against a job description and generate a Jobscan-style Match Report.
    Output ONLY valid JSON. Do NOT wrap the JSON in quotes
    INPUTS 
    Resume:
    {resume_string}
    Job Description:
    {jd_string}
  

    ANALYSIS INSTRUCTIONS
    Evaluate the resume using ATS logic based on:
    - Hard skills match
    - Soft skills match
    - Keyword alignment
    - Job title and role relevance
    - Tools, technologies, and frameworks
    - Experience relevance
    - Resume searchability (ATS readability)

    Be strict, realistic, and recruiter-focused.
    Do NOT assume or hallucinate skills or experience not explicitly stated.

    ### SCORING
    - Compute a Match Rate between 0 and 100
    - Weighting:
    - Hard skills & keywords: 45%
    - Experience & role alignment: 30%
    - Tools & technologies: 15%
    - Searchability & formatting: 10%

    ### OUTPUT RULES (MANDATORY)
    - Output **ONLY valid JSON**
    - No explanations, no markdown, no extra text
    - JSON must strictly follow the schema below

    ### REQUIRED JOBSCAN-STYLE JSON FORMAT
    {{
    "match_rate": <integer 0-100>,
    "match_level": "<Poor | Fair | Good | Strong | Excellent>",
    "hard_skills": {{
        "matched": ["<skill1>", "<skill2>"],
        "missing": ["<skill1>", "<skill2>"]
    }},
    "soft_skills": {{
        "matched": ["<skill1>", "<skill2>"],
        "missing": ["<skill1>", "<skill2>"]
    }},
    "keywords": {{
        "matched": ["<keyword1>", "<keyword2>"],
        "missing": ["<keyword1>", "<keyword2>"]
    }},
    "tools_and_technologies": {{
        "matched": ["<tool1>", "<tool2>"],
        "missing": ["<tool1>", "<tool2>"]
    }},
    "experience": {{
        "job_requirement": "<years or description from JD>",
        "resume_experience": "<estimated from resume>",
        "match_status": "<Low | Partial | Strong>"
    }},
    "job_title_match": {{
        "job_title_in_jd": "<title>",
        "resume_titles": ["<title1>", "<title2>"],
        "match_status": "<Low | Partial | Strong>"
    }},
    "searchability": {{
        "score": <integer 0-100>,
        "issues": [
        "<missing section headers>",
        "<poor keyword placement>",
        "<non-ATS-friendly formatting assumptions>"
        ]
    }},
    "recruiter_tips": [
        "<actionable improvement 1>",
        "<actionable improvement 2>",
        "<actionable improvement 3>"
    ]
    }}

    """
    model="gpt-4o-mini"
    temperature=0.7
    client=OpenAI()

    #Make call
    response=client.chat.completions.create(model=model,
                                            messages=[
                                                {'role':'system',"content":'Applicant Tracking System (ATS) resume scanner similar to Jobscan'},
                                                {'role':'user','content':prompt}
                                            ],temperature=temperature)
    return response.choices[0].message.content

def process_resume(resume_name,jd_string):
    """
    Process a resume file against a job description to create an optimized version.

    Args:
        resume (file): A file object containing the resume in markdown format
        jd_string (str): The job description text to optimize the resume against

    Returns:
        tuple: A tuple containing three elements:
            - str: The optimized resume in markdown format (for display)
            - str: The same optimized resume (for editing)
            
    """
     
    def extract_pdf_text(path):
        text = ""
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text += page.extract_text() + "\n"
        return text
    resume_string=extract_pdf_text(f"uploads/{resume_name}")

    # create prompt
    prompt = create_prompt(resume_string, jd_string)

    # Generate response
    try:
        response_string = get_resume_response(prompt)
    except Exception as e:
        return f"Failed to generate resume from the AI: {e}", ""

    # Return two outputs to match Gradio: Markdown display and editable text
    new_resume = response_string
    return new_resume
    # try:
    #     output_pdf_file = "resumes/optimized_resume.pdf"

    #     # convert markdown to HTML
    #     html_content = markdown(new_resume)

    #     # Convert HTML to PDF and save (use existing styles filename)
    #     HTML(string=html_content).write_pdf(output_pdf_file, stylesheets=['resumes/style.css'])
    #     return f"Successfully exported resume to {output_pdf_file} 🎉"
    # except Exception as e:
    #     return f"Failed to export resume: {str(e)} 💔"