import Groq from "groq-sdk";
import { ChartSpec } from "../types";

// ==================== MODEL CONFIGURATION ====================
const PRIMARY_MODEL = "llama-3.3-70b-versatile"; // Best for complex analysis
const FALLBACK_MODEL = "llama-3.1-8b-instant"; // Faster for simple queries

// ==================== API KEY MANAGEMENT ====================
const getApiKey = (customKey?: string): string => {
  if (customKey && customKey.length > 20) {
    return customKey;
  }

  const envKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!envKey) {
    throw new Error("Groq API key missing in environment variables. Please add VITE_GROQ_API_KEY to your .env file.");
  }
  return envKey;
};

// ==================== FILE READING UTILITY ====================
async function readFileContent(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ==================== TYPE DEFINITIONS ====================
export interface KnowledgeDocument {
  id?: number;
  name: string;
  category: string;
  content: string;
  type: string;
  fileType?: string;
  uploadDate?: Date;
}

interface DocumentAnalysis {
  filename: string;
  documentType: string;
  lines: number;
  words: number;
  years: number[];
  amounts: string[];
  locations: string[];
  topics: string[];
  hasTables: boolean;
  hasNumbers: boolean;
  hasDates: boolean;
  preview: string;
  summary: string;
  potentialColumns: string[];
}

interface QueryAnalysis {
  original: string;
  intent: 'count' | 'comparison' | 'trend' | 'explanation' | 'listing' | 'general';
  years: number[];
  locations: string[];
  topics: string[];
  needsCalculation: boolean;
  comparisonType: string | null;
}

// ==================== API VALIDATION ====================
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

// ==================== DOCUMENT ANALYSIS FUNCTIONS ====================

/**
 * Extract years from content
 */
function extractYears(content: string): number[] {
  const yearMatches = content.match(/\b(19|20)\d{2}\b/g);
  if (!yearMatches) return [];
  
  const years = yearMatches.map(y => parseInt(y));
  return [...new Set(years)].sort((a, b) => a - b);
}

/**
 * Extract locations from content
 */
function extractLocations(content: string): string[] {
  const commonLocations = [
    'manila', 'quezon city', 'caloocan', 'makati', 'taguig', 'pasig',
    'cebu', 'davao', 'bacolod', 'iloilo', 'zamboanga', 'cagayan de oro',
    'luzon', 'visayas', 'mindanao', 'ncr', 'region i', 'region ii', 
    'region iii', 'region iv', 'region v', 'region vi', 'region vii',
    'region viii', 'region ix', 'region x', 'region xi', 'region xii',
    'car', 'caraga', 'armm', 'barmm', 'province', 'municipality', 'city'
  ];
  
  const lowerContent = content.toLowerCase();
  const found: string[] = [];
  
  commonLocations.forEach(location => {
    if (lowerContent.includes(location.toLowerCase())) {
      found.push(location);
    }
  });
  
  return found;
}

/**
 * Extract key topics from content
 */
function extractKeyTopics(content: string): string[] {
  const commonTopics = [
    'pantawid', '4ps', 'cct', 'beneficiaries', 'households',
    'health', 'education', 'nutrition', 'social welfare',
    'poverty', 'assistance', 'grant', 'conditional',
    'municipality', 'province', 'regional', 'national',
    'guidelines', 'policy', 'procedure', 'implementation',
    'budget', 'fund', 'allocation', 'disbursement'
  ];
  
  const lowerContent = content.toLowerCase();
  const topics: string[] = [];
  
  commonTopics.forEach(topic => {
    if (lowerContent.includes(topic)) {
      topics.push(topic);
    }
  });
  
  return topics;
}

/**
 * Extract monetary amounts from content
 */
function extractAmounts(content: string): string[] {
  const amountPatterns = [
    /₱?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g,
    /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g,
    /\b\d+(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|thousand)\b/gi
  ];
  
  const amounts: string[] = [];
  amountPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) amounts.push(...matches);
  });
  
  return amounts.slice(0, 20);
}

/**
 * Detect if content has tables
 */
