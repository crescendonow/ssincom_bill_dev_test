from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

def generate_invoice_pdf(invoice):
    env = Environment(loader=FileSystemLoader("app/templates"))
    template = env.get_template("invoice.html")
    html_out = template.render(invoice=invoice)
    pdf_path = "/tmp/invoice.pdf"
    HTML(string=html_out).write_pdf(pdf_path)
    return pdf_path
