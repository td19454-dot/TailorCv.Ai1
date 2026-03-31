import gradio as gr
import tempfile
from pathlib import Path

def export_resume(resume_text):
    # Create a temporary directory
    tmp_dir = tempfile.mkdtemp()
    pdf_path = Path(tmp_dir) / "resumes" / "new_resume.pdf"

    # Ensure the parent directory exists before writing the file
    pdf_path.parent.mkdir(parents=True, exist_ok=True)

    # TODO: Replace this with real Markdown → PDF logic
    with open(pdf_path, "w", encoding="utf-8") as f:
        f.write(resume_text)

    # Return file path for download
    return str(pdf_path)


with gr.Blocks() as app:
    # create header and app description
    gr.Markdown("# Resume Optimizer 📄")
    gr.Markdown("Upload your resume, paste the job description, and get actionable insights!")

    # gather inputs
    with gr.Row():
        resume_input = gr.File(label="Upload Your Resume (.pdf)")    
        jd_input = gr.Textbox(
            label="Paste the Job Description Here",
            lines=9,
            interactive=True,
            placeholder="Paste job description..."
        )

    # display outputs
    output_resume_md = gr.Markdown(label="New Resume")

    # editing results
    output_resume = gr.Textbox(
        label="Edit resume and export!",
        interactive=True,
        lines=20
    )

    export_button = gr.Button("Export Resume as PDF 🚀")

    # CHANGE: Markdown → File
    export_result = gr.File(label="Download Tailored Resume")

    # Event binding
    export_button.click(
        fn=export_resume,
        inputs=output_resume,
        outputs=export_result
    )

# Launch the app
app.launch()
