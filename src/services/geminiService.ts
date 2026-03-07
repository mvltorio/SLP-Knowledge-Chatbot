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
  category: string; // This is the FOLDER NAME!
  content: string;
  type: string;
}

// ==================== DATA TYPES ====================

interface FileAnalysis {
  fileName: string;
  fileType: 'csv' | 'word' | 'pdf' | 'unknown';
  category: string; // Add category
  summary: string;
  keyPoints: string[]; // Extract key points instead of full content
  topics: Set<string>;
  fullContent?: string; // Make optional to save tokens
}

interface KnowledgeBase {
  files: FileAnalysis[];
  statistics: {
    totalFiles: number;
    fileTypes: Map<string, number>;
    categories: Map<string, number>; // Track categories/folders
  };
  searchIndex: Map<string, Set<string>>;
}

interface DocumentSearchResult {
  fileName: string;
  category: string;
  relevance: number;
  keyPoints: string[];
  matchedTerms: string[];
  fileType: string;
}

// ==================== UTILITY FUNCTIONS ====================

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/\W+/);
  const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'are', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'how']);
  return new Set(words.filter(w => w.length > 2 && !stopWords.has(w)));
}

// Extract key points from document (first sentences of paragraphs)
function extractKeyPoints(content: string, maxPoints: number = 5): string[] {
  const points: string[] = [];
  const paragraphs = content.split('\n\n');
  
  for (const para of paragraphs) {
    if (points.length >= maxPoints) break;
    
    // Get first sentence of each paragraph
    const firstSentence = para.split(/[.!?]/)[0].trim();
    if (firstSentence.length > 20 && firstSentence.length < 200) {
      points.push(firstSentence);
    }
  }
  
  return points;
}

// ==================== DOCUMENT ANALYSIS ====================

function analyzeWordDocument(doc: KnowledgeDocument): FileAnalysis {
  const content = doc.content;
  
  // Extract key points instead of storing full content
  const keyPoints = extractKeyPoints(content, 5);
  
  // Auto-detect topics
  const topics = new Set<string>();
  const topicPatterns = [
    /\b(proposal|project|program|initiative)\b/gi,
    /\b(fish|aquaculture|tilapia|fishing)\b/gi,
    /\b(farming|agriculture)\b/gi,
    /\b(livelihood|enterprise|business)\b/gi,
    /\b(seed capital|scf|fund)\b/gi,
    /\b(pantawid|4ps)\b/gi,
    /\b(slpa|association)\b/gi
  ];
  
  topicPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(m => topics.add(m.toLowerCase()));
    }
  });
  
  // Add category as a topic
  topics.add(doc.category.toLowerCase());
  
  return {
    fileName: doc.name,
    fileType: 'word',
    category: doc.category,
    summary: content.substring(0, 200).replace(/\n/g, ' ') + '...',
    keyPoints,
    topics,
    fullContent: content // Keep full content but will use selectively
  };
}

function analyzeCSVDocument(doc: KnowledgeDocument): FileAnalysis {
  const content = doc.content;
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0]?.split(',').map(h => h.trim()) || [];
  
  const keyPoints = [
    `CSV with ${lines.length - 1} rows`,
    `Columns: ${headers.slice(0, 5).join(', ')}${headers.length > 5 ? '...' : ''}`
  ];
  
  // Detect topics from headers
  const topics = new Set<string>();
  headers.forEach(header => {
    const words = header.toLowerCase().split(/[\s_]+/);
    words.forEach(word => {
      if (word.length > 3) topics.add(word);
    });
  });
  
  // Add category as a topic
  topics.add(doc.category.toLowerCase());
  
  return {
    fileName: doc.name,
    fileType: 'csv',
    category: doc.category,
    summary: `CSV file with ${headers.length} columns`,
    keyPoints,
    topics,
    fullContent: content
  };
}

// ==================== KNOWLEDGE BUILDING ====================

