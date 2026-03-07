import Groq from "groq-sdk";
import { ChartSpec } from "../types";

// ==================== MODEL CONFIGURATION ====================
const PRIMARY_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "llama-3.1-8b-instant";

// ==================== API KEY MANAGEMENT ====================
const getApiKey = (customKey?: string): string => {
  if (customKey && customKey.length > 20) {
    return customKey;
  }

  const envKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!envKey) {
    throw new Error("Groq API key missing in environment variables.");
  }
  return envKey;
};

// ==================== FILE READING ====================
async function readFileContent(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export interface KnowledgeDocument {
  id?: number;
  name: string;
  category: string;
  content: string;
  type: string;
}

// ==================== DYNAMIC DATA TYPES ====================

interface ColumnInfo {
  name: string;
  possibleValues: Set<string>;
  valueCounts: Map<string, number>;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'unknown';
  description: string;
  fileSource: string;
  sampleValues: string[];
  totalRows: number;
  nullCount: number;
  isCategorical: boolean;
  isNumeric: boolean;
  isDate: boolean;
  uniqueValueCount: number;
}

interface FileAnalysis {
  fileName: string;
  fileType: 'csv' | 'word' | 'pdf' | 'unknown';
  rowCount: number;
  columns: ColumnInfo[];
  summary: string;
  keyFindings: string[];
  topics: Set<string>;
  entities: Map<string, Set<string>>;
  fullContent: string;
  sections?: Map<string, string>; // For extracting sections from documents
}

interface KnowledgeBase {
  files: FileAnalysis[];
  allColumns: Map<string, ColumnInfo[]>;
  relationships: Array<{
    column1: string;
    column2: string;
    similarity: number;
    files: string[];
    correlation?: number;
  }>;
  statistics: {
    totalFiles: number;
    totalRows: number;
    uniqueColumns: Set<string>;
    columnFrequency: Map<string, number>;
    fileTypes: Map<string, number>;
  };
  dataCategories: Map<string, {
    columns: string[];
    files: string[];
    values: Map<string, number>;
    description: string;
  }>;
  searchIndex: Map<string, Set<string>>;
}

interface DocumentSearchResult {
  fileName: string;
  relevance: number;
  excerpts: string[];
  matchedTerms: string[];
  summary: string;
  fileType: string;
  score: number;
  relevantSections?: Map<string, string>; // Store relevant sections
}

// ==================== UTILITY FUNCTIONS ====================

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 100;
  
  const maxLength = Math.max(s1.length, s2.length);
  if (maxLength === 0) return 100;
  
  const distance = levenshteinDistance(s1, s2);
  const similarity = ((maxLength - distance) / maxLength) * 100;
  
  return Math.round(similarity * 100) / 100;
}

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/\W+/);
  const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'are', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'how']);
  return new Set(words.filter(w => w.length > 2 && !stopWords.has(w)));
}

// Extract sections from a document based on headings
function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  
  // Common heading patterns
  const headingPatterns = [
    /^#{1,3}\s+(.+)$/gm, // Markdown headings
    /^([A-Z][A-Z\s]+):$/gm, // ALL CAPS headings with colon
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*):$/gm, // Title Case headings with colon
    /^\d+\.\s+(.+)$/gm, // Numbered sections
    /^[IVX]+\.\s+(.+)$/gm // Roman numeral sections
  ];
  
  let currentSection = "GENERAL";
  let currentContent: string[] = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let isHeading = false;
    
    // Check if this line is a heading
    for (const pattern of headingPatterns) {
      const match = line.match(pattern);
      if (match) {
        // Save previous section
        if (currentContent.length > 0) {
          sections.set(currentSection, currentContent.join('\n'));
        }
        
        // Start new section
        currentSection = match[1] || match[0];
        currentContent = [];
        isHeading = true;
        break;
      }
    }
    
    if (!isHeading && line.length > 0) {
      currentContent.push(line);
    }
  }
  
  // Save last section
  if (currentContent.length > 0) {
    sections.set(currentSection, currentContent.join('\n'));
  }
  
  return sections;
}

// ==================== DYNAMIC FILE ANALYSIS ====================

