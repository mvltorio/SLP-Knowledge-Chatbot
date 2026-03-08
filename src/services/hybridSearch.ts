import Groq from "groq-sdk";

export interface SearchResult {
  fileName: string;
  category: string;
  excerpt: string;
  url: string;
  score?: number;
}

export interface HybridSearchResponse {
  answer: string;
  sources: SearchResult[];
}

// Mock data for fallback search when Pagefind isn't available
const mockDocuments = [
  {
    fileName: "SLP Guidelines 2024.pdf",
    category: "GUIDELINES",
    content: "The Sustainable Livelihood Program (SLP) provides cash-for-work and livelihood assistance to poor, vulnerable, and marginalized households and communities. The program has two tracks: Employment Facilitation and Livelihood Development.",
    url: "/documents/slp-guidelines-2024.pdf"
  },
  {
    fileName: "Cash-for-Work Guidelines.docx",
    category: "GUIDELINES",
    content: "Cash-for-Work is a short-term intervention that provides temporary employment to beneficiaries. Participants receive payment for community projects lasting 10-30 days. Daily wage is based on regional minimum wage rates.",
    url: "/documents/cash-for-work-guidelines.docx"
  },
  {
    fileName: "Livelihood Assistance Form.xlsx",
    category: "FORMS AND TEMPLATES",
    content: "Livelihood Assistance Form requires: Name, Address, Contact Number, Type of Livelihood (Agriculture, Small Business, Services), Amount Requested, Supporting Documents, and Barangay Clearance.",
    url: "/documents/livelihood-assistance-form.xlsx"
  },
  {
    fileName: "SLPIS Quarterly Report Q1 2024.pdf",
    category: "SLPIS",
    content: "Q1 2024 Report: 1,245 beneficiaries served across 15 municipalities. Total cash-for-work payout: ₱4.2M. Livelihood projects funded: 45 small businesses, 23 agricultural projects.",
    url: "/documents/slpis-q1-2024.pdf"
  },
  {
    fileName: "DPT Monitoring Tool.xlsx",
    category: "SLP DPT",
    content: "DPT (Development Project Tracker) includes: Project Name, Proponent, Status (Pipeline/Ongoing/Completed), Budget Allocated, Date Started, Target Completion, Actual Completion, Remarks.",
    url: "/documents/dpt-monitoring-tool.xlsx"
  }
];

class HybridSearchService {
  private groq: Groq | null = null;
  private pagefind: any = null;
  private useMockData = true; // Set to false when Pagefind is properly configured

  constructor(apiKey: string) {
    if (apiKey && apiKey.trim() !== '') {
      try {
        this.groq = new Groq({
          apiKey,
          dangerouslyAllowBrowser: true
        });
      } catch (error) {
        console.warn('Failed to initialize Groq:', error);
        this.groq = null;
      }
    } else {
      console.warn('No Groq API key provided');
      this.groq = null;
    }
  }

  // Simple text-based search (fallback when Pagefind isn't available)
  private textSearch(query: string, category?: string): SearchResult[] {
    const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    
    let documents = [...mockDocuments];
    
    // Filter by category if specified
    if (category) {
      documents = documents.filter(doc => 
        doc.category.toLowerCase() === category.toLowerCase()
      );
    }
    
    const results: SearchResult[] = [];
    
    documents.forEach(doc => {
      let score = 0;
      const content = doc.content.toLowerCase();
      const fileName = doc.fileName.toLowerCase();
      
      searchTerms.forEach(term => {
        // Count occurrences in content
        const contentMatches = (content.match(new RegExp(term, 'g')) || []).length;
        score += contentMatches;
        
        // Bonus for matches in filename
        if (fileName.includes(term)) {
          score += 5;
        }
      });
      
      if (score > 0) {
        // Create an excerpt
        const excerpt = this.generateExcerpt(doc.content, query, 150);
        
        results.push({
          fileName: doc.fileName,
          category: doc.category,
          excerpt: excerpt,
          url: doc.url,
          score
        });
      }
    });
    
    // Sort by score descending
    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  private generateExcerpt(content: string, query: string, maxLength: number): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const queryIndex = lowerContent.indexOf(lowerQuery);
    
    if (queryIndex >= 0) {
      const start = Math.max(0, queryIndex - 50);
      const end = Math.min(content.length, queryIndex + query.length + 50);
      let excerpt = content.substring(start, end);
      
      if (start > 0) excerpt = '...' + excerpt;
      if (end < content.length) excerpt = excerpt + '...';
      
      return excerpt;
    }
    
    // If query not found, return first part of content
    return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
  }

  // Initialize Pagefind (placeholder - will be implemented when Pagefind is properly set up)
  async initPagefind() {
    console.log('Pagefind initialization skipped - using fallback search');
    return null;
  }