async function analyzeAllFiles(knowledgeBase: KnowledgeDocument[]): Promise<KnowledgeBase> {
  const kb: KnowledgeBase = {
    files: [],
    statistics: {
      totalFiles: knowledgeBase.length,
      fileTypes: new Map(),
      categories: new Map()
    },
    searchIndex: new Map()
  };
  
  knowledgeBase.forEach((doc: KnowledgeDocument) => {
    const fileType = doc.name.endsWith('.csv') ? 'csv' : 'word';
    
    // Track file types
    kb.statistics.fileTypes.set(fileType, (kb.statistics.fileTypes.get(fileType) || 0) + 1);
    
    // Track categories/folders
    const category = doc.category || 'Uncategorized';
    kb.statistics.categories.set(category, (kb.statistics.categories.get(category) || 0) + 1);
    
    // Analyze file
    let fileAnalysis: FileAnalysis;
    if (fileType === 'csv') {
      fileAnalysis = analyzeCSVDocument(doc);
    } else {
      fileAnalysis = analyzeWordDocument(doc);
    }
    
    kb.files.push(fileAnalysis);
    
    // Build search index with category boost
    const categoryLower = category.toLowerCase();
    
    // Add full category to search index
    if (!kb.searchIndex.has(categoryLower)) {
      kb.searchIndex.set(categoryLower, new Set());
    }
    kb.searchIndex.get(categoryLower)!.add(doc.name);
    
    // Add category words to search index
    categoryLower.split(/[\s_\/\\-]+/).forEach(word => {
      if (word.length > 2) {
        if (!kb.searchIndex.has(word)) {
          kb.searchIndex.set(word, new Set());
        }
        kb.searchIndex.get(word)!.add(doc.name);
      }
    });
    
    // Add topics to search index
    fileAnalysis.topics.forEach(topic => {
      if (!kb.searchIndex.has(topic)) {
        kb.searchIndex.set(topic, new Set());
      }
      kb.searchIndex.get(topic)!.add(doc.name);
    });
  });
  
  return kb;
}

// ==================== SMART SEARCH ====================

async function searchDocuments(
  knowledgeBase: KnowledgeDocument[], 
  query: string,
  kb: KnowledgeBase
): Promise<DocumentSearchResult[]> {
  const results: DocumentSearchResult[] = [];
  const queryLower = query.toLowerCase();
  const queryKeywords = extractKeywords(query);
  
  // Special handling for common terms
  const isProposalQuery = queryLower.includes('proposal');
  const isFishQuery = queryLower.includes('fish') || queryLower.includes('tilapia') || queryLower.includes('aquaculture');
  const isSLPAQuery = queryLower.includes('slpa') || queryLower.includes('association');
  const isPantawidQuery = queryLower.includes('pantawid') || queryLower.includes('4ps');
  
  kb.files.forEach((file: FileAnalysis) => {
    const doc = knowledgeBase.find(d => d.name === file.fileName);
    if (!doc) return;
    
    let relevance = 0;
    const matchedTerms: string[] = [];
    let keyPoints: string[] = [];
    
    // ===== CATEGORY/FOLDER MATCHING (HIGHEST PRIORITY) =====
    const categoryLower = file.category.toLowerCase();
    
    // Direct category match
    if (isProposalQuery && categoryLower.includes('proposal')) {
      relevance += 200;
      matchedTerms.push('📁 IN PROPOSAL FOLDER');
    }
    
    if (isFishQuery && (categoryLower.includes('fish') || categoryLower.includes('aqua'))) {
      relevance += 200;
      matchedTerms.push('📁 IN FISH/FISHERY FOLDER');
    }
    
    if (isPantawidQuery && categoryLower.includes('pantawid')) {
      relevance += 200;
      matchedTerms.push('📁 IN PANTAWID FOLDER');
    }
    
    // Check each query keyword against category
    queryKeywords.forEach(keyword => {
      if (categoryLower.includes(keyword)) {
        relevance += 100;
        matchedTerms.push(`📁 folder:${keyword}`);
      }
    });
    
    // ===== CONTENT MATCHING =====
    const contentLower = doc.content.toLowerCase();
    
    queryKeywords.forEach(keyword => {
      if (contentLower.includes(keyword)) {
        relevance += 20;
        matchedTerms.push(keyword);
        
        // Extract relevant key points
        if (keyPoints.length < 3) {
          const lines = doc.content.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(keyword) && line.length < 200) {
              keyPoints.push(line.trim());
              break;
            }
          }
        }
      }
    });
    
    // Special matching for fish proposals
    if (isProposalQuery && isFishQuery && relevance > 0) {
      relevance += 100; // Boost fish proposals
      matchedTerms.push('🐟 FISH PROPOSAL');
    }
    
    // If no key points found, use file's key points
    if (keyPoints.length === 0) {
      keyPoints = file.keyPoints;
    }
    
    if (relevance > 0) {
      results.push({
        fileName: doc.name,
        category: file.category,
        relevance,
        keyPoints: keyPoints.slice(0, 3),
        matchedTerms: Array.from(new Set(matchedTerms)).slice(0, 5),
        fileType: file.fileType
      });
    }
  });
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

