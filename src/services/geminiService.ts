import Groq from "groq-sdk";
import { ChartSpec } from "../types";

// ==================== MODEL CONFIGURATION ====================
const PRIMARY_MODEL = "llama-3.3-70b-versatile"; // Best for complex analysis
const FALLBACK_MODEL = "llama-3.1-8b-instant"; // Faster for simple queries

// ==================== API KEY MANAGEMENT ====================
const getApiKey = (customKey?: string) => {
  if (customKey && customKey.length > 20) {
    return customKey;
  }

  const envKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!envKey) {
    throw new Error("Groq API key missing in environment variables.");
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

export interface KnowledgeDocument {
  id?: number;
  name: string;
  category: string;
  content: string;
  type: string;
  fileType?: string;
  uploadDate?: Date;
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

// ==================== UNIVERSAL DOCUMENT ANALYZER ====================

/**
 * Analyzes ANY document type and extracts meaningful information
 */
function analyzeAnyDocument(content: string, filename: string): any {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const firstFewLines = lines.slice(0, 10).join('\n');
  const lowerContent = content.toLowerCase();
  const lowerFilename = filename.toLowerCase();
  
  // Detect document type based on content patterns
  const documentType = detectDocumentType(content, filename);
  
  // Extract structure information
  const structure = {
    totalLines: lines.length,
    hasTables: detectTables(content),
    hasNumbers: /\d+[,.]?\d*/.test(content),
    hasDates: detectDates(content),
    hasSections: detectSections(content),
    wordCount: content.split(/\s+/).length,
  };
  
  // Find potential data columns (for any tabular data)
  const potentialColumns = findPotentialColumns(content);
  
  // Extract key topics/themes
  const keyTopics = extractKeyTopics(content);
  
  // Find any years mentioned
  const yearsFound = extractYears(content);
  
  // Find any monetary amounts
  const amountsFound = extractAmounts(content);
  
  // Find any locations/places
  const locationsFound = extractLocations(content);
  
  return {
    filename,
    documentType,
    structure,
    data: {
      potentialColumns,
      years: yearsFound,
      amounts: amountsFound,
      locations: locationsFound,
      keyTopics
    },
    preview: firstFewLines,
    summary: generateDocumentSummary(content, filename)
  };
}

/**
 * Detect document type from content
 */
function detectDocumentType(content: string, filename: string): string {
  const lowerContent = content.toLowerCase();
  const lowerFilename = filename.toLowerCase();
  
  // Check filename first
  if (lowerFilename.includes('guideline') || lowerFilename.includes('guide')) return 'guideline';
  if (lowerFilename.includes('proposal')) return 'proposal';
  if (lowerFilename.includes('report')) return 'report';
  if (lowerFilename.includes('form')) return 'form';
  if (lowerFilename.includes('data') || lowerFilename.includes('stat')) return 'data';
  
  // Check content patterns
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
 * Check if content has tabular data
 */
function hasTabularData(content: string): boolean {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 3) return false;
  
  // Check for consistent delimiters
  const delimiterCounts = [',', '\t', '|', ';'].map(d => 
    lines.slice(0, 5).filter(l => l.includes(d)).length
  );
  
  const hasConsistentDelimiter = Math.max(...delimiterCounts) >= 3;
  
  // Check for number patterns
  const hasNumberColumns = lines.some(l => (l.match(/\d+/g) || []).length >= 2);
  
  return hasConsistentDelimiter || hasNumberColumns;
}

/**
 * Detect tables in content
 */
function detectTables(content: string): boolean {
  // Look for table patterns: rows with consistent delimiters and numbers
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 3) return false;
  
  // Check for delimiter consistency
  const delimiters = [',', '\t', '|', ';'];
  for (const d of delimiters) {
    const delimiterCounts = lines.slice(0, 10).map(l => (l.match(new RegExp(`\\${d}`, 'g')) || []).length);
    const avgCount = delimiterCounts.reduce((a, b) => a + b, 0) / delimiterCounts.length;
    if (avgCount >= 2 && delimiterCounts.every(c => Math.abs(c - avgCount) <= 2)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect dates in content
 */
function detectDates(content: string): string[] {
  const datePatterns = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,  // MM/DD/YYYY, DD/MM/YYYY
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi,  // Month DD, YYYY
    /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g,  // YYYY-MM-DD
  ];
  
  const dates: string[] = [];
  datePatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) dates.push(...matches);
  });
  
  return [...new Set(dates)]; // Remove duplicates
}

/**
 * Detect sections in document
 */
