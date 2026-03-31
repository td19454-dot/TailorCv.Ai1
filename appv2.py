import gradio as gr
import requests
import tempfile
import os

API_URL = "http://13.60.186.131:8000/get-optimised-resume"


def optimize_resume(resume_file, job_description):
    if resume_file is None or not job_description.strip():
        return "Please upload a resume and provide a job description.", None

    files = {
        "file": (
            resume_file.name,
            open(resume_file.name, "rb"),
            "application/pdf"
        )
    }

    response = requests.post(
        f"{API_URL}?jd_string={job_description}",
        files=files,
        timeout=60
    )

    if response.status_code != 200:
        return f"API Error: {response.text}", None

    # Save the PDF response to a temporary file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_file:
        tmp_file.write(response.content)
        pdf_path = tmp_file.name

    return "Resume optimized successfully!", pdf_path


with gr.Blocks(title="Resume Optimizer") as app:
    gr.Markdown("# Resume Optimizer 📄")
    gr.Markdown("Upload your resume and paste a job description.")

    with gr.Row():
        resume_input = gr.File(
            label="Upload Resume (PDF)",
            file_types=[".pdf"]
        )
        jd_input = gr.Textbox(
            label="Job Description",
            lines=10
        )

    output_resume = gr.Textbox(
        label="Optimized Resume",
        lines=20
    )

    output_pdf = gr.File(
        label="Download Tailored Resume"
    )

    submit_btn = gr.Button("Optimize Resume 🚀")

    submit_btn.click(
        fn=optimize_resume,
        inputs=[resume_input, jd_input],
        outputs=[output_resume, output_pdf]
    )


app.launch()