function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = content.split('\n').filter((l: string) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  
  const headers = lines[0].split(',').map((h: string) => h.trim());
  const rows = lines.slice(1).map((line: string) => 
    line.split(',').map((cell: string) => cell.trim())
  );
  
  return { headers, rows };
}

function determineDataType(values: string[]): 'string' | 'number' | 'boolean' | 'date' | 'unknown' {
  if (values.length === 0) return 'unknown';
  
  if (values.every(v => !isNaN(Number(v)) && v.trim() !== '')) {
    return 'number';
  }
  
  const booleanValues = ['yes', 'no', 'true', 'false', 'y', 'n', '1', '0'];
  if (values.every(v => booleanValues.includes(v.toLowerCase().trim()))) {
    return 'boolean';
  }
  
  const datePattern = /^\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}$/;
  if (values.every(v => datePattern.test(v))) {
    return 'date';
  }
  
  return 'string';
}

function analyzeColumn(header: string, values: string[], totalRows: number, fileName: string): ColumnInfo {
  const possibleValues = new Set<string>();
  const valueCounts = new Map<string, number>();
  let nullCount = 0;
  
  values.forEach(value => {
    if (!value || value === '') {
      nullCount++;
    } else {
      possibleValues.add(value);
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
    }
  });
  
  const sampleValues = Array.from(possibleValues).slice(0, 10);
  const dataType = determineDataType(Array.from(possibleValues));
  const uniqueValueCount = possibleValues.size;
  
  let description = `Column "${header}"`;
  if (uniqueValueCount === 1) {
    description += ` (constant value: ${sampleValues[0]})`;
  } else if (uniqueValueCount < 10) {
    description += ` (categorical: ${sampleValues.join(', ')})`;
  } else if (dataType === 'number') {
    const numbers = values.filter(v => !isNaN(Number(v))).map(Number);
    if (numbers.length > 0) {
      const min = Math.min(...numbers);
      const max = Math.max(...numbers);
      const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      description += ` (numeric range: ${min.toFixed(2)} - ${max.toFixed(2)}, avg: ${avg.toFixed(2)})`;
    }
  }
  
  return {
    name: header,
    possibleValues,
    valueCounts,
    dataType,
    description,
    fileSource: fileName,
    sampleValues,
    totalRows,
    nullCount,
    isCategorical: uniqueValueCount < 20,
    isNumeric: dataType === 'number',
    isDate: dataType === 'date',
    uniqueValueCount
  };
}

function analyzeWordDocument(doc: KnowledgeDocument): FileAnalysis {
  const lines = doc.content.split('\n');
  const content = doc.content;
  
  // Extract sections
  const sections = extractSections(content);
  
  // Auto-detect topics from content
  const topics = new Set<string>();
  
  // Look for patterns that might indicate topics
  const topicPatterns = [
    /\b(proposal|project|program|initiative)\b/gi,
    /\b(fish|aquaculture|tilapia|fishing)\b/gi,
    /\b(agriculture|farming|crops|rice)\b/gi,
    /\b(livelihood|enterprise|business)\b/gi,
    /\b(training|workshop|seminar)\b/gi,
    /\b(gender|women|men|female|male)\b/gi,
    /\b(health|medical|hospital|clinic)\b/gi,
    /\b(education|school|student|teacher)\b/gi,
    /\b(infrastructure|building|construction)\b/gi,
    /\b(funding|grant|budget|financial)\b/gi,
    /\b(phase|phase 1|phase 2|phase 3|phase 4|phase 5)\b/gi,
    /\b(guidelines|guideline|mc|memorandum circular)\b/gi
  ];
  
  topicPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(m => topics.add(m.toLowerCase()));
    }
  });
  
  // Extract named entities (simplified)
  const entities = new Map<string, Set<string>>();
  const namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const names = content.match(namePattern) || [];
  entities.set('names', new Set(names.slice(0, 50)));
  
  const barangayPattern = /\b(Brgy\.?|Barangay)\s+([A-Za-z\s]+)\b/gi;
  const barangays = content.match(barangayPattern) || [];
  entities.set('locations', new Set(barangays));
  
  // Extract document references
  const docRefPattern = /\b(MC-No[.-]?\d+[-]?\d+|MC\s+\d+|Memorandum Circular|Administrative Order)\b/gi;
  const docRefs = content.match(docRefPattern) || [];
  entities.set('document_references', new Set(docRefs));
  
  const analysis: FileAnalysis = {
    fileName: doc.name,
    fileType: 'word',
    rowCount: lines.length,
    columns: [],
    summary: content.substring(0, 300).replace(/\n/g, ' ') + '...',
    keyFindings: [
      `Contains approximately ${names.length} names`,
      `Topics detected: ${Array.from(topics).slice(0, 5).join(', ')}`,
      `Document references: ${Array.from(entities.get('document_references') || []).slice(0, 3).join(', ')}`
    ],
    topics,
    entities,
    fullContent: content,
    sections
  };
  
  return analysis;
}

