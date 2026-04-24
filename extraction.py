import pymupdf  # PyMuPDF
import json
from openai import OpenAI
import os
from dotenv import load_dotenv
load_dotenv()


def _escape_braces(text: str) -> str:
    """Escape curly braces so user text with { or } does not crash f-string formatting."""
    return str(text or "").replace("{", "{{").replace("}", "}}")
def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using PyMuPDF"""
    doc = pymupdf.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text

def extract_candidate_data(pdf_text):
    """Use OPenai API to extract structured data from resume text"""
    prompt=f"""You are a ats software. Extract all following information from this resume and return it as valid JSON:
If a field is not found, use null. Ensure the output is valid JSON only, no other text.
Based on the fiels are present create field and write the information corresponding to the field
All the text in the resume must be extracted and put in relevant sections
Resume text:
{_escape_braces(pdf_text)}"""
    client = OpenAI()
    temperature=0
    model="gpt-4o-mini"
    response=client.chat.completions.create(model=model,
                                            messages=[
                                                {'role':'system',"content":'Extract data from file like ats software'},
                                                {'role':'user','content':prompt}
                                            ],temperature=temperature)
    

    
    
    # Extract JSON from response
    response_text = response.choices[0].message.content
    # Remove markdown code blocks if present
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0].strip()
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0].strip()
    
    return json.loads(response_text)

def process_resume(pdf_path):
    """Main function to process resume PDF"""
    print(f"Processing: {pdf_path}")
    
    # Extract text
    text = extract_text_from_pdf(pdf_path)
    
    # Extract structured data
    candidate_data = extract_candidate_data(text)
    
    return candidate_data

# Example usage
if __name__ == "__main__":
    pdf_path = "resume.pdf"
    data = process_resume(pdf_path)
    
    # Save to JSON file
    with open("candidate_data.json", "w") as f:
        json.dump(data, indent=2, fp=f)
    
    print(json.dumps(data, indent=2))