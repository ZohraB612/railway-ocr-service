# Railway OCR Service

A standalone OCR service using Tesseract.js for processing PDFs and extracting clean text.

## Features

- ✅ Tesseract OCR for accurate text extraction
- ✅ PDF to image conversion for scanned documents  
- ✅ Fallback to basic PDF text extraction
- ✅ Support for large PDF files (up to 50MB)
- ✅ Clean, readable text output

## API Endpoints

### POST /process-pdf

Upload a PDF file and extract text using OCR.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body: 
  - `pdf`: PDF file (required)
  - `moduleId`: Module identifier (optional)

**Response:**
```json
{
  "success": true,
  "filename": "document.pdf",
  "moduleId": "module-123",
  "extractedText": "Clean extracted text...",
  "textLength": 1543,
  "method": "ocr"
}
```

### GET /health

Check service health status.

## Deployment

This service is designed for Railway deployment with automatic Tesseract OCR support.

1. Push to GitHub
2. Connect to Railway
3. Deploy automatically

## Environment Variables

None required - service works out of the box!