function detectSections(content: string): string[] {
  const sectionPatterns = [
    /^#{1,3}\s+(.+)$/gm,  // Markdown headers
    /^([A-Z][A-Z\s]+):$/gm,  // ALL CAPS headers
    /^(\d+\.\s+[A-Z][^.\n]+)/gm,  // Numbered sections
    /^(Introduction|Methodology|Findings|Conclusion|Appendix|References):?$/gim  // Common section names
  ];
  
  const sections: string[] = [];
  sectionPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) sections.push(...matches);
  });
  
  return sections.slice(0, 10); // Limit to 10 sections
}

/**
 * Find potential column names in tabular data
 */
function findPotentialColumns(content: string): string[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  // Try to find a header row
  const possibleHeaders = lines[0].split(/[,\t|;]/).map(h => h.trim()).filter(h => h.length > 0);
  
  // Check if it looks like headers (contains words, not just numbers)
  const looksLikeHeaders = possibleHeaders.some(h => /[a-zA-Z]/.test(h)) && 
                          possibleHeaders.length > 1;
  
  if (looksLikeHeaders) {
    return possibleHeaders;
  }
  
  // Otherwise, look for common column names
  const commonColumns = ['name', 'date', 'year', 'total', 'amount', 'municipality', 'province', 'status'];
  const foundColumns = commonColumns.filter(col => 
    content.toLowerCase().includes(col)
  );
  
  return foundColumns;
}

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
 * Extract monetary amounts
 */
function extractAmounts(content: string): string[] {
  const amountPatterns = [
    /\₱?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g,  // PHP amounts
    /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g,   // USD amounts
    /\b\d+(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|thousand)\b/gi  // Word amounts
  ];
  
  const amounts: string[] = [];
  amountPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) amounts.push(...matches);
  });
  
  return amounts.slice(0, 20);
}

/**
 * Extract locations (crude but effective)
 */
function extractLocations(content: string): string[] {
  // Common Philippine locations
  const locations = [
    'manila', 'quezon city', 'caloocan', 'makati', 'taguig', 'pasig',
    'cebu', 'davao', 'bacolod', 'iloilo', 'zamboanga', 'cagayan de oro',
    'luzon', 'visayas', 'mindanao', 'ncr', 'region'
  ];
  
  const found = locations.filter(loc => 
    content.toLowerCase().includes(loc.toLowerCase())
  );
  
  return found;
}

/**
 * Extract key topics from document
 */
function extractKeyTopics(content: string): string[] {
  const commonTopics = [
    'pantawid', '4ps', 'cct', 'beneficiaries', 'households',
    'health', 'education', 'nutrition', 'social welfare',
    'poverty', 'assistance', 'grant', 'conditional',
    'municipality', 'province', 'regional', 'national'
  ];
  
  const topics: string[] = [];
  commonTopics.forEach(topic => {
    if (content.toLowerCase().includes(topic)) {
      topics.push(topic);
    }
  });
  
  return topics;
}

/**
 * Generate a summary of the document
 */
function generateDocumentSummary(content: string, filename: string): string {
  const analysis = analyzeAnyDocument(content, filename);
  
  let summary = `Document: ${filename}\n`;
  summary += `Type: ${analysis.documentType}\n`;
  summary += `Size: ${analysis.structure.totalLines} lines, ${analysis.structure.wordCount} words\n`;
  
  if (analysis.data.years.length > 0) {
    summary += `Years referenced: ${analysis.data.years.join(', ')}\n`;
  }
  
  if (analysis.data.amounts.length > 0) {
    summary += `Contains financial data: ${analysis.data.amounts.slice(0, 3).join(', ')}...\n`;
  }
  
  if (analysis.data.locations.length > 0) {
    summary += `Locations mentioned: ${analysis.data.locations.join(', ')}\n`;
  }
  
  if (analysis.data.keyTopics.length > 0) {
    summary += `Key topics: ${analysis.data.keyTopics.join(', ')}\n`;
  }
  
  return summary;
}

// ==================== SMART QUERY UNDERSTANDING ====================

/**
 * Understand what the user is asking
 */
function understandQuery(query: string): any {
  const lowerQuery = query.toLowerCase();
  
  return {
    original: query,
    intent: detectIntent(lowerQuery),
    entities: extractEntities(lowerQuery),
    timeRange: extractTimeRange(lowerQuery),
    needsCalculation: needsCalculation(lowerQuery),
    comparisonType: detectComparisonType(lowerQuery),
    targetTopics: extractTargetTopics(lowerQuery)
  };
}