// ==================== DYNAMIC KNOWLEDGE BUILDING ====================

async function analyzeAllFiles(knowledgeBase: KnowledgeDocument[]): Promise<KnowledgeBase> {
  const kb: KnowledgeBase = {
    files: [],
    allColumns: new Map(),
    relationships: [],
    statistics: {
      totalFiles: knowledgeBase.length,
      totalRows: 0,
      uniqueColumns: new Set(),
      columnFrequency: new Map(),
      fileTypes: new Map()
    },
    dataCategories: new Map(),
    searchIndex: new Map()
  };
  
  knowledgeBase.forEach((doc: KnowledgeDocument) => {
    const fileType = doc.name.endsWith('.csv') ? 'csv' : 
                     doc.name.includes('.doc') ? 'word' : 'unknown';
    kb.statistics.fileTypes.set(fileType, (kb.statistics.fileTypes.get(fileType) || 0) + 1);
    
    if (fileType === 'csv') {
      const { headers, rows } = parseCSV(doc.content);
      
      const fileAnalysis: FileAnalysis = {
        fileName: doc.name,
        fileType: 'csv',
        rowCount: rows.length,
        columns: [],
        summary: `CSV with ${rows.length} rows, ${headers.length} columns`,
        keyFindings: [],
        topics: new Set(),
        entities: new Map(),
        fullContent: doc.content
      };
      
      kb.statistics.totalRows += rows.length;
      
      headers.forEach((header: string, index: number) => {
        const values = rows.map(row => row[index] || '');
        const columnInfo = analyzeColumn(header, values, rows.length, doc.name);
        fileAnalysis.columns.push(columnInfo);
        
        kb.statistics.uniqueColumns.add(header);
        kb.statistics.columnFrequency.set(header, (kb.statistics.columnFrequency.get(header) || 0) + 1);
        
        if (!kb.allColumns.has(header)) {
          kb.allColumns.set(header, []);
        }
        kb.allColumns.get(header)!.push(columnInfo);
        
        const headerLower = header.toLowerCase();
        
        if (columnInfo.isCategorical && columnInfo.uniqueValueCount < 20) {
          const categoryName = headerLower.replace(/[^a-z]/g, '');
          const categoryData = kb.dataCategories.get(categoryName) || {
            columns: [],
            files: [],
            values: new Map(),
            description: `Data about ${header}`
          };
          
          categoryData.columns.push(header);
          categoryData.files.push(doc.name);
          
          columnInfo.valueCounts.forEach((count, value) => {
            categoryData.values.set(value, (categoryData.values.get(value) || 0) + count);
          });
          
          kb.dataCategories.set(categoryName, categoryData);
          fileAnalysis.keyFindings.push(`Found categorical column "${header}" with values: ${columnInfo.sampleValues.join(', ')}`);
        }
      });
      
      kb.files.push(fileAnalysis);
      
    } else if (fileType === 'word') {
      const fileAnalysis = analyzeWordDocument(doc);
      kb.files.push(fileAnalysis);
      
      // Add to search index
      const keywords = extractKeywords(doc.content);
      keywords.forEach(term => {
        if (!kb.searchIndex.has(term)) {
          kb.searchIndex.set(term, new Set());
        }
        kb.searchIndex.get(term)!.add(doc.name);
      });
    }
  });
  
  const allColumnNames = Array.from(kb.statistics.uniqueColumns);
  for (let i = 0; i < allColumnNames.length; i++) {
    for (let j = i + 1; j < allColumnNames.length; j++) {
      const col1 = allColumnNames[i];
      const col2 = allColumnNames[j];
      
      const similarity = calculateSimilarity(col1, col2);
      if (similarity > 70) {
        kb.relationships.push({
          column1: col1,
          column2: col2,
          similarity,
          files: Array.from(new Set([
            ...(kb.allColumns.get(col1) || []).map(c => c.fileSource),
            ...(kb.allColumns.get(col2) || []).map(c => c.fileSource)
          ]))
        });
      }
    }
  }
  
  return kb;
}

