const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const { createWorker } = require('tesseract.js');
const pdf2pic = require('pdf2pic');
const pdfParse = require('pdf-parse');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ 
  dest: '/tmp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    service: 'Railway OCR Service',
    version: '1.0.0',
    endpoints: {
      'GET /': 'Service information',
      'GET /health': 'Health check',
      'POST /ocr': 'Process PDF/image for OCR'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'Railway OCR Service' });
});

// OCR processing function
async function extractTextWithTesseract(imagePath) {
  const worker = await createWorker();
  
  try {
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,;:!?-()[]{}/"\'',
      tessedit_pageseg_mode: '1', // Automatic page segmentation with OSD
    });
    
    const { data: { text } } = await worker.recognize(imagePath);
    await worker.terminate();
    
    return text;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

// PDF to images conversion
async function convertPdfToImages(pdfPath) {
  const convert = pdf2pic.fromPath(pdfPath, {
    density: 300,           // High DPI for better OCR
    saveFilename: 'page',
    savePath: '/tmp/pdf-images/',
    format: 'png',
    width: 2000,
    height: 2800
  });

  const results = await convert.bulk(-1, { responseType: 'image' });
  return results.map(result => result.path);
}

// OCR endpoint (alias for process-pdf)
app.post('/ocr', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const pdfPath = req.file.path;
    const moduleId = req.body.moduleId || 'unknown';
    
    console.log(`Processing PDF: ${req.file.originalname} for module: ${moduleId}`);

    // Try basic PDF text extraction first
    let extractedText = '';
    try {
      const pdfBuffer = await fs.readFile(pdfPath);
      const pdfData = await pdfParse(pdfBuffer);
      
      if (pdfData.text && pdfData.text.trim().length > 100) {
        extractedText = pdfData.text.trim();
        console.log(`✅ Basic extraction successful: ${extractedText.length} characters`);
      } else {
        throw new Error('Basic extraction insufficient, trying OCR');
      }
    } catch (basicError) {
      console.log('⚠️ Basic extraction failed, proceeding with OCR...');
      
      // Convert PDF to images
      const imagePaths = await convertPdfToImages(pdfPath);
      console.log(`📸 Converted PDF to ${imagePaths.length} images`);

      // Process each page with Tesseract
      const ocrResults = [];
      for (let i = 0; i < imagePaths.length; i++) {
        console.log(`🔍 Processing page ${i + 1}/${imagePaths.length} with Tesseract...`);
        try {
          const pageText = await extractTextWithTesseract(imagePaths[i]);
          if (pageText.trim().length > 10) {
            ocrResults.push(`--- Page ${i + 1} ---\n${pageText.trim()}`);
          }
        } catch (ocrError) {
          console.error(`OCR failed for page ${i + 1}:`, ocrError.message);
        }
      }

      extractedText = ocrResults.join('\n\n');
      
      // Cleanup image files
      for (const imagePath of imagePaths) {
        await fs.remove(imagePath).catch(() => {});
      }
    }

    // Cleanup uploaded PDF
    await fs.remove(pdfPath).catch(() => {});

    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(500).json({ 
        error: 'Text extraction failed', 
        details: 'Unable to extract meaningful text from PDF' 
      });
    }

    // Return successful response
    res.json({
      success: true,
      text: extractedText.trim(),
      filename: req.file.originalname,
      moduleId: moduleId,
      textLength: extractedText.trim().length,
      method: extractedText.includes('Basic extraction') ? 'basic' : 'ocr'
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    
    // Cleanup on error
    if (req.file && req.file.path) {
      await fs.remove(req.file.path).catch(() => {});
    }
    
    res.status(500).json({ 
      error: 'PDF processing failed', 
      details: error.message 
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Railway OCR Service running on port ${port}`);
  console.log(`📄 Ready to process PDFs with Tesseract OCR`);
});