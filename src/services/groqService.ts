import { ChartSpec } from '../types';

export interface KnowledgeDocument {
  id?: number;
  name: string;
  category: string;
  content: string;
  type: string;
}

export async function generateContent(
  prompt: string, 
  currentFiles: File[], 
  knowledgeBase: KnowledgeDocument[], 
  chatHistory: any[] = []
): Promise<{ text: string; chart?: ChartSpec; fileDownload?: any }> {
  
  // 1. Search for relevant documents using the hybrid search API
  let relevantDocs: any[] = [];
  try {
    const searchRes = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, limit: 5 })
    });
    if (searchRes.ok) {
      relevantDocs = await searchRes.json();
    }
  } catch (e) {
    console.error("Hybrid Search Error:", e);
    relevantDocs = knowledgeBase.slice(0, 5);
  }

  const context = relevantDocs && relevantDocs.length > 0 
    ? relevantDocs.map((doc) => {
        return `[SOURCE: ${doc.file_name || doc.name} | CATEGORY: ${doc.category}]\n${doc.content}`;
      }).join('\n\n---\n\n')
    : 'No specific relevant documents found in the knowledge base for this query.';

  // 2. Call the backend chat API (which uses Groq)
  try {
    const chatRes = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        messages: chatHistory.map(m => ({ role: m.role, content: m.text })).concat([{ role: 'user', content: prompt }]),
        context: context
      })
    });

    if (!chatRes.ok) {
      const errorData = await chatRes.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to get response from Groq.");
    }

    const data = await chatRes.json();
    
    // Groq doesn't natively support structured output as easily as Gemini's responseSchema in this setup
    // So we'll try to parse JSON if the model returned it, or just return the text.
    // For now, let's assume the model returns text and we can detect if it's trying to be JSON.
    
    let text = data.text || "No response from AI.";
    let chart: ChartSpec | undefined;
    let fileDownload: any;

    // Simple heuristic to extract JSON if present
    if (text.includes('```json')) {
      try {
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          text = parsed.text || text.replace(/```json[\s\S]*?```/, '').trim();
          chart = parsed.chart;
          fileDownload = parsed.fileDownload;
        }
      } catch (e) {
        console.warn("Failed to parse JSON from Groq response:", e);
      }
    }

    return { text, chart, fileDownload };
  } catch (e: any) {
    console.error("Groq Service Error:", e);
    throw e;
  }
}
