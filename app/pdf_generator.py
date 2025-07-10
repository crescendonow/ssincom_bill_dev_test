from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML
from pathlib import Path

def generate_invoice_pdf(invoice):
    base_path = Path(__file__).resolve().parent
    env = Environment(loader=FileSystemLoader(str(base_path / "templates")))
    template = env.get_template("invoice.html")
    html_out = template.render(invoice=invoice)
    pdf_path = "/tmp/invoice.pdf"
    HTML(string=html_out).write_pdf(pdf_path)
    return pdf_path