function detectIntent(query: string): string {
  if (query.includes('how many') || query.includes('total') || query.includes('count')) 
    return 'count_or_sum';
  if (query.includes('compare') || query.includes('vs') || query.includes('versus')) 
    return 'comparison';
  if (query.includes('trend') || query.includes('over time') || query.includes('yearly')) 
    return 'trend';
  if (query.includes('what is') || query.includes('explain') || query.includes('tell me about')) 
    return 'explanation';
  if (query.includes('list') || query.includes('show me')) 
    return 'listing';
  return 'general';
}

function extractEntities(query: string): any {
  return {
    years: query.match(/\b(19|20)\d{2}\b/g) || [],
    numbers: query.match(/\b\d+\b/g) || [],
    locations: extractLocations(query),
    topics: extractKeyTopics(query)
  };
}

function extractTimeRange(query: string): any {
  const years = query.match(/\b(19|20)\d{2}\b/g);
  if (!years) return null;
  
  if (years.length >= 2) {
    return {
      type: 'range',
      start: parseInt(years[0]),
      end: parseInt(years[years.length - 1])
    };
  }
  
  return {
    type: 'single',
    year: parseInt(years[0])
  };
}

function needsCalculation(query: string): boolean {
  const calcWords = ['total', 'sum', 'average', 'mean', 'count', 'how many'];
  return calcWords.some(word => query.includes(word));
}

function detectComparisonType(query: string): string | null {
  if (query.includes('vs') || query.includes('versus') || query.includes('compared to'))
    return 'direct';
  if (query.includes('difference') || query.includes('change'))
    return 'difference';
  if (query.includes('increase') || query.includes('decrease') || query.includes('growth'))
    return 'trend';
  return null;
}

function extractTargetTopics(query: string): string[] {
  const topics = extractKeyTopics(query);
  
  // Add specific terms from query
  const words = query.split(/\s+/);
  words.forEach(word => {
    if (word.length > 4 && !topics.includes(word)) {
      topics.push(word);
    }
  });
  
  return topics;
}

// ==================== SMART DOCUMENT SELECTION ====================

/**
 * Find the most relevant documents for a query
 */