// ==================== IMPROVED SEARCH ====================

async function searchDocuments(knowledgeBase: KnowledgeDocument[], query: string): Promise<DocumentSearchResult[]> {
  const results: DocumentSearchResult[] = [];
  const queryLower = query.toLowerCase();
  const queryKeywords = extractKeywords(query);
  
  knowledgeBase.forEach((doc: KnowledgeDocument) => {
    if (doc.name.endsWith('.csv')) return;
    
    const contentLower = doc.content.toLowerCase();
    const excerpts: string[] = [];
    const matchedTerms: string[] = [];
    const relevantSections = new Map<string, string>();
    
    let relevance = 0;
    
    // Search for each keyword
    queryKeywords.forEach(keyword => {
      if (contentLower.includes(keyword)) {
        relevance += 10;
        matchedTerms.push(keyword);
        
        // Extract context
        if (excerpts.length < 5) {
          const index = contentLower.indexOf(keyword);
          const start = Math.max(0, index - 100);
          const end = Math.min(contentLower.length, index + 200);
          excerpts.push(`...${doc.content.substring(start, end)}...`);
        }
      }
    });
    
    // Look for specific patterns in the query
    if (queryLower.includes('phase') || queryLower.includes('phases')) {
      // Find sections that might contain phase information
      const phasePattern = /(phase\s*[1-5]|step\s*[1-5]|stage\s*[1-5])/gi;
      const phaseMatches = doc.content.match(phasePattern);
      if (phaseMatches) {
        relevance += 30;
        phaseMatches.forEach(phase => matchedTerms.push(phase));
        
        // Extract paragraphs containing phase information
        const paragraphs = doc.content.split('\n\n');
        paragraphs.forEach(para => {
          if (para.toLowerCase().includes('phase')) {
            relevantSections.set('Phases', para.substring(0, 300));
          }
        });
      }
    }
    
    // Check for document references
    if (queryLower.includes('mc') || queryLower.includes('circular') || queryLower.includes('guideline')) {
      const docRefPattern = /(MC-No[.-]?\d+[-]?\d+|MC\s+\d+|Memorandum Circular|guideline)/gi;
      const docMatches = doc.content.match(docRefPattern);
      if (docMatches) {
        relevance += 40;
        docMatches.forEach(ref => matchedTerms.push(ref));
      }
    }
    
    // Boost if filename matches
    const fileNameLower = doc.name.toLowerCase();
    queryKeywords.forEach(keyword => {
      if (fileNameLower.includes(keyword)) {
        relevance += 20;
      }
    });
    
    if (relevance > 0) {
      const summary = doc.content.substring(0, 300).replace(/\n/g, ' ') + '...';
      
      results.push({
        fileName: doc.name,
        relevance,
        excerpts,
        matchedTerms,
        summary,
        fileType: doc.name.includes('.doc') ? 'Word Document' : 'File',
        score: relevance,
        relevantSections
      });
    }
  });
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

// ==================== COPY REQUEST HANDLER ====================

async function handleCopyRequest(prompt: string, knowledgeBase: KnowledgeDocument[]): Promise<{ text: string; fileDownload?: any }> {
  let requestedFile = '';
  
  const patterns = [
    /get copy of ["']?([^"']+\.docx?)["']?/i,
    /copy of ["']?([^"']+\.docx?)["']?/i,
    /["']([^"']+\.docx?)["']/i,
    /([A-Za-z0-9_\-\s]+\.docx?)/i
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      requestedFile = match[1];
      break;
    }
  }
  
  if (!requestedFile) {
    const availableFiles = knowledgeBase
      .filter(doc => !doc.name.endsWith('.csv'))
      .map(doc => `- ${doc.name}`)
      .join('\n');
    
    return {
      text: `I couldn't identify which file you want.\n\nAvailable files:\n${availableFiles}\n\nPlease specify like: "Get copy of filename.docx"`
    };
  }
  
  const normalizeFileName = (filename: string): string => {
    return filename.toLowerCase().replace(/\s+/g, ' ').trim();
  };
  
  const normalizedRequested = normalizeFileName(requestedFile);
  
  let document: KnowledgeDocument | undefined;
  
  for (const doc of knowledgeBase) {
    if (doc.name.endsWith('.csv')) continue;
    
    const normalizedDoc = normalizeFileName(doc.name);
    
    if (normalizedDoc.includes(normalizedRequested) || 
        normalizedRequested.includes(normalizedDoc) ||
        calculateSimilarity(normalizedRequested, normalizedDoc) > 70) {
      document = doc;
      break;
    }
  }
  
  if (document) {
    const blob = new Blob([document.content], { type: 'application/msword' });
    const fileDownload = {
      name: document.name,
      content: document.content,
      blob: blob,
      url: URL.createObjectURL(blob)
    };
    
    const preview = document.content.length > 500 
      ? document.content.substring(0, 500) + '...' 
      : document.content;
    
    return {
      text: `## 📄 Copy of ${document.name}\n\n**Preview:**\n\`\`\`\n${preview}\n\`\`\`\n\n*Click the download button below to get the full document.*`,
      fileDownload
    };
  }
  
  const availableFiles = knowledgeBase
    .filter(doc => !doc.name.endsWith('.csv'))
    .map(doc => `- ${doc.name}`)
    .join('\n');
  
  return {
    text: `I couldn't find a file matching "${requestedFile}".\n\nAvailable files:\n${availableFiles}`
  };
}