function hasTabularData(content: string): boolean {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 3) return false;
  
  const delimiters = [',', '\t', '|', ';'];
  for (const d of delimiters) {
    const delimiterCounts = lines.slice(0, 5).map(l => (l.match(new RegExp(`\\${d}`, 'g')) || []).length);
    const avgCount = delimiterCounts.reduce((a, b) => a + b, 0) / delimiterCounts.length;
    if (avgCount >= 2 && delimiterCounts.every(c => Math.abs(c - avgCount) <= 2)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect document type from content
 */
function detectDocumentType(content: string, filename: string): string {
  const lowerContent = content.toLowerCase();
  const lowerFilename = filename.toLowerCase();
  
  if (lowerFilename.includes('guideline') || lowerFilename.includes('guide')) return 'guideline';
  if (lowerFilename.includes('proposal')) return 'proposal';
  if (lowerFilename.includes('report')) return 'report';
  if (lowerFilename.includes('form')) return 'form';
  if (lowerFilename.includes('data') || lowerFilename.includes('stat')) return 'data';
  
  if (lowerContent.includes('guideline') || lowerContent.includes('policy') || lowerContent.includes('procedure')) 
    return 'guideline';
  if (lowerContent.includes('proposal') || lowerContent.includes('objective') || lowerContent.includes('budget')) 
    return 'proposal';
  if (lowerContent.includes('report') || lowerContent.includes('summary') || lowerContent.includes('findings')) 
    return 'report';
  if (lowerContent.includes('form') || lowerContent.includes('application') || lowerContent.includes('registration')) 
    return 'form';
  if (hasTabularData(content)) return 'data';
  
  return 'document';
}

/**
 * Find potential column names in tabular data
 */
function findPotentialColumns(content: string): string[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  const possibleHeaders = lines[0].split(/[,\t|;]/).map(h => h.trim()).filter(h => h.length > 0);
  
  const looksLikeHeaders = possibleHeaders.some(h => /[a-zA-Z]/.test(h)) && 
                          possibleHeaders.length > 1;
  
  if (looksLikeHeaders) {
    return possibleHeaders;
  }
  
  const commonColumns = ['name', 'date', 'year', 'total', 'amount', 'municipality', 'province', 'status'];
  return commonColumns.filter(col => content.toLowerCase().includes(col));
}

/**
 * Analyze any document and extract structured information
 */
function analyzeDocument(content: string, filename: string): DocumentAnalysis {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const words = content.split(/\s+/).length;
  const preview = lines.slice(0, 5).join('\n');
  
  const years = extractYears(content);
  const amounts = extractAmounts(content);
  const locations = extractLocations(content);
  const topics = extractKeyTopics(content);
  const hasTables = hasTabularData(content);
  const hasNumbers = /\d+[,.]?\d*/.test(content);
  const hasDates = (content.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g) || []).length > 0;
  const potentialColumns = findPotentialColumns(content);
  const documentType = detectDocumentType(content, filename);
  
  const summary = `Document: ${filename} | Type: ${documentType} | Lines: ${lines.length} | Words: ${words} | Years: ${years.join(', ') || 'None'} | Topics: ${topics.slice(0, 3).join(', ')}`;
  
  return {
    filename,
    documentType,
    lines: lines.length,
    words,
    years,
    amounts,
    locations,
    topics,
    hasTables,
    hasNumbers,
    hasDates,
    preview,
    summary,
    potentialColumns
  };
}

// ==================== QUERY ANALYSIS FUNCTIONS ====================

/**
 * Detect intent from user query
 */
function detectIntent(query: string): 'count' | 'comparison' | 'trend' | 'explanation' | 'listing' | 'general' {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('how many') || lowerQuery.includes('total') || lowerQuery.includes('sum') || lowerQuery.includes('count')) {
    return 'count';
  }
  if (lowerQuery.includes('compare') || lowerQuery.includes('vs ') || lowerQuery.includes('versus') || lowerQuery.includes('compared to')) {
    return 'comparison';
  }
  if (lowerQuery.includes('trend') || lowerQuery.includes('over time') || lowerQuery.includes('yearly') || lowerQuery.includes('monthly')) {
    return 'trend';
  }
  if (lowerQuery.includes('what is') || lowerQuery.includes('explain') || lowerQuery.includes('tell me about') || lowerQuery.includes('describe')) {
    return 'explanation';
  }
  if (lowerQuery.includes('list') || lowerQuery.includes('show me') || lowerQuery.includes('enumerate')) {
    return 'listing';
  }
  
  return 'general';
}

/**
 * Extract years from query
 */