function findRelevantDocuments(query: string, documents: KnowledgeDocument[]): KnowledgeDocument[] {
  const queryAnalysis = understandQuery(query);
  const queryTopics = queryAnalysis.targetTopics;
  const queryYears = queryAnalysis.entities.years;
  
  // Score each document
  const scored = documents.map(doc => {
    const analysis = analyzeAnyDocument(doc.content, doc.name);
    let score = 0;
    
    // Topic matching
    queryTopics.forEach(topic => {
      if (analysis.data.keyTopics.includes(topic)) score += 10;
      if (doc.content.toLowerCase().includes(topic)) score += 5;
    });
    
    // Year matching
    queryYears.forEach((year: string) => {
      if (analysis.data.years.includes(parseInt(year))) score += 15;
    });
    
    // Document type relevance
    if (queryAnalysis.needsCalculation && analysis.documentType === 'data') score += 20;
    if (queryAnalysis.intent === 'explanation' && analysis.documentType === 'guideline') score += 20;
    if (queryAnalysis.intent === 'listing' && analysis.documentType === 'report') score += 15;
    
    // Check for numbers/data
    if (queryAnalysis.needsCalculation && analysis.structure.hasNumbers) score += 10;
    
    return { doc, score, analysis };
  });
  
  // Sort by score and return top documents
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(item => item.score > 0)
    .slice(0, 5)
    .map(item => item.doc);
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

  // ===============================
  // STEP 1: UNDERSTAND THE QUERY
  // ===============================
  const queryAnalysis = understandQuery(prompt);
  console.log("Query Analysis:", queryAnalysis);

  // ===============================
  // STEP 2: FIND RELEVANT DOCUMENTS
  // ===============================
  let relevantDocs: KnowledgeDocument[] = [];

  try {
    // Try RAG search first
    const searchRes = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, limit: 10 })
    });

    if (searchRes.ok) {
      relevantDocs = await searchRes.json();
    }
  } catch (error) {
    console.error("RAG search failed:", error);
  }

  // If RAG fails or returns nothing, use smart selection
  if (!relevantDocs || relevantDocs.length === 0) {
    relevantDocs = findRelevantDocuments(prompt, knowledgeBase);
  }

  // If still nothing, use all docs with content
  if (!relevantDocs || relevantDocs.length === 0) {
    relevantDocs = knowledgeBase
      .filter(doc => doc.content && doc.content.length > 100)
      .slice(0, 8);
  }

  // ===============================
  // STEP 3: ANALYZE EACH DOCUMENT
  // ===============================
  const documentAnalyses = relevantDocs.map(doc => ({
    ...doc,
    analysis: analyzeAnyDocument(doc.content, doc.name)
  }));

  // ===============================
  // STEP 4: BUILD SMART CONTEXT
  // ===============================
  const historyContext = chatHistory
    .slice(-8)
    .map(msg => `${msg.role === 'user' ? '👤 User' : '🤖 Assistant'}: ${msg.text}`)
    .join('\n');

  const fileContext = documentAnalyses.map(doc => {
    const a = doc.analysis;
    return `
====================
📄 FILE: ${doc.name}
📋 TYPE: ${a.documentType}
📊 ANALYSIS:
${a.summary}

🔍 KEY DATA FOUND:
- Years: ${a.data.years.join(', ') || 'None found'}
- Locations: ${a.data.locations.join(', ') || 'None found'}
- Topics: ${a.data.keyTopics.join(', ') || 'None found'}
- Has tables: ${a.structure.hasTables ? 'Yes' : 'No'}
- Contains numbers: ${a.structure.hasNumbers ? 'Yes' : 'No'}

📝 PREVIEW:
${a.preview}

📋 FULL CONTENT:
${doc.content}
====================
`;
  }).join('\n\n');

  // ===============================
  // STEP 5: CREATE SMART PROMPT
  // ===============================
  const smartPrompt = `
You are an expert **SLP Knowledge Assistant** that can analyze ANY type of document - guidelines, proposals, data tables, reports, forms, etc.

## QUERY ANALYSIS
User asked: "${prompt}"

I've analyzed this query:
- Intent: ${queryAnalysis.intent}
- Looking for years: ${queryAnalysis.entities.years.join(', ') || 'Any years'}
- Needs calculation: ${queryAnalysis.needsCalculation ? 'Yes' : 'No'}
- Comparison needed: ${queryAnalysis.comparisonType || 'None'}
- Key topics: ${queryAnalysis.targetTopics.join(', ')}

## CHAT HISTORY
${historyContext}

## AVAILABLE DOCUMENTS (MULTIPLE TYPES)
${fileContext}

## YOUR TASK
Based on ALL the documents above, answer the user's question. You need to:

1. **Understand the question** - What is the user really asking?
2. **Find relevant info** - Look through ALL document types
3. **Connect the dots** - Combine info from different files if needed
4. **Do calculations** - Sum, average, or compare numbers when asked
5. **Explain clearly** - Tell the user WHAT you found and HOW you found it

## RESPONSE FORMAT
Respond in this JSON format:

{
  "text": "Your detailed answer here. Include specific numbers and always explain which document you got them from. If you need to match terms (like 'pantawid' matching 'is_pantawid'), explain that.",
  
  "table": [
    {"name": "Item 1", "value": 123},
    {"name": "Item 2", "value": 456}
  ],
  
  "chart": {
    "type": "bar", // or "line", "pie"
    "labels": ["Label1", "Label2"],
    "values": [100, 200],
    "title": "Descriptive title"
  }
}

## IMPORTANT RULES
- If data exists in ANY document, use it
- If you need to match terms (like "pantawid" matching "is_pantawid" column), explain this
- If multiple files have relevant info, combine them
- If data is missing, explain what IS available
- Be confident but transparent about your reasoning
- Include a chart when comparing multiple values
`;

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
            content: smartPrompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4096
      });

      const responseText = completion.choices?.[0]?.message?.content || "";
      return processResponse(responseText);
      
    } catch (primaryError: any) {
      // If primary model fails, try fallback
      console.warn("Primary model failed, trying fallback:", primaryError);
      
      const fallbackCompletion = await groq.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that analyzes documents."
          },
          {
            role: "user",
            content: `Based on these documents, answer: ${prompt}\n\nDocuments:\n${relevantDocs.map(d => d.name + '\n' + d.content.substring(0, 1000)).join('\n\n')}`
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
    
    return {
      text: `I found these documents that might help: ${relevantDocs.map(d => d.name).join(', ')}. Could you please be more specific about what you're looking for?`
    };
  }
}

// ==================== RESPONSE PROCESSING ====================
function processResponse(responseText: string): { text: string; chart?: ChartSpec } {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(responseText);
    return {
      text: parsed.text || "I found the information but had trouble formatting it.",
      chart: parsed.chart
    };
  } catch {
    // If not JSON, return as plain text
    return { text: responseText };
  }
}