  // Hybrid search: text search + Groq
  async search(query: string, options?: {
    maxSources?: number;
    category?: string;
  }): Promise<HybridSearchResponse> {
    const maxSources = options?.maxSources || 5;
    
    try {
      // STEP 1: Get relevant documents (using text search as fallback)
      console.log('🔍 Searching documents:', query);
      
      const sources = this.textSearch(query, options?.category).slice(0, maxSources);
      
      if (sources.length === 0) {
        return {
          answer: "No relevant documents found for your query.",
          sources: []
        };
      }
      
      // STEP 2: Build context for Groq
      const context = sources.map((source, i) => `
[SOURCE ${i + 1}]
FILE: ${source.fileName}
FOLDER: ${source.category}
EXCERPT: ${source.excerpt}
      `).join('\n---\n');
      
      // STEP 3: Try Groq for answer generation (if available)
      let answer = '';
      
      if (this.groq) {
        try {
          console.log('🤖 Generating answer with Groq...');
          
          const completion = await this.groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: `You are an SLP (Sustainable Livelihood Program) document assistant.
                
RULES:
- Answer ONLY using the provided document excerpts
- If multiple documents are relevant, mention ALL of them
- Include specific details like amounts, dates, and folder categories
- Be concise but complete
- If the answer isn't in the excerpts, say "I cannot find this information"
- Always cite which document/file the information comes from`
              },
              {
                role: "user",
                content: `QUESTION: ${query}

RELEVANT DOCUMENT EXCERPTS:
${context}

Based ONLY on these excerpts, answer the question. Include specific details and cite sources:`
              }
            ],
            temperature: 0.1,
            max_tokens: 600
          });
          
          answer = completion.choices[0]?.message?.content || '';
        } catch (groqError: any) {
          console.error('Groq API error:', groqError);
          
          // Fallback answer
          answer = `I found ${sources.length} relevant document(s) but couldn't generate an AI answer. Here are the documents I found:\n\n`;
          sources.forEach((source, i) => {
            answer += `${i + 1}. **${source.fileName}** (${source.category})\n   ${source.excerpt}\n\n`;
          });
        }
      } else {
        // No Groq API key, just show the sources
        answer = `Here are the relevant documents I found:\n\n`;
        sources.forEach((source, i) => {
          answer += `${i + 1}. **${source.fileName}** (${source.category})\n   ${source.excerpt}\n\n`;
        });
      }
      
      return { answer, sources };
      
    } catch (error) {
      console.error('Hybrid search error:', error);
      
      // Ultimate fallback
      return {
        answer: "I encountered an error while searching. Please try again with a different query.",
        sources: []
      };
    }
  }

  // Rate limit handling with retry
  async searchWithRetry(query: string, options?: any, maxRetries = 3): Promise<HybridSearchResponse> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.search(query, options);
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error?.status === 429 || error?.message?.includes('rate_limit')) {
          if (i < maxRetries - 1) {
            const waitTime = Math.pow(2, i) * 1000; // Exponential backoff
            console.log(`⏳ Rate limited. Waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        
        // If it's the last retry or not a rate limit error, return fallback
        return {
          answer: `Search completed with limited results. ${error?.message || 'Unknown error'}`,
          sources: this.textSearch(query, options?.category).slice(0, options?.maxSources || 5)
        };
      }
    }
    
    return {
      answer: "Unable to complete search after multiple attempts.",
      sources: []
    };
  }

  // Method to add more mock documents (useful for testing)
  addMockDocument(doc: typeof mockDocuments[0]) {
    mockDocuments.push(doc);
  }

  // Method to clear mock documents
  clearMockDocuments() {
    mockDocuments.length = 0;
  }

  // Method to reset to default mock documents
  resetMockDocuments() {
    mockDocuments.length = 0;
    mockDocuments.push(...[
      {
        fileName: "SLP Guidelines 2024.pdf",
        category: "GUIDELINES",
        content: "The Sustainable Livelihood Program (SLP) provides cash-for-work and livelihood assistance to poor, vulnerable, and marginalized households and communities. The program has two tracks: Employment Facilitation and Livelihood Development.",
        url: "/documents/slp-guidelines-2024.pdf"
      },
      {
        fileName: "Cash-for-Work Guidelines.docx",
        category: "GUIDELINES",
        content: "Cash-for-Work is a short-term intervention that provides temporary employment to beneficiaries. Participants receive payment for community projects lasting 10-30 days. Daily wage is based on regional minimum wage rates.",
        url: "/documents/cash-for-work-guidelines.docx"
      }
    ]);
  }
}

export default HybridSearchService;