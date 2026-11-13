// Extracts plain text from a PDF entirely in the browser/Electron renderer — the file is never
// uploaded anywhere. Resume/job-description text only ever lives in this tab's memory and
// localStorage, same as the existing paste-text fields; nothing is sent to or stored on the server.

const MAX_PDF_BYTES = 10 * 1024 * 1024;

let pdfjsPromise = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, workerUrlModule] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrlModule.default || workerUrlModule;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function extractPdfText(file) {
  if (file.type !== "application/pdf" && !file.name?.toLowerCase().endsWith(".pdf")) {
    throw new Error("Please choose a PDF file.");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error("PDF is too large (10 MB max).");
  }
  const pdfjs = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  const text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!text) {
    throw new Error("No selectable text found in this PDF (it may be a scanned image). Paste the resume text instead.");
  }
  return text;
}
