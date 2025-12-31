import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const objectStorage = new ObjectStorageService();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/csv",
      "image/png",
      "image/jpeg",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Dashboard stats
  app.get("/api/dashboard/stats", async (req: Request, res: Response) => {
    try {
      const stats = await storage.getDocumentStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting dashboard stats:", error);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  // Document upload
  app.post("/api/documents/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const file = req.file;
      const title = file.originalname.replace(/\.[^/.]+$/, "");
      
      // Get upload URL from object storage
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      
      // Upload file to object storage
      await fetch(uploadURL, {
        method: "PUT",
        body: file.buffer,
        headers: {
          "Content-Type": file.mimetype,
        },
      });

      // Create document record
      const document = await storage.createDocument({
        title,
        originalFilename: file.originalname,
        filePath: objectPath,
        fileSizeBytes: file.size,
        fileType: file.mimetype,
        processingStatus: "pending",
      });

      // Start processing in background
      processDocument(document.id).catch(console.error);

      res.status(201).json(document);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  // Get all documents
  app.get("/api/documents", async (req: Request, res: Response) => {
    try {
      const { type, status, search } = req.query;
      const documents = await storage.getDocuments({
        type: type as string,
        status: status as string,
        search: search as string,
      });
      res.json({ documents, total: documents.length });
    } catch (error) {
      console.error("Error getting documents:", error);
      res.status(500).json({ error: "Failed to get documents" });
    }
  });

  // Get single document
  app.get("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      const pages = await storage.getDocumentPages(id);
      res.json({ ...document, pages });
    } catch (error) {
      console.error("Error getting document:", error);
      res.status(500).json({ error: "Failed to get document" });
    }
  });

  // Get document processing status
  app.get("/api/documents/:id/status", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json({
        processingStatus: document.processingStatus,
        errorMessage: document.errorMessage,
      });
    } catch (error) {
      console.error("Error getting document status:", error);
      res.status(500).json({ error: "Failed to get document status" });
    }
  });

  // Download document
  app.get("/api/documents/:id/download", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const objectFile = await objectStorage.getObjectEntityFile(document.filePath);
      res.setHeader("Content-Disposition", `attachment; filename="${document.originalFilename}"`);
      await objectStorage.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // View document (for PDF viewer)
  app.get("/api/documents/:id/view", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const objectFile = await objectStorage.getObjectEntityFile(document.filePath);
      res.setHeader("Content-Type", document.fileType);
      await objectStorage.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error viewing document:", error);
      res.status(500).json({ error: "Failed to view document" });
    }
  });

  // Delete document
  app.delete("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDocument(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Re-process document (re-extract text and re-classify)
  app.post("/api/documents/:id/reprocess", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Delete existing pages and embeddings for this document
      await storage.deleteDocumentPages(id);
      await storage.deleteDocumentEmbeddings(id);

      // Reset document status
      await storage.updateDocument(id, {
        processingStatus: "pending",
        fullText: null,
        aiSummary: null,
        keyTopics: null,
        sentiment: null,
        errorMessage: null,
      });

      // Start reprocessing in background
      processDocument(id).catch(console.error);

      res.json({ message: "Document reprocessing started", documentId: id });
    } catch (error) {
      console.error("Error reprocessing document:", error);
      res.status(500).json({ error: "Failed to reprocess document" });
    }
  });

  // Generate document summary (on-demand)
  app.post("/api/documents/:id/summary", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (document.processingStatus !== "completed") {
        return res.status(400).json({ error: "Document is not fully processed yet" });
      }

      // Get all pages text
      const pages = await storage.getDocumentPages(id);
      const fullText = pages.map(p => p.pageText).filter(Boolean).join("\n\n");

      if (!fullText) {
        return res.status(400).json({ error: "No text content available" });
      }

      // Generate summary using Claude
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: `Analyze this financial document and provide a comprehensive summary.

Document content:
${fullText.slice(0, 50000)}

Please provide:
1. A 3-paragraph executive summary
2. 5-7 key themes (as a JSON array of strings)
3. Top 3 risks (as a JSON array of strings)
4. Top 3 opportunities (as a JSON array of strings)
5. Overall sentiment (one of: positive, negative, neutral, mixed)

Return your response as JSON with this structure:
{
  "summary": "executive summary paragraphs",
  "keyThemes": ["theme1", "theme2", ...],
  "risks": ["risk1", "risk2", "risk3"],
  "opportunities": ["opp1", "opp2", "opp3"],
  "sentiment": "positive|negative|neutral|mixed"
}`
        }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      // Parse JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse summary response");
      }

      const summaryData = JSON.parse(jsonMatch[0]);

      // Update document with summary
      await storage.updateDocument(id, {
        aiSummary: summaryData.summary,
        keyTopics: summaryData.keyThemes,
        sentiment: summaryData.sentiment,
      });

      res.json(summaryData);
    } catch (error) {
      console.error("Error generating summary:", error);
      res.status(500).json({ error: "Failed to generate summary" });
    }
  });

  // Get page insight
  app.post("/api/documents/:id/page-insight", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { pageNumber } = req.body;

      const page = await storage.getDocumentPage(id, pageNumber);
      if (!page || !page.pageText) {
        return res.json({ summary: "No text content available for this page.", keyPoints: [] });
      }

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Analyze this page from a financial document and provide insights.

Page content:
${page.pageText}

Return JSON with:
{
  "summary": "brief 2-3 sentence summary of the page",
  "keyPoints": ["point1", "point2", "point3"]
}`
        }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ summary: content.text, keyPoints: [] });
      }

      res.json(JSON.parse(jsonMatch[0]));
    } catch (error) {
      console.error("Error generating page insight:", error);
      res.status(500).json({ error: "Failed to generate page insight" });
    }
  });

  // Ask question about specific document
  app.post("/api/documents/:id/ask", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      const document = await storage.getDocument(id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const pages = await storage.getDocumentPages(id);
      const pagesWithText = pages.filter(p => p.pageText);

      if (pagesWithText.length === 0) {
        return res.json({
          answer: "No text content available in this document to answer your question.",
          citations: [],
        });
      }

      // Prepare context from pages
      const context = pagesWithText.map(p => 
        `[Page ${p.pageNumber}]\n${p.pageText}`
      ).join("\n\n---\n\n").slice(0, 50000);

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: `Answer the following question using ONLY the provided document excerpts.
Cite sources inline like [Page X].
If you cannot answer from the provided content, say so.

Document: ${document.title}

Content:
${context}

Question: ${question}

Respond with JSON:
{
  "answer": "your answer with [Page X] citations inline",
  "citations": [
    {"pageNumber": 1, "excerpt": "relevant quote from page"}
  ]
}`
        }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ answer: content.text, citations: [] });
      }

      res.json(JSON.parse(jsonMatch[0]));
    } catch (error) {
      console.error("Error answering document question:", error);
      res.status(500).json({ error: "Failed to answer question" });
    }
  });

  // Search across all documents
  app.post("/api/search", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;

      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      // Try full-text search first
      let searchEmbeddings = await storage.searchEmbeddings(query, 20);

      // If no results, fall back to getting all embeddings and filtering by ILIKE on document titles
      if (searchEmbeddings.length === 0) {
        const allDocs = await storage.getDocuments({ search: query });
        const results = await Promise.all(
          allDocs.slice(0, 10).map(async (doc) => {
            const pages = await storage.getDocumentPages(doc.id);
            const firstPage = pages[0];
            return {
              documentId: doc.id,
              documentTitle: doc.title,
              documentType: doc.documentType || null,
              pageNumber: 1,
              chunkText: firstPage?.pageText?.slice(0, 300) || doc.fullText?.slice(0, 300) || "No preview available",
              score: 1,
            };
          })
        );
        return res.json({ results, total: results.length });
      }

      // Get document info for each result
      const results = await Promise.all(
        searchEmbeddings.map(async (emb) => {
          const doc = await storage.getDocument(emb.documentId);
          return {
            documentId: emb.documentId,
            documentTitle: doc?.title || "Unknown",
            documentType: doc?.documentType || null,
            pageNumber: emb.pageNumber,
            chunkText: emb.chunkText,
            score: 1, // Placeholder score
          };
        })
      );

      res.json({ results, total: results.length });
    } catch (error) {
      console.error("Error searching documents:", error);
      res.status(500).json({ error: "Failed to search documents" });
    }
  });

  // Q&A across all documents
  app.post("/api/qa/ask", async (req: Request, res: Response) => {
    try {
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      // Search for relevant chunks
      let relevantChunks = await storage.searchEmbeddings(question, 10);

      // If no chunks found via full-text search, get all documents and their pages
      if (relevantChunks.length === 0) {
        const allDocs = await storage.getDocuments({});
        if (allDocs.length === 0) {
          const response = {
            answer: "No documents have been uploaded yet. Please upload some documents first.",
            citations: [],
            insufficientEvidence: true,
          };
          return res.json(response);
        }

        // Get content from all documents
        const allContent: Array<{ documentId: number; documentTitle: string; pageNumber: number; chunkText: string }> = [];
        for (const doc of allDocs.slice(0, 5)) {
          const pages = await storage.getDocumentPages(doc.id);
          for (const page of pages) {
            if (page.pageText) {
              allContent.push({
                documentId: doc.id,
                documentTitle: doc.title,
                pageNumber: page.pageNumber,
                chunkText: page.pageText,
              });
            }
          }
          // Also include full text if no pages
          if (pages.length === 0 && doc.fullText) {
            allContent.push({
              documentId: doc.id,
              documentTitle: doc.title,
              pageNumber: 1,
              chunkText: doc.fullText,
            });
          }
        }

        if (allContent.length === 0) {
          const response = {
            answer: "I cannot answer this question - the documents appear to have no extractable text content.",
            citations: [],
            insufficientEvidence: true,
          };
          return res.json(response);
        }

        // Use all document content for the query
        const context = allContent.map((c, i) => 
          `[Source ${i + 1}: ${c.documentTitle}, Page ${c.pageNumber}]\n${c.chunkText}`
        ).join("\n\n---\n\n").slice(0, 50000);

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: `Answer the following question using ONLY the provided document excerpts.
Cite sources inline like [Document Title, Page X].
If you cannot answer from the provided excerpts, say: "I cannot answer this based on the uploaded documents."

Excerpts:
${context}

Question: ${question}

Respond with JSON:
{
  "answer": "your answer with citations inline",
  "citations": [
    {"documentId": 1, "documentTitle": "title", "pageNumber": 1, "excerpt": "relevant quote"}
  ],
  "insufficientEvidence": false
}`
          }],
        });

        const content = message.content[0];
        if (content.type !== "text") {
          throw new Error("Unexpected response type");
        }

        let response;
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          response = JSON.parse(jsonMatch[0]);
        } else {
          response = {
            answer: content.text,
            citations: [],
            insufficientEvidence: false,
          };
        }

        await storage.createQaHistory({
          question,
          answer: response.answer,
          citations: response.citations,
          documentIds: Array.from(new Set(allContent.map(c => c.documentId))),
        });

        return res.json(response);
      }

      // Get document info and prepare context from search results
      const chunksWithDocs = await Promise.all(
        relevantChunks.map(async (chunk) => {
          const doc = await storage.getDocument(chunk.documentId);
          return {
            ...chunk,
            documentTitle: doc?.title || "Unknown Document",
          };
        })
      );

      const context = chunksWithDocs.map((c, i) => 
        `[Source ${i + 1}: ${c.documentTitle}, Page ${c.pageNumber || "N/A"}]\n${c.chunkText}`
      ).join("\n\n---\n\n");

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: `Answer the following question using ONLY the provided document excerpts.
Cite sources inline like [Document Title, Page X].
If you cannot answer from the provided excerpts, say: "I cannot answer this based on the uploaded documents."

Excerpts:
${context}

Question: ${question}

Respond with JSON:
{
  "answer": "your answer with citations inline",
  "citations": [
    {"documentId": 1, "documentTitle": "title", "pageNumber": 1, "excerpt": "relevant quote"}
  ],
  "insufficientEvidence": false
}`
        }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      let response;
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        response = JSON.parse(jsonMatch[0]);
      } else {
        response = {
          answer: content.text,
          citations: [],
          insufficientEvidence: false,
        };
      }

      // Save to history
      await storage.createQaHistory({
        question,
        answer: response.answer,
        citations: response.citations,
        documentIds: Array.from(new Set(chunksWithDocs.map(c => c.documentId))),
      });

      res.json(response);
    } catch (error) {
      console.error("Error answering question:", error);
      res.status(500).json({ error: "Failed to answer question" });
    }
  });

  // Get Q&A history
  app.get("/api/qa/history", async (req: Request, res: Response) => {
    try {
      const history = await storage.getQaHistory(20);
      res.json(history);
    } catch (error) {
      console.error("Error getting Q&A history:", error);
      res.status(500).json({ error: "Failed to get Q&A history" });
    }
  });

  return httpServer;
}

// Background document processing function
async function processDocument(documentId: number) {
  try {
    await storage.updateDocument(documentId, { processingStatus: "processing" });

    const document = await storage.getDocument(documentId);
    if (!document) return;

    // Get file buffer from object storage
    const objectFile = await objectStorage.getObjectEntityFile(document.filePath);
    const chunks: Buffer[] = [];
    const downloadStream = objectFile.createReadStream();
    
    await new Promise<void>((resolve, reject) => {
      downloadStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      downloadStream.on("end", () => resolve());
      downloadStream.on("error", reject);
    });
    
    const fileBuffer = Buffer.concat(chunks);
    
    let extractedText = "";
    let pageCount = 1;
    const pageTexts: string[] = [];

    // Real PDF text extraction using pdf-parse v2
    if (document.fileType === "application/pdf") {
      try {
        const parser = new PDFParse({ data: fileBuffer });
        const textResult = await parser.getText();
        const info = await parser.getInfo();
        
        extractedText = textResult.text || "";
        pageCount = info.total || 1;
        
        // Split text into roughly equal parts based on page count
        if (extractedText.length > 0) {
          const charsPerPage = Math.ceil(extractedText.length / pageCount);
          for (let i = 0; i < pageCount; i++) {
            const start = i * charsPerPage;
            const end = Math.min((i + 1) * charsPerPage, extractedText.length);
            pageTexts.push(extractedText.slice(start, end));
          }
        }
        
        console.log(`PDF parsed: ${pageCount} pages, ${extractedText.length} characters`);
        
        // Clean up parser resources
        await parser.destroy();
      } catch (pdfError) {
        console.error("PDF parsing error:", pdfError);
        extractedText = "Failed to extract PDF text. The document may be scanned or image-based.";
        pageTexts.push(extractedText);
      }
    } else if (document.fileType.includes("spreadsheet") || document.fileType.includes("excel")) {
      extractedText = "Excel/CSV content extraction not yet implemented.";
      pageTexts.push(extractedText);
    } else if (document.fileType.includes("image")) {
      extractedText = "Image OCR not yet implemented.";
      pageTexts.push(extractedText);
    } else {
      extractedText = "Unsupported document type for text extraction.";
      pageTexts.push(extractedText);
    }

    // Create document pages for each page
    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      if (pageText.trim()) {
        await storage.createDocumentPage({
          documentId,
          pageNumber: i + 1,
          pageText: pageText,
        });
        
        // Create embedding/chunk for search
        await storage.createEmbedding({
          documentId,
          pageNumber: i + 1,
          chunkText: pageText.slice(0, 2000), // Limit chunk size
          chunkIndex: i,
          tokenCount: Math.ceil(pageText.length / 4),
        });
      }
    }

    // Classify document using AI
    let documentType = "other";
    try {
      const classifyMessage = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 256,
        messages: [{
          role: "user",
          content: `Classify this document as one of: annual_report, quarterly_earnings, concall_transcript, industry_report, research_note, investor_presentation, regulatory_filing, other.

Document title: ${document.title}
Content preview: ${extractedText.slice(0, 2000)}

Return only the classification type as a single word.`
        }],
      });

      const classContent = classifyMessage.content[0];
      if (classContent.type === "text") {
        const classified = classContent.text.toLowerCase().trim();
        const validTypes = ["annual_report", "quarterly_earnings", "concall_transcript", "industry_report", "research_note", "investor_presentation", "regulatory_filing", "other"];
        if (validTypes.includes(classified)) {
          documentType = classified;
        }
      }
    } catch (error) {
      console.error("Classification error:", error);
    }

    // Update document as completed
    await storage.updateDocument(documentId, {
      processingStatus: "completed",
      processedDate: new Date(),
      fullText: extractedText,
      pageCount,
      documentType,
    });

  } catch (error) {
    console.error("Document processing error:", error);
    await storage.updateDocument(documentId, {
      processingStatus: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