function extractYearsFromQuery(query: string): number[] {
  const yearMatches = query.match(/\b(19|20)\d{2}\b/g);
  if (!yearMatches) return [];
  
  return yearMatches.map(y => parseInt(y)).sort((a, b) => a - b);
}

/**
 * Check if query needs calculation
 */
function needsCalculation(query: string): boolean {
  const calcWords = ['total', 'sum', 'average', 'mean', 'count', 'how many', 'calculate', 'compute'];
  const lowerQuery = query.toLowerCase();
  return calcWords.some(word => lowerQuery.includes(word));
}

/**
 * Detect comparison type
 */
function detectComparisonType(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('vs') || lowerQuery.includes('versus') || lowerQuery.includes('compared to')) {
    return 'direct';
  }
  if (lowerQuery.includes('difference') || lowerQuery.includes('change')) {
    return 'difference';
  }
  if (lowerQuery.includes('increase') || lowerQuery.includes('decrease') || lowerQuery.includes('growth') || lowerQuery.includes('decline')) {
    return 'trend';
  }
  
  return null;
}

/**
 * Analyze user query to understand what they're asking
 */
function analyzeQuery(query: string): QueryAnalysis {
  const years = extractYearsFromQuery(query);
  const locations = extractLocations(query);
  const topics = extractKeyTopics(query);
  
  // Add query-specific terms to topics
  const words = query.toLowerCase().split(/\s+/);
  words.forEach(word => {
    if (word.length > 4 && !topics.includes(word) && !['what', 'when', 'where', 'which', 'how'].includes(word)) {
      topics.push(word);
    }
  });
  
  return {
    original: query,
    intent: detectIntent(query),
    years,
    locations,
    topics,
    needsCalculation: needsCalculation(query),
    comparisonType: detectComparisonType(query)
  };
}

// ==================== DOCUMENT SELECTION ====================

/**
 * Find most relevant documents based on query
 */
function findRelevantDocuments(query: string, documents: KnowledgeDocument[]): KnowledgeDocument[] {
  const queryAnalysis = analyzeQuery(query);
  
  // Score each document
  const scored = documents.map(doc => {
    const analysis = analyzeDocument(doc.content, doc.name);
    let score = 0;
    
    // Topic matching (weight: 10)
    queryAnalysis.topics.forEach(topic => {
      if (analysis.topics.includes(topic)) score += 10;
      if (doc.content.toLowerCase().includes(topic)) score += 5;
    });
    
    // Year matching (weight: 15)
    queryAnalysis.years.forEach(year => {
      if (analysis.years.includes(year)) score += 15;
    });
    
    // Location matching (weight: 8)
    queryAnalysis.locations.forEach(location => {
      if (analysis.locations.includes(location)) score += 8;
    });
    
    // Document type relevance (weight: 20)
    if (queryAnalysis.needsCalculation && analysis.documentType === 'data') score += 20;
    if (queryAnalysis.intent === 'explanation' && analysis.documentType === 'guideline') score += 20;
    if (queryAnalysis.intent === 'listing' && analysis.documentType === 'report') score += 15;
    
    // Check for numbers if calculation needed (weight: 10)
    if (queryAnalysis.needsCalculation && analysis.hasNumbers) score += 10;
    
    return { doc, score };
  });
  
  // Sort by score and return top documents (minimum score > 0)
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(item => item.score > 0)
    .slice(0, 5)
    .map(item => item.doc);
}

// ==================== COLUMN MATCHING ====================

/**
 * Find columns that match the query terms
 */
function findMatchingColumns(query: string, columns: string[]): {
  exact: string[];
  partial: string[];
  semantic: string[];
} {
  const queryLower = query.toLowerCase();
  const exact: string[] = [];
  const partial: string[] = [];
  const semantic: string[] = [];
  
  const synonymMap: Record<string, string[]> = {
    'pantawid': ['pantawid', '4ps', 'cct', 'conditional', 'cash', 'beneficiaries'],
    'year': ['year', 'yr', 'date', 'period', 'fiscal', 'calendar'],
    'municipality': ['municipality', 'city', 'town', 'lgu', 'local'],
    'amount': ['amount', 'total', 'sum', 'value', 'cost', 'budget'],
    'served': ['served', 'beneficiaries', 'recipients', 'households', 'families']
  };
  
  columns.forEach(column => {
    const colLower = column.toLowerCase();
    
    // Exact match
    if (colLower === queryLower || colLower.includes(queryLower)) {
      exact.push(column);
    }
    // Partial match
    else {
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
      if (queryWords.some(word => colLower.includes(word))) {
        partial.push(column);
      }
      // Semantic match
      else {
        for (const [key, synonyms] of Object.entries(synonymMap)) {
          if (queryLower.includes(key) && synonyms.some(s => colLower.includes(s))) {
            semantic.push(column);
            break;
          }
        }
      }
    }
  });
  
  return { exact, partial, semantic };
}