// ==================== COPY REQUEST HANDLER ====================

async function handleCopyRequest(prompt: string, knowledgeBase: KnowledgeDocument[]): Promise<{ text: string; fileDownload?: any }> {
  // Clean the prompt
  const cleanPrompt = prompt.replace(/^(get|copy|of|download)\s+/gi, '').trim();
  
  // Find matching file (case insensitive)
  let matchedFile: KnowledgeDocument | null = null;
  let bestMatch = 0;
  
  for (const doc of knowledgeBase) {
    const fileName = doc.name.toLowerCase();
    const promptLower = cleanPrompt.toLowerCase();
    
    if (fileName.includes(promptLower) || promptLower.includes(fileName)) {
      matchedFile = doc;
      break;
    }
    
    // Simple similarity check
    const similarity = promptLower.split(' ').filter(word => fileName.includes(word)).length;
    if (similarity > bestMatch) {
      bestMatch = similarity;
      matchedFile = doc;
    }
  }
  
  if (matchedFile) {
    const blob = new Blob([matchedFile.content], { type: 'application/msword' });
    const fileDownload = {
      name: matchedFile.name,
      content: matchedFile.content,
      blob: blob,
      url: URL.createObjectURL(blob)
    };
    
    // Show just preview, not full content
    const preview = matchedFile.content.split('\n').slice(0, 10).join('\n');
    
    return {
      text: `## 📄 ${matchedFile.name}\n\n**Category:** ${matchedFile.category}\n\n**Preview:**\n\`\`\`\n${preview}\n\`\`\`\n\n*Click download button for full document.*`,
      fileDownload
    };
  }
  
  // Show available files if no match
  const fileList = knowledgeBase
    .map(doc => `- ${doc.name} (${doc.category})`)
    .join('\n');
  
  return {
    text: `File not found. Available files:\n\n${fileList}\n\nTry: "copy of [filename]"`
  };
}

// ==================== GENERATE RESPONSE ====================

