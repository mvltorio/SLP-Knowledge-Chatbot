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

// ==================== TYPE DEFINITIONS ====================
interface NameMatch {
  matchedName: string;
  similarity: number;
  location?: string;
  source: string;
}

interface NameCheckResult {
  searchedName: string;
  found: boolean;
  matches: NameMatch[];
  bestMatch?: NameMatch;
}

interface NameCheckSummary {
  totalSearched: number;
  totalFound: number;
  notFound: string[];
  potentialDuplicates: Array<{
    name: string;
    possibleMatches: string[];
  }>;
}

interface NameCheckResponse {
  results: NameCheckResult[];
  summary: NameCheckSummary;
}

interface StructuredName {
  name: string;
  location: string;
  gender: string;
  source: string;
  type: 'csv' | 'word';
}

interface SLPMember {
  name: string;
  barangay: string;
  slpa: string;
  gender: string;
  source: string;
}

interface BarangayStats {
  male: number;
  female: number;
  unknown: number;
  total: number;
}

interface CrossReferenceResult {
  participants: StructuredName[];
  slpas: SLPMember[];
  locations: Set<string>;
  genderCount: {
    male: number;
    female: number;
    unknown: number;
  };
  barangayStats: Record<string, BarangayStats>;
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

// ==================== LEVENSHTEIN DISTANCE FOR FUZZY MATCHING ====================

/**
 * Calculate Levenshtein distance between two strings
 * Lower number = more similar (0 means identical)
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity percentage between two strings
 * 100% = identical, 0% = completely different
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

/**
 * Find best match for a name in a list of names using fuzzy matching
 */
function findBestMatch(
  searchName: string, 
  nameList: string[], 
  threshold: number = 70
): { match: string | null; similarity: number; index: number } {
  if (!searchName || nameList.length === 0) {
    return { match: null, similarity: 0, index: -1 };
  }
  
  let bestMatch = { match: null as string | null, similarity: 0, index: -1 };
  
  nameList.forEach((name, index) => {
    const similarity = calculateSimilarity(searchName, name);
    if (similarity > bestMatch.similarity && similarity >= threshold) {
      bestMatch = { match: name, similarity, index };
    }
  });
  
  return bestMatch;
}

/**
 * Check for duplicate names in a list using fuzzy matching
 */
function findDuplicates(
  names: string[], 
  threshold: number = 85
): Array<{ original: string; duplicates: string[]; similarity: number }> {
  const duplicates: Array<{ original: string; duplicates: string[]; similarity: number }> = [];
  const processed = new Set<number>();
  
  for (let i = 0; i < names.length; i++) {
    if (processed.has(i)) continue;
    
    const currentName = names[i];
    const currentDuplicates: string[] = [];
    let highestSimilarity = 0;
    
    for (let j = i + 1; j < names.length; j++) {
      if (processed.has(j)) continue;
      
      const similarity = calculateSimilarity(currentName, names[j]);
      if (similarity >= threshold) {
        currentDuplicates.push(names[j]);
        processed.add(j);
        highestSimilarity = Math.max(highestSimilarity, similarity);
      }
    }
    
    if (currentDuplicates.length > 0) {
      duplicates.push({
        original: currentName,
        duplicates: currentDuplicates,
        similarity: highestSimilarity
      });
    }
    
    processed.add(i);
  }
  
  return duplicates;
}

// ==================== NAME EXTRACTION ====================

/**
 * Extract all names from documents
 */
function extractAllNames(documents: KnowledgeDocument[]): string[] {
  const names: string[] = [];
  const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g;
  
  documents.forEach((doc: KnowledgeDocument) => {
    const matches = doc.content.match(namePattern) || [];
    matches.forEach((name: string) => {
      if (name.length > 5 && 
          !name.includes('Document') && 
          !name.includes('Microsoft') &&
          !name.includes('Word') &&
          !name.includes('Excel')) {
        names.push(name);
      }
    });
  });
  
  return names;
}

/**
 * Extract names with their associated data (location, gender, etc.)
 */
function extractStructuredNames(documents: KnowledgeDocument[]): StructuredName[] {
  const structuredNames: StructuredName[] = [];
  
  documents.forEach((doc: KnowledgeDocument) => {
    const lines: string[] = doc.content.split('\n');
    
    // Try to parse CSV structure
    if (doc.name.endsWith('.csv')) {
      const headers: string[] = lines[0]?.split(',').map((h: string) => h.trim()) || [];
      const nameColIndex: number = headers.findIndex((h: string) => 
        h.toLowerCase().includes('name') || 
        h.toLowerCase().includes('beneficiary') ||
        h.toLowerCase().includes('participant')
      );
      
      const locationColIndex: number = headers.findIndex((h: string) => 
        h.toLowerCase().includes('location') ||
        h.toLowerCase().includes('municipality') ||
        h.toLowerCase().includes('barangay')
      );
      
      const genderColIndex: number = headers.findIndex((h: string) => 
        h.toLowerCase().includes('sex') ||
        h.toLowerCase().includes('gender')
      );
      
      if (nameColIndex >= 0) {
        for (let i = 1; i < Math.min(lines.length, 100); i++) {
          const row: string[] = lines[i].split(',').map((c: string) => c.trim());
          if (row[nameColIndex] && row[nameColIndex].length > 3) {
            structuredNames.push({
              name: row[nameColIndex],
              location: locationColIndex >= 0 ? row[locationColIndex] : 'unknown',
              gender: genderColIndex >= 0 ? row[genderColIndex] : 'unknown',
              source: doc.name,
              type: 'csv'
            });
          }
        }
      }
    } 
    // Try to parse Word documents for names
    else if (doc.name.includes('.doc')) {
      const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g;
      const matches: string[] = doc.content.match(namePattern) || [];
      
      // Try to extract barangay from content
      let currentBarangay: string = 'unknown';
      const barangayMatch: RegExpMatchArray | null = doc.content.match(/Brgy\.?\s*([A-Za-z]+)/i) ||
                           doc.content.match(/Barangay\s+([A-Za-z]+)/i);
      if (barangayMatch) {
        currentBarangay = barangayMatch[1];
      }
      
      matches.forEach((name: string) => {
        if (name.length > 5 && 
            !name.includes('Document') && 
            !name.includes('Microsoft')) {
          structuredNames.push({
            name,
            location: currentBarangay,
            gender: 'unknown',
            source: doc.name,
            type: 'word'
          });
        }
      });
    }
  });
  
  return structuredNames;
}

// ==================== NAME CHECKING FUNCTION ====================

/**
 * Check if a list of names are served in SLP
 */
export async function checkNamesInSLP(
  namesToCheck: string[],
  documents: KnowledgeDocument[]
): Promise<NameCheckResponse> {
  const allNames: StructuredName[] = extractStructuredNames(documents);
  const nameList: string[] = allNames.map((n: StructuredName) => n.name);
  
  const results: NameCheckResult[] = [];
  const notFound: string[] = [];
  
  for (const searchName of namesToCheck) {
    const matches: NameMatch[] = [];
    
    allNames.forEach((item: StructuredName) => {
      const similarity: number = calculateSimilarity(searchName, item.name);
      if (similarity >= 70) {
        matches.push({
          matchedName: item.name,
          similarity,
          location: item.location,
          source: item.source
        });
      }
    });
    
    matches.sort((a: NameMatch, b: NameMatch) => b.similarity - a.similarity);
    
    const found: boolean = matches.length > 0;
    if (!found) {
      notFound.push(searchName);
    }
    
    results.push({
      searchedName: searchName,
      found,
      matches: matches.slice(0, 5),
      bestMatch: matches[0]
    });
  }
  
  const potentialDuplicates = findDuplicates(nameList, 85).map(d => ({
    name: d.original,
    possibleMatches: d.duplicates
  }));
  
  return {
    results,
    summary: {
      totalSearched: namesToCheck.length,
      totalFound: results.filter((r: NameCheckResult) => r.found).length,
      notFound,
      potentialDuplicates
    }
  };
}

// ==================== SMART DATA EXTRACTION ====================

/**
 * Parse CSV content
 */
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = content.split('\n').filter((l: string) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  
  const headers: string[] = lines[0].split(',').map((h: string) => h.trim());
  const rows: string[][] = lines.slice(1).map((line: string) => 
    line.split(',').map((cell: string) => cell.trim())
  );
  
  return { headers, rows };
}

/**
 * Extract SLPA member data from Word documents
 */
function extractSLPMembers(content: string, filename: string): SLPMember[] {
  const members: SLPMember[] = [];
  
  // Try to extract barangay from filename or content
  let currentBarangay: string = 'unknown';
  const barangayMatch: RegExpMatchArray | null = filename.match(/([A-Za-z]+)\s+(?:Dilasag|Aurora)/i) || 
                       content.match(/Brgy\.?\s*([A-Za-z]+)/i) ||
                       content.match(/Barangay\s+([A-Za-z]+)/i);
  
  if (barangayMatch) {
    currentBarangay = barangayMatch[1];
  }
  
  // Try to extract SLPA name
  let currentSLPAName: string = 'unknown';
  const slpaNameMatch: RegExpMatchArray | null = content.match(/([A-Z\s]+SLPA)/i);
  if (slpaNameMatch) {
    currentSLPAName = slpaNameMatch[1];
  }
  
  // Look for names
  const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g;
  const names: string[] = content.match(namePattern) || [];
  
  // Simple gender detection
  const femaleIndicators: string[] = ['Florita', 'Merlinda', 'Raquel', 'Jerryrose', 'Winie', 'Elma', 'Marjory', 'Julie', 'Carmelita', 'Prescilla', 'Maria', 'Rose', 'Ann', 'Lyn'];
  const maleIndicators: string[] = ['Nonilon', 'Bernardo', 'Rodel', 'Gabriel', 'Juan', 'Pedro', 'Jose', 'Manuel', 'Carlos'];
  
  names.forEach((name: string) => {
    if (name.length > 5 && !name.includes('Document') && !name.includes('Microsoft') && !name.includes('Word')) {
      let gender: string = 'unknown';
      const firstName: string = name.split(' ')[0];
      
      if (femaleIndicators.some((i: string) => firstName.includes(i))) {
        gender = 'female';
      } else if (maleIndicators.some((i: string) => firstName.includes(i))) {
        gender = 'male';
      }
      
      members.push({
        name,
        barangay: currentBarangay,
        slpa: currentSLPAName,
        gender,
        source: filename
      });
    }
  });
  
  return members;
}

/**
 * Cross-reference data between different document types
 */
function crossReferenceData(documents: KnowledgeDocument[], query: string): CrossReferenceResult {
  const result: CrossReferenceResult = {
    participants: [],
    slpas: [],
    locations: new Set<string>(),
    genderCount: { male: 0, female: 0, unknown: 0 },
    barangayStats: {}
  };
  
  // Extract location from query if present
  let targetLocation: string = '';
  const locationMatch: RegExpMatchArray | null = query.match(/(?:in|at)\s+([A-Za-z\s]+?)(?:\s+aurora|\s*$)/i) ||
                       query.match(/([A-Za-z\s]+?)\s+aurora/i);
  if (locationMatch) {
    targetLocation = locationMatch[1].toLowerCase().trim();
  }
  
  // Separate CSV and Word docs
  const csvDocs: KnowledgeDocument[] = documents.filter((d: KnowledgeDocument) => d.name.endsWith('.csv'));
  const wordDocs: KnowledgeDocument[] = documents.filter((d: KnowledgeDocument) => d.name.includes('.doc'));
  
  // Process CSV for participant data
  csvDocs.forEach((doc: KnowledgeDocument) => {
    const { headers, rows } = parseCSV(doc.content);
    
    const locationCol: number = headers.findIndex((h: string) => 
      h.toLowerCase().includes('location') || 
      h.toLowerCase().includes('municipality') || 
      h.toLowerCase().includes('barangay') ||
      h.toLowerCase().includes('address')
    );
    
    const sexCol: number = headers.findIndex((h: string) => 
      h.toLowerCase().includes('sex') || 
      h.toLowerCase().includes('gender')
    );
    
    const nameCol: number = headers.findIndex((h: string) => 
      h.toLowerCase().includes('name') || 
      h.toLowerCase().includes('beneficiary') ||
      h.toLowerCase().includes('participant')
    );
    
    rows.forEach((row: string[]) => {
      let locationMatch: boolean = true;
      if (targetLocation && locationCol >= 0) {
        const rowLocation: string = (row[locationCol] || '').toLowerCase();
        locationMatch = rowLocation.includes(targetLocation) ||
                       calculateSimilarity(rowLocation, targetLocation) > 80;
      }
      
      if (locationMatch) {
        const gender: string = sexCol >= 0 ? (row[sexCol] || '').toLowerCase() : 'unknown';
        const name: string = nameCol >= 0 ? (row[nameCol] || 'Unknown') : 'Unknown';
        
        const participant: StructuredName = {
          name,
          gender,
          location: locationCol >= 0 ? (row[locationCol] || 'unknown') : 'unknown',
          source: doc.name,
          type: 'csv'
        };
        
        result.participants.push(participant);
        
        if (gender.includes('female') || gender.includes('woman') || gender === 'f') {
          result.genderCount.female++;
        } else if (gender.includes('male') || gender.includes('man') || gender === 'm') {
          result.genderCount.male++;
        } else {
          result.genderCount.unknown++;
        }
        
        if (locationCol >= 0 && row[locationCol]) {
          result.locations.add(row[locationCol]);
        }
      }
    });
  });
  
  // Process Word docs for SLPA member data
  wordDocs.forEach((doc: KnowledgeDocument) => {
    const members: SLPMember[] = extractSLPMembers(doc.content, doc.name);
    
    members.forEach((member: SLPMember) => {
      let locationMatch: boolean = true;
      if (targetLocation) {
        const memberLocation: string = (member.barangay || '').toLowerCase();
        locationMatch = memberLocation.includes(targetLocation) ||
                       calculateSimilarity(memberLocation, targetLocation) > 80;
      }
      
      if (locationMatch) {
        result.slpas.push(member);
        
        if (member.barangay) {
          if (!result.barangayStats[member.barangay]) {
            result.barangayStats[member.barangay] = { male: 0, female: 0, unknown: 0, total: 0 };
          }
          
          if (member.gender === 'male') {
            result.barangayStats[member.barangay].male++;
            result.genderCount.male++;
          } else if (member.gender === 'female') {
            result.barangayStats[member.barangay].female++;
            result.genderCount.female++;
          } else {
            result.barangayStats[member.barangay].unknown++;
            result.genderCount.unknown++;
          }
          
          result.barangayStats[member.barangay].total++;
        }
      }
    });
  });
  
  return result;
}

// ==================== CHART CREATION ====================

/**
 * Creates a chart specification based on the data
 * Matches the ChartSpec type from your types file
 */
function createChartSpec(data: CrossReferenceResult, location: string): ChartSpec | undefined {
  if (data.genderCount.male === 0 && data.genderCount.female === 0) {
    return undefined;
  }

  // Create chart data array of { name: string, value: number } objects
  const chartData: Array<{ name: string; value: number }> = [
    { name: 'Male', value: data.genderCount.male },
    { name: 'Female', value: data.genderCount.female },
    { name: 'Unknown', value: data.genderCount.unknown }
  ].filter((item: { name: string; value: number }) => item.value > 0); // Only include categories with data

  // Choose chart type based on data characteristics
  let chartType: 'bar' | 'pie' | 'line' = 'bar';
  
  // If we have few categories, use pie chart for better visualization
  if (chartData.length <= 5) {
    chartType = 'pie';
  }

  const chartSpec: ChartSpec = {
    chartType: chartType,
    title: `Gender Distribution${location ? ` in ${location}` : ''}`,
    data: chartData,
    dataKey: 'value'
  };

  return chartSpec;
}

// ==================== IMAGE ANALYSIS ====================

export async function analyzeImage(file: File, customKey?: string): Promise<string> {
  try {
    const apiKey = getApiKey(customKey);
    
    const fileContent: string | null = await readFileContent(file).catch(() => null);
    
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
Type: ${file.type || 'Unknown'}

To analyze this file's content, it would need to be a text-based format.`;

  } catch (error) {
    console.error("File analysis error:", error);
    return `Could not analyze the file "${file.name}".`;
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

  // Check if this is a name checking query
  const isNameCheckQuery: boolean = prompt.toLowerCase().includes('check these names') ||
                           prompt.toLowerCase().includes('check if') ||
                           prompt.toLowerCase().includes('are served') ||
                           prompt.toLowerCase().includes('verify these names');

  if (isNameCheckQuery) {
    // Extract names from the prompt
    const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g;
    const namesToCheck: string[] = prompt.match(namePattern) || [];
    
    if (namesToCheck.length > 0) {
      const nameCheckResult: NameCheckResponse = await checkNamesInSLP(namesToCheck, knowledgeBase);
      
      // Format the response
      let response: string = `## Name Verification Results\n\n`;
      
      nameCheckResult.results.forEach((result: NameCheckResult) => {
        if (result.found && result.bestMatch) {
          response += `✅ **${result.searchedName}** - FOUND (${result.bestMatch.similarity.toFixed(1)}% match)\n`;
          response += `   Matched with: "${result.bestMatch.matchedName}"\n`;
          if (result.bestMatch.location) {
            response += `   Location: ${result.bestMatch.location}\n`;
          }
          response += `   Source: ${result.bestMatch.source}\n\n`;
        } else {
          response += `❌ **${result.searchedName}** - NOT FOUND\n`;
          if (result.matches.length > 0) {
            response += `   Similar names found:\n`;
            result.matches.slice(0, 3).forEach((m: NameMatch) => {
              response += `   • "${m.matchedName}" (${m.similarity.toFixed(1)}% similar)\n`;
            });
          }
          response += '\n';
        }
      });
      
      response += `\n### Summary\n`;
      response += `- Total names checked: ${nameCheckResult.summary.totalSearched}\n`;
      response += `- Found: ${nameCheckResult.summary.totalFound}\n`;
      response += `- Not found: ${nameCheckResult.summary.notFound.length}\n`;
      
      if (nameCheckResult.summary.potentialDuplicates.length > 0) {
        response += `\n### Potential Duplicates in Database\n`;
        nameCheckResult.summary.potentialDuplicates.slice(0, 5).forEach(d => {
          response += `- "${d.name}" may be duplicate with: ${d.possibleMatches.join(', ')}\n`;
        });
      }
      
      return { text: response };
    }
  }

  // Regular query processing
  const crossReferenced: CrossReferenceResult = crossReferenceData(knowledgeBase, prompt);
  
  // Extract location for chart title
  let location: string = '';
  const locationMatch: RegExpMatchArray | null = prompt.match(/(?:in|at)\s+([A-Za-z\s]+?)(?:\s+aurora|\s*$)/i) ||
                       prompt.match(/([A-Za-z\s]+?)\s+aurora/i);
  if (locationMatch) {
    location = locationMatch[1].trim();
  }
  
  // Create chart if there's gender data
  const chart: ChartSpec | undefined = createChartSpec(crossReferenced, location);
  
  // Build context for the AI
  const context: string = `
## Data Summary
- Total participants found: ${crossReferenced.participants.length}
- Total SLPA members found: ${crossReferenced.slpas.length}
- Locations found: ${Array.from(crossReferenced.locations).join(', ') || 'Dilasag, Aurora'}
- Gender breakdown: 
  - Male: ${crossReferenced.genderCount.male}
  - Female: ${crossReferenced.genderCount.female}
  - Unknown: ${crossReferenced.genderCount.unknown}

## Barangay Statistics
${Object.entries(crossReferenced.barangayStats).map(([barangay, stats]) => 
  `- ${barangay}: ${(stats as BarangayStats).total} total (Male: ${(stats as BarangayStats).male}, Female: ${(stats as BarangayStats).female})`
).join('\n')}

## Data Sources
- CSV files: ${knowledgeBase.filter((d: KnowledgeDocument) => d.name.endsWith('.csv')).map((d: KnowledgeDocument) => d.name).join(', ')}
- Word documents: ${knowledgeBase.filter((d: KnowledgeDocument) => d.name.includes('.doc')).map((d: KnowledgeDocument) => d.name).join(', ')}
`;

  const systemPrompt: string = `You are an expert SLP data analyst. Based on the provided data, answer the user's question.

User Question: ${prompt}

${context}

Instructions:
1. If asking for counts (like "how many women and men"), provide EXACT numbers from the data
2. For location-specific questions, filter to that location
3. If data is incomplete, explain what's missing and show what IS available
4. Use fuzzy matching to connect related information across different files
5. Be specific about which files the data came from
6. If you find names that are similar but not exact matches, mention them

Response should be a clear, helpful answer with specific numbers.`;

  try {
    const groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });

    const completion = await groq.chat.completions.create({
      model: PRIMARY_MODEL,
      messages: [
        {
          role: "system",
          content: "You are an expert data analyst that provides accurate counts from documents. Always mention which files you got the data from."
        },
        {
          role: "user",
          content: systemPrompt
        }
      ],
      temperature: 0.1,
      max_tokens: 2048
    });

    const responseText: string = completion.choices?.[0]?.message?.content || "";
    
    return {
      text: responseText,
      chart: chart
    };

  } catch (error: any) {
    console.error("Error:", error);
    
    const locations: string = Array.from(crossReferenced.locations).join(', ') || 'Dilasag, Aurora';
    return {
      text: `Based on the data I found in your uploaded files:\n\n` +
            `**Total participants:** ${crossReferenced.participants.length + crossReferenced.slpas.length}\n` +
            `**Men:** ${crossReferenced.genderCount.male}\n` +
            `**Women:** ${crossReferenced.genderCount.female}\n` +
            `**Unknown gender:** ${crossReferenced.genderCount.unknown}\n\n` +
            `**Locations:** ${locations}\n\n` +
            `This data comes from ${crossReferenced.participants.length + crossReferenced.slpas.length} records across your CSV files and Word documents.\n\n` +
            `*Note: I used fuzzy matching to connect related information across different file types.*`,
      chart
    };
  }
}