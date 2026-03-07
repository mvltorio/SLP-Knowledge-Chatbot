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

// ==================== UTILITY FUNCTIONS ====================

/**
 * Calculate Levenshtein distance between two strings
 */
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

/**
 * Calculate similarity percentage between two strings
 */
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

// ==================== COMPREHENSIVE DATA TYPES ====================

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
}

interface FileAnalysis {
  fileName: string;
  fileType: 'csv' | 'word' | 'unknown';
  rowCount: number;
  columns: ColumnInfo[];
  summary: string;
  keyFindings: string[];
}

interface KnowledgeBase {
  files: FileAnalysis[];
  allColumns: Map<string, ColumnInfo[]>;
  relationships: Array<{
    column1: string;
    column2: string;
    similarity: number;
    files: string[];
  }>;
  statistics: {
    totalFiles: number;
    totalRows: number;
    uniqueColumns: Set<string>;
    columnFrequency: Map<string, number>;
  };
  pantawidData?: {
    columnName: string;
    fileSource: string;
    yesValues: string[];
    noValues: string[];
    count: { yes: number; no: number; unknown: number };
    distribution: Map<string, number>;
  };
  genderData?: {
    columnName: string;
    fileSource: string;
    maleValues: string[];
    femaleValues: string[];
    count: { male: number; female: number; unknown: number };
  };
  locationData?: {
    columnName: string;
    fileSource: string;
    locations: Set<string>;
    counts: Map<string, number>;
  };
}

interface DocumentSearchResult {
  fileName: string;
  relevance: number;
  excerpts: string[];
  containsFish: boolean;
  containsProposal: boolean;
  summary: string;
}

// ==================== FILE ANALYSIS FUNCTIONS ====================

/**
 * Parse CSV content
 */
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = content.split('\n').filter((l: string) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  
  const headers = lines[0].split(',').map((h: string) => h.trim());
  const rows = lines.slice(1).map((line: string) => 
    line.split(',').map((cell: string) => cell.trim())
  );
  
  return { headers, rows };
}

/**
 * Determine data type from values
 */
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

/**
 * Analyze a single column
 */
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
  
  let description = '';
  const headerLower = header.toLowerCase();
  
  if (headerLower.includes('pantawid') || headerLower.includes('4ps') || headerLower.includes('conditional cash')) {
    description = 'Indicates Pantawid Pamilya Program (4Ps) membership status';
  } else if (headerLower.includes('name') || headerLower.includes('beneficiary')) {
    description = 'Name of the person';
  } else if (headerLower.includes('sex') || headerLower.includes('gender')) {
    description = 'Gender of the person';
  } else if (headerLower.includes('barangay') || headerLower.includes('location') || headerLower.includes('address')) {
    description = 'Geographic location or barangay';
  } else if (headerLower.includes('age')) {
    description = 'Age of the person';
  } else if (headerLower.includes('birth') || headerLower.includes('dob')) {
    description = 'Date of birth';
  } else if (headerLower.includes('slpa') || headerLower.includes('association')) {
    description = 'SLPA association or membership';
  } else {
    description = `Column containing ${dataType} data`;
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
    nullCount
  };
}

/**
 * Analyze a Word document
 */
function analyzeWordDocument(doc: KnowledgeDocument): FileAnalysis {
  const lines = doc.content.split('\n');
  const analysis: FileAnalysis = {
    fileName: doc.name,
    fileType: 'word',
    rowCount: lines.length,
    columns: [],
    summary: '',
    keyFindings: []
  };
  
  const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g;
  const names = doc.content.match(namePattern) || [];
  
  const barangayPattern = /Brgy\.?\s*([A-Za-z\s]+)|Barangay\s+([A-Za-z\s]+)/gi;
  const barangays = doc.content.match(barangayPattern) || [];
  
  const slpaPattern = /SLPA|Sustainable Livelihood Program Association/gi;
  const slpaMentions = doc.content.match(slpaPattern) || [];
  
  analysis.keyFindings.push(`Contains approximately ${names.length} names`);
  if (barangays.length > 0) {
    analysis.keyFindings.push(`References barangays: ${Array.from(new Set(barangays)).slice(0, 5).join(', ')}`);
  }
  if (slpaMentions.length > 0) {
    analysis.keyFindings.push(`Contains SLPA-related content`);
  }
  
  analysis.summary = `Word document with ${lines.length} lines. ${analysis.keyFindings.join('. ')}`;
  
  return analysis;
}