// ==================== IMPROVED CONTEXT BUILDING ====================

function buildContextFromDocuments(knowledgeBase: KnowledgeDocument[], searchResults: DocumentSearchResult[], query: string): string {
  let context = `=== DOCUMENTS UPLOADED BY USER ===\n\n`;
  
  // First, try to find the most relevant document for the query
  const relevantDocs = searchResults.length > 0 
    ? searchResults 
    : knowledgeBase.map(doc => ({
        fileName: doc.name,
        relevance: 0,
        excerpts: [],
        matchedTerms: [],
        summary: doc.content.substring(0, 200),
        fileType: doc.name.includes('.doc') ? 'Word' : 'File',
        score: 0
      }));
  
  // Sort by relevance
  relevantDocs.sort((a, b) => b.relevance - a.relevance);
  
  // Add full content of the most relevant documents
  const docsToInclude = relevantDocs.slice(0, 3); // Include top 3 most relevant
  
  docsToInclude.forEach((result, index) => {
    const doc = knowledgeBase.find(d => d.name === result.fileName);
    if (!doc) return;
    
    context += `\n--- DOCUMENT ${index + 1}: ${doc.name} ---\n`;
    context += `RELEVANCE: ${result.relevance}\n`;
    
    if (result.matchedTerms && result.matchedTerms.length > 0) {
      context += `MATCHED TERMS: ${result.matchedTerms.join(', ')}\n`;
    }
    
    context += `\nFULL CONTENT:\n`;
    
    // For the specific query about SLP phases, extract relevant sections
    if (query.toLowerCase().includes('slp') || query.toLowerCase().includes('phase')) {
      // Look for sections that might contain phase information
      const lines = doc.content.split('\n');
      let inRelevantSection = false;
      let relevantContent = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for section headings
        if (line.match(/phase|step|stage|guideline|mc|circular/i)) {
          inRelevantSection = true;
          relevantContent.push(line);
        } else if (inRelevantSection && line.trim().length > 0) {
          relevantContent.push(line);
        } else if (inRelevantSection && line.trim().length === 0) {
          // Empty line might indicate end of section
          if (relevantContent.length > 10) {
            break;
          }
        }
      }
      
      if (relevantContent.length > 0) {
        context += relevantContent.join('\n');
      } else {
        // If no specific section found, include full document
        context += doc.content;
      }
    } else {
      // For other queries, include full document
      context += doc.content;
    }
    
    context += '\n\n';
  });
  
  // If we couldn't find relevant documents, include all documents
  if (docsToInclude.length === 0) {
    knowledgeBase.forEach((doc, index) => {
      context += `\n--- DOCUMENT ${index + 1}: ${doc.name} ---\n`;
      context += `CONTENT:\n${doc.content}\n\n`;
    });
  }
  
  return context;
}

