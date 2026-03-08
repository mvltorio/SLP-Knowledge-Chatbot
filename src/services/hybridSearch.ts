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

class HybridSearchService {
  private groq: Groq;
  private pagefind: any = null;

  constructor(apiKey: string) {
    this.groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  // Initialize Pagefind
  async initPagefind() {
    if (this.pagefind) return this.pagefind;
    
    try {
      // Load Pagefind from public directory
      const module = await import('/pagefind/pagefind.js?url');
      const response = await fetch(module.default);
      const script = await response.text();
      
      // Create and execute script
      const blob = new Blob([script], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      
      await import(url);
      this.pagefind = await (window as any).pagefind;
      
      URL.revokeObjectURL(url);
      return this.pagefind;
    } catch (error) {
      console.error('Failed to load Pagefind:', error);
      return null;
    }
  }

  // Hybrid search: Pagefind + Groq
  async search(query: string, options?: {
    maxSources?: number;
    category?: string;
  }): Promise<HybridSearchResponse> {
    const maxSources = options?.maxSources || 5;
    
    // Initialize Pagefind if needed
    if (!this.pagefind) {
      await this.initPagefind();
    }
    
    try {
      // STEP 1: Pagefind retrieves relevant documents
      console.log('🔍 Searching with Pagefind:', query);
      
      let searchFilters = {};
      if (options?.category) {
        searchFilters = { category: options.category };
      }
      
      const search = await this.pagefind.search(query, {
        filters: searchFilters
      });
      
      // Get top results
      const topResults = search.results.slice(0, maxSources);
      const sources: SearchResult[] = [];
      
      for (const result of topResults) {
        const data = await result.data();
        sources.push({
          fileName: data.meta?.title || 'Unknown',
          category: data.filters?.category || 'Uncategorized',
          excerpt: data.excerpt,
          url: data.url
        });
      }
      
      // STEP 2: Build context for Groq
      const context = sources.map((source, i) => `
[SOURCE ${i + 1}]
FILE: ${source.fileName}
FOLDER: ${source.category}
EXCERPT: ${source.excerpt}
      `).join('\n---\n');
      
      // STEP 3: Groq generates answer
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
      
      const answer = completion.choices[0]?.message?.content || 'No answer generated.';
      
      return { answer, sources };
      
    } catch (error) {
      console.error('Hybrid search error:', error);
      
      // Fallback: Return just sources if Groq fails
      if (this.pagefind) {
        const search = await this.pagefind.search(query);
        const sources: SearchResult[] = [];
        
        for (const result of search.results.slice(0, maxSources)) {
          const data = await result.data();
          sources.push({
            fileName: data.meta?.title || 'Unknown',
            category: data.filters?.category || 'Uncategorized',
            excerpt: data.excerpt,
            url: data.url
          });
        }
        
        return {
          answer: "⚠️ AI temporarily unavailable. Here are the relevant documents:",
          sources
        };
      }
      
      throw error;
    }
  }

  // Rate limit handling with retry
  async searchWithRetry(query: string, options?: any, maxRetries = 3): Promise<HybridSearchResponse> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.search(query, options);
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error.status === 429 || error.message?.includes('rate_limit')) {
          const waitTime = Math.pow(2, i) * 1000; // Exponential backoff
          console.log(`⏳ Rate limited. Waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded for Groq API');
  }
}

export default HybridSearchService;