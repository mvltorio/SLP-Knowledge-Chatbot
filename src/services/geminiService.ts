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
  topics: Set<string>; // Auto-detected topics from content
  entities: Map<string, Set<string>>; // Named entities found
  fullContent: string; // Store full content for answering questions
}

interface KnowledgeBase {
  files: FileAnalysis[];
  allColumns: Map<string, ColumnInfo[]>; // Column name -> files where it appears
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
  // Auto-detected data categories (not hardcoded)
  dataCategories: Map<string, {
    columns: string[];
    files: string[];
    values: Map<string, number>;
    description: string;
  }>;
  // Search index for quick lookup
  searchIndex: Map<string, Set<string>>; // term -> files containing it
}

interface DocumentSearchResult {
  fileName: string;
  relevance: number;
  excerpts: string[];
  matchedTerms: string[];
  summary: string;
  fileType: string;
  score: number;
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
  const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'are', 'was', 'were']);
  return new Set(words.filter(w => w.length > 3 && !stopWords.has(w)));
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
  
  // Check if all are numbers
  if (values.every(v => !isNaN(Number(v)) && v.trim() !== '')) {
    return 'number';
  }
  
  // Check if all are boolean-like
  const booleanValues = ['yes', 'no', 'true', 'false', 'y', 'n', '1', '0'];
  if (values.every(v => booleanValues.includes(v.toLowerCase().trim()))) {
    return 'boolean';
  }
  
  // Check if all are dates
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
  
  // Auto-generate description based on data patterns
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
  
  // Auto-detect topics from content
  const topics = new Set<string>();
  const keywords = extractKeywords(content);
  
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
    /\b(funding|grant|budget|financial)\b/gi
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
  
  const analysis: FileAnalysis = {
    fileName: doc.name,
    fileType: 'word',
    rowCount: lines.length,
    columns: [],
    summary: content.substring(0, 300).replace(/\n/g, ' ') + '...',
    keyFindings: [
      `Contains approximately ${names.length} names`,
      `Topics detected: ${Array.from(topics).slice(0, 5).join(', ')}`
    ],
    topics,
    entities,
    fullContent: content // Store full content for answering questions
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
    // Track file types
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
        fullContent: doc.content // Store full content
      };
      
      kb.statistics.totalRows += rows.length;
      
      // Analyze each column
      headers.forEach((header: string, index: number) => {
        const values = rows.map(row => row[index] || '');
        const columnInfo = analyzeColumn(header, values, rows.length, doc.name);
        fileAnalysis.columns.push(columnInfo);
        
        // Update global tracking
        kb.statistics.uniqueColumns.add(header);
        kb.statistics.columnFrequency.set(header, (kb.statistics.columnFrequency.get(header) || 0) + 1);
        
        if (!kb.allColumns.has(header)) {
          kb.allColumns.set(header, []);
        }
        kb.allColumns.get(header)!.push(columnInfo);
        
        // Auto-detect data categories based on column names and values
        const headerLower = header.toLowerCase();
        
        // Look for potential categorical data
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
          
          // Aggregate value counts
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
  
  // Find relationships between columns
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

// ==================== DYNAMIC SEARCH ====================

async function searchDocuments(knowledgeBase: KnowledgeDocument[], query: string): Promise<DocumentSearchResult[]> {
  const results: DocumentSearchResult[] = [];
  const queryLower = query.toLowerCase();
  const queryKeywords = extractKeywords(query);
  
  knowledgeBase.forEach((doc: KnowledgeDocument) => {
    if (doc.name.endsWith('.csv')) return; // Skip CSV for content search
    
    const contentLower = doc.content.toLowerCase();
    const excerpts: string[] = [];
    const matchedTerms: string[] = [];
    
    let relevance = 0;
    
    // Search for each keyword
    queryKeywords.forEach(keyword => {
      if (contentLower.includes(keyword)) {
        relevance += 10;
        matchedTerms.push(keyword);
        
        // Extract context
        if (excerpts.length < 3) {
          const index = contentLower.indexOf(keyword);
          const start = Math.max(0, index - 50);
          const end = Math.min(contentLower.length, index + 50);
          excerpts.push(`...${doc.content.substring(start, end)}...`);
        }
      }
    });
    
    // Boost if filename matches
    const fileNameLower = doc.name.toLowerCase();
    queryKeywords.forEach(keyword => {
      if (fileNameLower.includes(keyword)) {
        relevance += 20;
      }
    });
    
    if (relevance > 0) {
      const summary = doc.content.substring(0, 250).replace(/\n/g, ' ') + '...';
      
      results.push({
        fileName: doc.name,
        relevance,
        excerpts,
        matchedTerms,
        summary,
        fileType: doc.name.includes('.doc') ? 'Word Document' : 'File',
        score: relevance
      });
    }
  });
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

// ==================== COPY REQUEST HANDLER ====================

async function handleCopyRequest(prompt: string, knowledgeBase: KnowledgeDocument[]): Promise<{ text: string; fileDownload?: any }> {
  // Extract filename from request
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
  
  // Find the document (flexible matching)
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

// ==================== BUILD CONTEXT FROM DOCUMENTS ====================

function buildContextFromDocuments(knowledgeBase: KnowledgeDocument[], searchResults: DocumentSearchResult[]): string {
  let context = `DOCUMENT CONTENT FROM USER FILES:\n\n`;
  
  // Add all document contents to context
  knowledgeBase.forEach(doc => {
    if (doc.name.endsWith('.csv')) {
      // For CSV files, add a summary
      context += `FILE: ${doc.name} (CSV)\n`;
      context += `CONTENT: This is a CSV file with the following data:\n${doc.content.substring(0, 1000)}${doc.content.length > 1000 ? '...' : ''}\n\n`;
    } else {
      // For Word documents, add full content (truncated if too long)
      context += `FILE: ${doc.name}\n`;
      context += `CONTENT: ${doc.content.substring(0, 3000)}${doc.content.length > 3000 ? '...' : ''}\n\n`;
    }
  });
  
  // Add search results if available
  if (searchResults.length > 0) {
    context += "\n\nRELEVANT SEARCH RESULTS:\n\n";
    searchResults.forEach((result) => {
      context += `FILE: ${result.fileName}\n`;
      context += `SUMMARY: ${result.summary}\n`;
      if (result.excerpts.length > 0) {
        result.excerpts.forEach(excerpt => {
          context += `EXCERPT: ${excerpt}\n`;
        });
      }
      context += "\n";
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
  
  // Check if this is a search query
  const needsSearch = prompt.toLowerCase().includes('find') || 
                      prompt.toLowerCase().includes('search') ||
                      prompt.toLowerCase().includes('proposal') ||
                      prompt.toLowerCase().includes('document') ||
                      prompt.toLowerCase().includes('about');
  
  let searchResults: DocumentSearchResult[] = [];
  
  if (needsSearch) {
    searchResults = await searchDocuments(knowledgeBase, prompt);
  }
  
  // Build context using REAL document content
  const context = buildContextFromDocuments(knowledgeBase, searchResults);

  const groq = new Groq({
    apiKey,
    dangerouslyAllowBrowser: true
  });

  const completion = await groq.chat.completions.create({
    model: PRIMARY_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an AI assistant that analyzes uploaded documents and datasets.

Your job is to carefully read and understand the provided document content before answering.

Rules you must follow:

1. Always analyze the FULL document content provided in the context.
2. If the answer exists in the documents, explain it clearly and accurately.
3. When possible, quote or summarize the relevant section from the document.
4. If the question refers to definitions, phases, guidelines, or procedures, extract the exact information from the files.
5. If multiple documents contain relevant information, combine them into one clear answer.
6. If the answer does NOT exist in the uploaded files, say:
   "I cannot find that information in the uploaded files."

Never invent information that is not present in the documents.
Always base your answer only on the provided document content.`
      },
      {
        role: "user",
        content: `Question:\n${prompt}\n\nData:\n${context}`
      }
    ],
    temperature: 0.2,
    max_tokens: 1000
  });

  return {
    text: completion.choices?.[0]?.message?.content || "No answer generated."
  };
}