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
    service: 'Railway OCR & AI Service',
    version: '2.0.0',
    endpoints: {
      'GET /': 'Service information',
      'GET /health': 'Health check',
      'POST /ocr': 'Process PDF/image for OCR',
      'POST /extract-concepts': 'Extract concepts from text using AI',
      'POST /chat': 'AI chat for study assistance'
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

// Concept extraction endpoint
app.post('/extract-concepts', express.json(), async (req, res) => {
  try {
    const { text, fileName } = req.body;
    
    if (!text || !fileName) {
      return res.status(400).json({ error: 'Text and fileName are required' });
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Analyze the following text from "${fileName}" and extract ALL concepts, topics, definitions, algorithms, processes, and learning points that students would need to know for comprehensive understanding and exam preparation.

Text content:
${text}

EXTRACT EVERY CONCEPT - do not limit the number. Include:
- Main concepts and topics
- Sub-concepts and detailed points  
- Definitions and terminology
- Algorithms and processes described
- Examples and case studies mentioned
- Technical details and specifications
- Relationships between concepts
- Practical applications mentioned
- Formulas and mathematical expressions
- Code snippets or pseudocode concepts
- Diagrams and visual elements described

For each concept, provide:
1. A clear, specific title
2. A detailed description of what students need to understand
3. How important this concept is for exams (high/medium/low)
4. A relevance score for exam preparation (1-10, where 10 is most likely to appear on exams)
5. Related terms or keywords
6. Page number if identifiable (or section if clear)

Return your analysis in this JSON format:
{
  "concepts": [
    {
      "id": "concept_1",
      "title": "Specific concept name",
      "description": "Comprehensive description of what students need to understand about this concept, including technical details",
      "pageNumber": 1,
      "importance": "high|medium|low",
      "examRelevance": 8,
      "relatedTerms": ["term1", "term2", "term3"]
    }
  ]
}

Be exhaustive - extract every single concept, no matter how small. The goal is complete coverage of all content for thorough exam preparation.`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: `Anthropic API failed: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    const aiResponse = data.content[0].text;
    
    try {
      // Extract JSON from the response
      let jsonStr = aiResponse.trim();
      const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/) || jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0];
      }
      
      const parsed = JSON.parse(jsonStr);
      
      res.json({
        success: true,
        concepts: parsed.concepts || [],
        totalConcepts: parsed.concepts?.length || 0
      });
      
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      res.status(500).json({ 
        error: 'Failed to parse AI response',
        details: parseError.message
      });
    }

  } catch (error) {
    console.error('Error extracting concepts:', error);
    res.status(500).json({ 
      error: 'Concept extraction failed',
      details: error.message
    });
  }
});

// AI chat endpoint for study assistance
app.post('/chat', express.json(), async (req, res) => {
  try {
    const { message, context } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: context ? `${context}\n\n${message}` : message
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: `Anthropic API failed: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    res.json({
      success: true,
      response: data.content[0].text
    });

  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ 
      error: 'Chat failed',
      details: error.message
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Railway OCR Service running on port ${port}`);
  console.log(`📄 Ready to process PDFs with Tesseract OCR`);
  console.log(`🧠 Ready to extract concepts with Claude AI`);
  console.log(`💬 Ready to provide study assistance`);
});