async function generateResponse(
  prompt: string,
  searchResults: DocumentSearchResult[],
  knowledgeBase: KnowledgeDocument[],
  groq: Groq
): Promise<string> {
  
  // Build a concise context
  let context = `USER QUESTION: ${prompt}\n\n`;
  context += `RELEVANT DOCUMENTS (from search):\n\n`;
  
  // Add only the most relevant documents (max 3 to save tokens)
  const topResults = searchResults.slice(0, 3);
  
  for (let i = 0; i < topResults.length; i++) {
    const result = topResults[i];
    const doc = knowledgeBase.find(d => d.name === result.fileName);
    
    context += `DOCUMENT ${i + 1}: ${result.fileName}\n`;
    context += `FOLDER/CATEGORY: ${result.category}\n`;
    context += `RELEVANCE SCORE: ${result.relevance}\n`;
    context += `KEY POINTS:\n`;
    result.keyPoints.forEach(point => context += `- ${point}\n`);
    
    // Add relevant excerpt from the document
    if (doc) {
      // Find paragraphs containing query terms
      const queryTerms = extractKeywords(prompt);
      const paragraphs = doc.content.split('\n\n');
      let relevantPara = '';
      
      for (const para of paragraphs) {
        const paraLower = para.toLowerCase();
        let matches = 0;
        queryTerms.forEach(term => {
          if (paraLower.includes(term)) matches++;
        });
        if (matches >= 1 && para.length < 500) {
          relevantPara = para;
          break;
        }
      }
      
      if (relevantPara) {
        context += `RELEVANT EXCERPT: ${relevantPara.substring(0, 300)}...\n`;
      }
    }
    
    context += '\n';
  }
  
  if (topResults.length === 0) {
    context += "No relevant documents found.\n";
  }
  
  // Use Groq to generate answer
  const completion = await groq.chat.completions.create({
    model: PRIMARY_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an AI assistant that answers questions based ONLY on the provided documents.

IMPORTANT RULES:
1. ONLY use information from the documents shown above
2. Pay attention to FOLDER/CATEGORY names - they tell you what type of document it is
3. If a document is in a "proposal" folder, it IS a proposal even if filename doesn't say it
4. If a document is in a "fish" folder, it IS about fish
5. Be specific - mention which document the information comes from
6. If information is not in the documents, say "I cannot find that information"
7. Keep responses concise and focused on answering the question

The documents are shown above with their folder/category names.`
      },
      {
        role: "user",
        content: `QUESTION: ${prompt}\n\nDOCUMENTS:\n${context}\n\nAnswer based ONLY on these documents:`
      }
    ],
    temperature: 0.1,
    max_tokens: 800 // Reduced to avoid token limits
  });

  return completion.choices?.[0]?.message?.content || "No answer generated.";
}

// ==================== ANALYZE IMAGE FUNCTION ====================

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

// ==================== MAIN EXPORTED FUNCTION ====================

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

  // Handle copy requests
  if (prompt.toLowerCase().includes('copy of') || prompt.toLowerCase().includes('download')) {
    return await handleCopyRequest(prompt, knowledgeBase);
  }

  try {
    // Analyze all files
    const kb = await analyzeAllFiles(knowledgeBase);
    
    // Search for relevant documents
    const searchResults = await searchDocuments(knowledgeBase, prompt, kb);
    
    console.log("Search results:", searchResults.map(r => ({
      file: r.fileName,
      category: r.category,
      relevance: r.relevance,
      terms: r.matchedTerms
    })));
    
    // If no results found
    if (searchResults.length === 0) {
      return {
        text: `I couldn't find any documents related to "${prompt}".\n\nAvailable folders: ${Array.from(kb.statistics.categories.keys()).join(', ')}\n\nTry asking about something in these folders.`
      };
    }
    
    // Initialize Groq
    const groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });
    
    // Generate response
    const answer = await generateResponse(prompt, searchResults, knowledgeBase, groq);
    
    return { text: answer };
    
  } catch (error: any) {
    console.error("Error:", error);
    
    // Handle token limit error
    if (error.status === 413 || (error.error && error.error.code === 'rate_limit_exceeded')) {
      // We need to get searchResults again since it's out of scope
      try {
        // Re-analyze and search to get results for the error message
        const kb = await analyzeAllFiles(knowledgeBase);
        const errorSearchResults = await searchDocuments(knowledgeBase, prompt, kb);
        
        if (errorSearchResults.length > 0) {
          return {
            text: "The response was too large. I'll try to be more concise.\n\n" +
                  "Based on your question, here are the relevant files:\n\n" +
                  errorSearchResults.map(r => `📄 ${r.fileName} (${r.category})\n  - ${r.keyPoints[0] || 'No preview'}`).join('\n\n') +
                  "\n\nYou can ask for a specific file: 'copy of [filename]'"
          };
        }
      } catch (e) {
        // If re-search fails, show generic message
        return {
          text: "The response was too large. Please try a more specific question or ask for a specific file."
        };
      }
    }
    
    return {
      text: "An error occurred. Please try again or rephrase your question."
    };
  }
}