// ==================== IMAGE ANALYSIS (FALLBACK) ====================

/**
 * Analyze image files by extracting text content or providing metadata
 * Note: Groq doesn't natively support images, so we provide fallback
 */
export async function analyzeImage(file: File, customKey?: string): Promise<string> {
  try {
    const apiKey = getApiKey(customKey);
    
    // Try to extract text from image if it's a text-based file
    const fileContent = await readFileContent(file).catch(() => null);
    
    if (fileContent) {
      // If we could read text content, analyze it
      const groq = new Groq({
        apiKey,
        dangerouslyAllowBrowser: true
      });

      const completion = await groq.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [
          {
            role: "user",
            content: `This appears to be a text file named "${file.name}". Here's its content:\n\n${fileContent.substring(0, 2000)}\n\nPlease summarize what this document contains.`
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      return completion.choices?.[0]?.message?.content || "Could not analyze the image content.";
    }

    // If no text content, return file metadata
    return `[Image File: ${file.name}]
Size: ${(file.size / 1024).toFixed(2)} KB
Type: ${file.type || 'Unknown'}

Note: Groq doesn't support direct image analysis. To analyze the content of this image, you would need to:
1. Extract text from the image using OCR first, or
2. Use a multimodal model like Gemini or GPT-4 Vision

Would you like me to help you with any specific information about this file?`;

  } catch (error) {
    console.error("Image analysis error:", error);
    return `Could not analyze the image file "${file.name}". Please ensure the file is not corrupted.`;
  }
}

// ==================== MAIN GENERATE FUNCTION ====================

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

  // Step 1: Analyze the query
  const queryAnalysis = analyzeQuery(prompt);
  console.log("Query Analysis:", queryAnalysis);

  // Step 2: Find relevant documents
  let relevantDocs: KnowledgeDocument[] = [];

  try {
    // Try RAG search first
    const searchRes = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, limit: 8 })
    });

    if (searchRes.ok) {
      relevantDocs = await searchRes.json();
    }
  } catch (error) {
    console.error("RAG search failed:", error);
  }

  // Fallback to smart selection if RAG fails
  if (!relevantDocs || relevantDocs.length === 0) {
    relevantDocs = findRelevantDocuments(prompt, knowledgeBase);
  }

  // Final fallback - use any docs with content
  if (!relevantDocs || relevantDocs.length === 0) {
    relevantDocs = knowledgeBase
      .filter(doc => doc.content && doc.content.length > 100)
      .slice(0, 5);
  }

  // Step 3: Analyze each document
  const documentAnalyses = relevantDocs.map(doc => ({
    doc,
    analysis: analyzeDocument(doc.content, doc.name)
  }));

  // Step 4: Build context
  const historyContext = chatHistory
    .slice(-5)
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`)
    .join('\n');

  // Find matching columns for data files
  const allColumns = documentAnalyses.flatMap(d => d.analysis.potentialColumns);
  const columnMatches = findMatchingColumns(prompt, allColumns);

  // Build file context
  const fileContext = documentAnalyses.map(({ doc, analysis }) => {
    const columnMatchInfo = analysis.potentialColumns.length > 0 
      ? `\n📊 COLUMNS: ${analysis.potentialColumns.join(', ')}`
      : '';

    return `
====================
📄 FILE: ${doc.name}
📋 TYPE: ${analysis.documentType}
📊 SUMMARY: ${analysis.summary}
${columnMatchInfo}
📅 YEARS: ${analysis.years.join(', ') || 'None found'}
📍 LOCATIONS: ${analysis.locations.join(', ') || 'None found'}
🏷️ TOPICS: ${analysis.topics.slice(0, 5).join(', ') || 'None found'}

🔍 PREVIEW:
${analysis.preview}