/**
 * Analyze all files to build knowledge base
 */
async function analyzeAllFiles(knowledgeBase: KnowledgeDocument[]): Promise<KnowledgeBase> {
  const kb: KnowledgeBase = {
    files: [],
    allColumns: new Map(),
    relationships: [],
    statistics: {
      totalFiles: knowledgeBase.length,
      totalRows: 0,
      uniqueColumns: new Set(),
      columnFrequency: new Map()
    }
  };
  
  knowledgeBase.forEach((doc: KnowledgeDocument) => {
    if (doc.name.endsWith('.csv')) {
      const { headers, rows } = parseCSV(doc.content);
      
      const fileAnalysis: FileAnalysis = {
        fileName: doc.name,
        fileType: 'csv',
        rowCount: rows.length,
        columns: [],
        summary: '',
        keyFindings: []
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
      });
      
      fileAnalysis.summary = `CSV file with ${rows.length} rows and ${headers.length} columns: ${headers.join(', ')}`;
      
      headers.forEach((header: string) => {
        const headerLower = header.toLowerCase();
        
        if (headerLower.includes('pantawid') || headerLower.includes('4ps')) {
          const values = rows.map(row => row[headers.indexOf(header)] || '');
          const yesCount = values.filter(v => 
            v.toLowerCase() === 'yes' || v === '1' || v.toLowerCase().includes('yes')
          ).length;
          const noCount = values.filter(v => 
            v.toLowerCase() === 'no' || v === '0' || v.toLowerCase().includes('no')
          ).length;
          
          kb.pantawidData = {
            columnName: header,
            fileSource: doc.name,
            yesValues: ['yes', '1', 'Yes', 'YES'].filter(v => values.includes(v)),
            noValues: ['no', '0', 'No', 'NO'].filter(v => values.includes(v)),
            count: {
              yes: yesCount,
              no: noCount,
              unknown: rows.length - yesCount - noCount
            },
            distribution: new Map()
          };
          
          fileAnalysis.keyFindings.push(`Contains Pantawid data: ${yesCount} beneficiaries`);
        }
        
        if (headerLower.includes('sex') || headerLower.includes('gender')) {
          const values = rows.map(row => row[headers.indexOf(header)] || '');
          const maleCount = values.filter(v => 
            v.toLowerCase() === 'male' || v === 'm' || v.toLowerCase() === 'man'
          ).length;
          const femaleCount = values.filter(v => 
            v.toLowerCase() === 'female' || v === 'f' || v.toLowerCase() === 'woman'
          ).length;
          
          kb.genderData = {
            columnName: header,
            fileSource: doc.name,
            maleValues: ['male', 'm', 'Male', 'M'],
            femaleValues: ['female', 'f', 'Female', 'F'],
            count: {
              male: maleCount,
              female: femaleCount,
              unknown: rows.length - maleCount - femaleCount
            }
          };
        }
        
        if (headerLower.includes('barangay') || headerLower.includes('location') || headerLower.includes('address')) {
          const values = rows.map(row => row[headers.indexOf(header)] || '').filter(v => v);
          const locations = new Set(values);
          const counts = new Map();
          values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
          
          kb.locationData = {
            columnName: header,
            fileSource: doc.name,
            locations,
            counts
          };
        }
      });
      
      kb.files.push(fileAnalysis);
      
    } else if (doc.name.includes('.doc')) {
      const fileAnalysis = analyzeWordDocument(doc);
      kb.files.push(fileAnalysis);
    }
  });
  
  const allColumnNames = Array.from(kb.statistics.uniqueColumns);
  for (let i = 0; i < allColumnNames.length; i++) {
    for (let j = i + 1; j < allColumnNames.length; j++) {
      const col1 = allColumnNames[i];
      const col2 = allColumnNames[j];
      
      const similarity = calculateSimilarity(col1, col2);
      if (similarity > 80) {
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

/**
 * Generate knowledge summary
 */
function generateKnowledgeSummary(kb: KnowledgeBase): string {
  let summary = `## 📊 Complete Data Analysis\n\n`;
  
  summary += `### 📁 Files Overview\n`;
  summary += `- **Total files:** ${kb.statistics.totalFiles}\n`;
  summary += `- **Total rows of data:** ${kb.statistics.totalRows.toLocaleString()}\n`;
  summary += `- **Unique columns found:** ${kb.statistics.uniqueColumns.size}\n\n`;
  
  if (kb.pantawidData) {
    summary += `\n### 🎯 Pantawid Pamilya Program Data\n`;
    summary += `Found in column: **${kb.pantawidData.columnName}** (from ${kb.pantawidData.fileSource})\n`;
    summary += `- **Pantawid beneficiaries:** ${kb.pantawidData.count.yes}\n`;
    summary += `- **Non-Pantawid:** ${kb.pantawidData.count.no}\n`;
    summary += `- **Unknown status:** ${kb.pantawidData.count.unknown}\n`;
  }
  
  if (kb.genderData) {
    summary += `\n### 👥 Gender Distribution\n`;
    summary += `Found in column: **${kb.genderData.columnName}** (from ${kb.genderData.fileSource})\n`;
    summary += `- **Male:** ${kb.genderData.count.male}\n`;
    summary += `- **Female:** ${kb.genderData.count.female}\n`;
    summary += `- **Unknown:** ${kb.genderData.count.unknown}\n`;
  }
  
  if (kb.locationData) {
    summary += `\n### 📍 Location Data\n`;
    summary += `Found in column: **${kb.locationData.columnName}** (from ${kb.locationData.fileSource})\n`;
    summary += `- **Unique locations:** ${kb.locationData.locations.size}\n`;
  }
  
  return summary;
}

/**
 * Search through all documents for specific topics
 */
async function searchDocuments(knowledgeBase: KnowledgeDocument[], query: string): Promise<DocumentSearchResult[]> {
  const results: DocumentSearchResult[] = [];
  const queryLower = query.toLowerCase();
  
  // Determine what we're looking for
  const searchTerms = {
    fish: ['fish', 'fishing', 'aquaculture', 'tilapia', 'bangus', 'milkfish', 'aquatic'],
    proposal: ['proposal', 'project', 'program', 'intervention', 'livelihood', 'enterprise'],
    slp: ['slp', 'sustainable livelihood', 'livelihood program', 'slpa']
  };
  
  // Check if query is about fish
  const isFishQuery = queryLower.includes('fish') || 
                      queryLower.includes('fishing') || 
                      queryLower.includes('aquaculture');
  
  // Check if query is about proposals
  const isProposalQuery = queryLower.includes('proposal') || 
                          queryLower.includes('project') || 
                          queryLower.includes('program');
  
  knowledgeBase.forEach((doc: KnowledgeDocument) => {
    // Skip CSV files for content search (they're for data, not proposals)
    if (doc.name.endsWith('.csv')) return;
    
    const contentLower = doc.content.toLowerCase();
    const excerpts: string[] = [];
    
    // Check relevance
    let relevance = 0;
    let containsFish = false;
    let containsProposal = false;
    
    // Search for fish-related terms
    searchTerms.fish.forEach(term => {
      if (contentLower.includes(term)) {
        relevance += 10;
        containsFish = true;
        
        // Extract context around the term
        const index = contentLower.indexOf(term);
        const start = Math.max(0, index - 50);
        const end = Math.min(contentLower.length, index + 50);
        excerpts.push(`...${doc.content.substring(start, end)}...`);
      }
    });
    
    // Search for proposal-related terms
    searchTerms.proposal.forEach(term => {
      if (contentLower.includes(term)) {
        relevance += 10;
        containsProposal = true;
      }
    });
    
    // Search for SLP terms
    searchTerms.slp.forEach(term => {
      if (contentLower.includes(term)) {
        relevance += 5;
      }
    });
    
    // If relevant, add to results
    if (relevance > 0) {
      // Generate a summary (first 200 chars)
      const summary = doc.content.substring(0, 200).replace(/\n/g, ' ') + '...';
      
      results.push({
        fileName: doc.name,
        relevance,
        excerpts: excerpts.slice(0, 3), // Limit to 3 excerpts
        containsFish,
        containsProposal,
        summary
      });
    }
  });
  
  // Sort by relevance (highest first)
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Answer query based on knowledge base
 */
async function answerQuery(prompt: string, kb: KnowledgeBase): Promise<{ text: string; chart?: ChartSpec }> {
  const promptLower = prompt.toLowerCase();
  
  if (promptLower.includes('pantawid') || promptLower.includes('4ps') || promptLower.includes('served')) {
    if (kb.pantawidData) {
      const data = kb.pantawidData;
      
      let response = `## 🎯 Pantawid Pamilya Program Analysis\n\n`;
      response += `Based on analysis of your files:\n\n`;
      response += `### 📊 Summary\n`;
      response += `- **Total beneficiaries:** ${data.count.yes + data.count.no + data.count.unknown}\n`;
      response += `- **Pantawid beneficiaries served:** ${data.count.yes}\n`;
      response += `- **Non-Pantawid beneficiaries:** ${data.count.no}\n`;
      response += `- **Unknown status:** ${data.count.unknown}\n\n`;
      
      response += `### 📁 Data Source\n`;
      response += `Column "${data.columnName}" in file: **${data.fileSource}**\n`;
      
      const chartData = [
        { name: 'Pantawid', value: data.count.yes },
        { name: 'Non-Pantawid', value: data.count.no },
        { name: 'Unknown', value: data.count.unknown }
      ].filter(item => item.value > 0);
      
      const chart: ChartSpec = {
        chartType: 'pie',
        title: 'Pantawid Pamilya Program Distribution',
        data: chartData,
        dataKey: 'value'
      };
      
      return { text: response, chart };
    } else {
      let response = `## 🔍 Pantawid Data Search\n\n`;
      response += `I couldn't find a specific "Pantawid" column in your files.\n\n`;
      response += `### 📁 Available Data:\n\n`;
      response += generateKnowledgeSummary(kb);
      
      return { text: response };
    }
  }
  
  if (promptLower.includes('gender') || promptLower.includes('male') || promptLower.includes('female')) {
    if (kb.genderData) {
      const data = kb.genderData;
      
      let response = `## 👥 Gender Distribution\n\n`;
      response += `- **Male:** ${data.count.male}\n`;
      response += `- **Female:** ${data.count.female}\n`;
      response += `- **Unknown:** ${data.count.unknown}\n`;
      response += `- **Total:** ${data.count.male + data.count.female + data.count.unknown}\n\n`;
      response += `Source: ${data.fileSource} (column: ${data.columnName})`;
      
      const chartData = [
        { name: 'Male', value: data.count.male },
        { name: 'Female', value: data.count.female },
        { name: 'Unknown', value: data.count.unknown }
      ].filter(item => item.value > 0);
      
      const chart: ChartSpec = {
        chartType: 'pie',
        title: 'Gender Distribution',
        data: chartData,
        dataKey: 'value'
      };
      
      return { text: response, chart };
    }
  }
  
  return { text: generateKnowledgeSummary(kb) };
}

/**
 * Answer queries that might require searching document content
 */
async function answerQueryWithSearch(prompt: string, kb: KnowledgeBase, knowledgeBase: KnowledgeDocument[]): Promise<{ text: string; chart?: ChartSpec }> {
  const promptLower = prompt.toLowerCase();
  
  // Check if this is a fish proposal query
  if (promptLower.includes('fish') || promptLower.includes('proposal') || promptLower.includes('project')) {
    
    // Search all documents
    const searchResults = await searchDocuments(knowledgeBase, prompt);
    
    if (searchResults.length > 0) {
      let response = `## 🐟 Fish-Related Proposals Found\n\n`;
      response += `I searched through all ${knowledgeBase.length} files and found ${searchResults.length} relevant documents:\n\n`;
      
      searchResults.forEach((result, index) => {
        response += `### ${index + 1}. ${result.fileName}\n`;
        response += `**Relevance Score:** ${result.relevance}\n`;
        
        if (result.containsFish && result.containsProposal) {
          response += `✅ **Contains both fish AND proposal content**\n`;
        } else if (result.containsFish) {
          response += `🐟 **Contains fish-related content**\n`;
        } else if (result.containsProposal) {
          response += `📝 **Contains proposal-related content**\n`;
        }
        
        response += `\n**Summary:**\n${result.summary}\n\n`;
        
        if (result.excerpts.length > 0) {
          response += `**Relevant Excerpts:**\n`;
          result.excerpts.forEach(excerpt => {
            response += `> "${excerpt}"\n\n`;
          });
        }
        
        response += `---\n\n`;
      });
      
      // If no fish proposals but other fish content
      const fishProposals = searchResults.filter(r => r.containsFish && r.containsProposal);
      if (fishProposals.length === 0) {
        response += `\n### 💡 Note\n`;
        response += `I found fish-related content but no specific proposals. Would you like me to:\n`;
        response += `- Show all fish-related documents\n`;
        response += `- Search for other livelihood proposals\n`;
        response += `- Focus on a specific type of fish program\n`;
      }
      
      return { text: response };
    } else {
      // No results found
      let response = `## 🔍 Fish Proposal Search\n\n`;
      response += `I searched through all ${knowledgeBase.length} files but couldn't find any proposals related to fish.\n\n`;
      
      // List all files that were searched
      response += `### 📁 Files Searched:\n`;
      knowledgeBase.forEach(doc => {
        if (!doc.name.endsWith('.csv')) {
          response += `- ${doc.name}\n`;
        }
      });
      
      response += `\n### 💡 Suggestions:\n`;
      response += `- Try uploading fish-related proposal documents\n`;
      response += `- Search for other livelihood programs (e.g., "poultry", "vegetable", "small business")\n`;
      response += `- Check if the proposals are in a different format\n`;
      
      return { text: response };
    }
  }
  
  // For other queries, use the existing answerQuery function
  return answerQuery(prompt, kb);
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

    return `[File: ${file.name}]
Size: ${(file.size / 1024).toFixed(2)} KB
Type: ${file.type || 'Unknown'}`;

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

  // Analyze all files for structure (CSV analysis)
  const kb = await analyzeAllFiles(knowledgeBase);
  
  // Check if this is a search query that needs content analysis
  const promptLower = prompt.toLowerCase();
  const needsContentSearch = 
    promptLower.includes('proposal') || 
    promptLower.includes('project') || 
    promptLower.includes('program') ||
    promptLower.includes('fish') ||
    promptLower.includes('livelihood') ||
    promptLower.includes('document') ||
    promptLower.includes('file');
  
  let result;
  if (needsContentSearch) {
    // Use search that looks inside document content
    result = await answerQueryWithSearch(prompt, kb, knowledgeBase);
  } else {
    // Use structural analysis (for data questions)
    result = await answerQuery(prompt, kb);
  }
  
  return {
    text: result.text,
    chart: result.chart
  };
}