// ==================== EXPORTED FUNCTIONS ====================

export async function validateApiKey(): Promise<boolean> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) return false;
    
    const groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });

    await groq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1
    });
    return true;
  } catch (error) {
    console.error("API Key Validation Error:", error);
    return false;
  }
}

export async function analyzeImage(file: File, customKey?: string): Promise<string> {
  try {
    const apiKey = getApiKey(customKey);
    const fileContent = await readFileContent(file).catch(() => null);
    
    if (fileContent) {
      const groq = new Groq({
        apiKey,
        dangerouslyAllowBrowser: true
      });

      const completion = await groq.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [
          {
            role: "user",
            content: `This file "${file.name}" contains:\n\n${fileContent.substring(0, 2000)}\n\nPlease summarize what this document contains.`
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      return completion.choices?.[0]?.message?.content || "Could not analyze the file content.";
    }

    return `[File: ${file.name}] Size: ${(file.size / 1024).toFixed(2)} KB Type: ${file.type || 'Unknown'}`;
  } catch (error) {
    console.error("File analysis error:", error);
    return `Could not analyze the file "${file.name}".`;
  }
}

export async function generateContent(
  prompt: string,
  currentFiles: File[],
  knowledgeBase: KnowledgeDocument[],
  customKey?: string,
  chatHistory: any[] = []
): Promise<{ text: string; chart?: ChartSpec; fileDownload?: any }> {

  const apiKey = getApiKey(customKey);
  if (!apiKey) {
    throw new Error("Groq API key is missing.");
  }

  // Check for copy requests
  if (prompt.toLowerCase().includes('get copy of') || 
      prompt.toLowerCase().includes('copy of') ||
      prompt.toLowerCase().includes('download')) {
    return await handleCopyRequest(prompt, knowledgeBase);
  }

  // Analyze all files
  const kb = await analyzeAllFiles(knowledgeBase);
  
  // Search for relevant documents
  const searchResults = await searchDocuments(knowledgeBase, prompt);
  
  // Build comprehensive context
  const context = buildContextFromDocuments(knowledgeBase, searchResults, prompt);

  console.log("Search results:", searchResults.length);
  console.log("Context length:", context.length);

  const groq = new Groq({
    apiKey,
    dangerouslyAllowBrowser: true
  });

  const completion = await groq.chat.completions.create({
    model: PRIMARY_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an AI assistant that analyzes uploaded documents and answers questions based SOLELY on their content.

IMPORTANT RULES:
1. ONLY use information from the provided documents - never invent answers
2. If the exact answer isn't in the documents, say "I cannot find that information in the uploaded files"
3. When you find relevant information, quote or reference the specific section
4. For questions about guidelines, phases, or procedures, extract the exact details from the documents
5. If multiple documents contain information, combine them into a comprehensive answer
6. Be specific - include numbers, dates, and exact wording from the documents

The documents are provided in the context below. Read them carefully before answering.`
      },
      {
        role: "user",
        content: `QUESTION: ${prompt}\n\nDOCUMENTS:\n${context}\n\nBased ONLY on the documents above, answer the question. If the answer cannot be found, say so.`
      }
    ],
    temperature: 0.1, // Lower temperature for more accurate responses
    max_tokens: 1500
  });

  const answer = completion.choices?.[0]?.message?.content || "No answer generated.";
  
  // If the answer indicates no information found, add a helpful message
  if (answer.includes("cannot find") || answer.includes("not available")) {
    return {
      text: answer + "\n\nTry asking about something else in your documents, or upload more relevant files."
    };
  }

  return {
    text: answer
  };
}