📋 FULL CONTENT:
${doc.content}
====================
`;
  }).join('\n\n');

  // Step 5: Create the prompt
  const systemPrompt = `You are an expert **SLP Knowledge Assistant** that can analyze ANY type of document - guidelines, proposals, data tables, reports, forms, etc.

## QUERY ANALYSIS
User Question: "${prompt}"

I've analyzed this query:
- Intent: ${queryAnalysis.intent}
- Years mentioned: ${queryAnalysis.years.join(', ') || 'Any years'}
- Locations mentioned: ${queryAnalysis.locations.join(', ') || 'None'}
- Needs calculation: ${queryAnalysis.needsCalculation ? 'Yes' : 'No'}
- Comparison needed: ${queryAnalysis.comparisonType || 'None'}

## COLUMN MATCHING
${columnMatches.exact.length > 0 ? `✅ Exact column matches: ${columnMatches.exact.join(', ')}` : ''}
${columnMatches.partial.length > 0 ? `🔄 Partial matches: ${columnMatches.partial.join(', ')}` : ''}
${columnMatches.semantic.length > 0 ? `💡 Semantic matches: ${columnMatches.semantic.join(', ')}` : ''}

## CHAT HISTORY
${historyContext}

## AVAILABLE DOCUMENTS
${fileContext}

## YOUR TASK
Based on ALL the documents above, answer the user's question. Follow these steps:

1. **Understand what they're asking** - If they ask for "pantawid" but the column is "is_pantawid", recognize they're the same
2. **Find the information** - Look through ALL documents for relevant data
3. **Do calculations** - If they ask for totals, sum the numbers
4. **Explain your reasoning** - Tell them WHICH document you found it in and HOW you found it
5. **Be specific** - Give exact numbers, years, and locations

## RESPONSE FORMAT
Respond in this EXACT JSON format:

{
  "text": "Your detailed answer here. Include specific numbers and always explain which document you got them from. If you had to match terms (like 'pantawid' to 'is_pantawid'), explain that.",
  "chart": {
    "type": "bar",
    "labels": ["Label1", "Label2"],
    "values": [100, 200],
    "title": "Chart Title"
  }
}

Only include the chart if you're comparing multiple values or showing trends over time.

## IMPORTANT RULES
- If data exists in ANY document, use it
- If you need to match terms, EXPLAIN this in your answer
- If multiple files have relevant info, combine them
- If data is missing, explain what IS available
- Be confident but transparent about your reasoning`;

  try {
    const groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });

    // Try primary model first
    try {
      const completion = await groq.chat.completions.create({
        model: PRIMARY_MODEL,
        messages: [
          {
            role: "system",
            content: "You are an expert data analyst that can understand any document type. Always explain your reasoning and show how you found the information."
          },
          {
            role: "user",
            content: systemPrompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4096
      });

      const responseText = completion.choices?.[0]?.message?.content || "";
      
      // Try to parse JSON response
      try {
        const parsed = JSON.parse(responseText);
        return {
          text: parsed.text || "I found the information but had trouble formatting it.",
          chart: parsed.chart
        };
      } catch {
        // If not valid JSON, return as text
        return { text: responseText };
      }
      
    } catch (primaryError: any) {
      console.warn("Primary model failed, trying fallback:", primaryError);
      
      // Try fallback model
      const fallbackCompletion = await groq.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that analyzes documents."
          },
          {
            role: "user",
            content: `Based on these documents, answer: ${prompt}\n\nDocuments:\n${relevantDocs.map(d => `--- ${d.name} ---\n${d.content.substring(0, 1000)}`).join('\n\n')}`
          }
        ],
        temperature: 0.1,
        max_tokens: 2048
      });
      
      const fallbackResponse = fallbackCompletion.choices?.[0]?.message?.content || "";
      return { text: fallbackResponse };
    }

  } catch (error: any) {
    console.error("Groq API Error:", error);
    
    // User-friendly error message
    const docNames = relevantDocs.map(d => d.name).join(', ');
    return {
      text: `I found these documents that might help: ${docNames || 'No relevant documents found'}. Could you please be more specific about what you're looking for? For example:\n- "How many Pantawid beneficiaries in 2023?"\n- "Show me the guidelines for 4Ps"\n- "What's the total budget for 2024?"`
    };
  }
}