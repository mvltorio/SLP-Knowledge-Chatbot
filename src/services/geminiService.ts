import Groq from "groq-sdk";
import { ChartSpec } from "../types";

// Use a currently supported model
const SUPPORTED_MODEL = "llama-3.1-8b-instant"; // or "llama3-70b-8192" or "mixtral-8x7b-32768"

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

// Reads a text File object and returns its content as a string.
async function textFileToString(file: File): Promise<string> {
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

export async function validateApiKey(): Promise<boolean> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) return false;
    
    const groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });

    await groq.chat.completions.create({
      model: SUPPORTED_MODEL, // Updated model
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
  const apiKey = getApiKey(customKey);
  if (!apiKey) throw new Error("Groq API key is missing.");
  
  const groq = new Groq({
    apiKey,
    dangerouslyAllowBrowser: true
  });

  // Note: For image analysis, you'll need to use a multimodal model
  // Currently, Groq doesn't support direct image analysis
  // You might need a different approach or service for this
  
  const completion = await groq.chat.completions.create({
    model: SUPPORTED_MODEL, // Updated model
    messages: [
      {
        role: "user",
        content: "Describe this image in detail including any visible text."
      }
    ]
  });

  return completion.choices?.[0]?.message?.content || "[No description generated]";
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
  
  // ===============================
  // RAG SEARCH
  // ===============================

  let relevantDocs: KnowledgeDocument[] = [];

  try {
    const searchRes = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, limit: 5 })
    });

    if (searchRes.ok) {
      relevantDocs = await searchRes.json();
    }
  } catch (error) {
    console.error("RAG search failed:", error);
  }

  // ===============================
  // FALLBACK IF NO SEARCH RESULTS
  // ===============================

  if (!relevantDocs || relevantDocs.length === 0) {
    relevantDocs = knowledgeBase
      .filter(doc => doc.content && doc.content.length > 50)
      .slice(0, 12);
  }

  // ===============================
  // BUILD DOCUMENT CONTEXT
  // ===============================

  const fileContext = relevantDocs
    .map(doc => `
Document: ${doc.name}
Category: ${doc.category}

${doc.content.slice(0,5000)}
`)
    .join("\n\n---\n\n");

  const historyContext = chatHistory
    .slice(-5)
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`)
    .join('\n');

  const combinedText = `

You are the **SLP Knowledge Chatbot**.

Your job is to analyze uploaded documents including tables and spreadsheets.

When a user asks about statistics, totals, municipalities, yearly data,
or numeric information, you MUST do the following:

1. Extract the numbers from the document.
2. Present the result clearly.
3. Generate a chart when multiple values exist.
4. Provide a short explanation.

Always return your answer in JSON format.

FORMAT:

{
 "text": "Explanation of the data",
 "table": [
   {"name": "Municipality", "value": 100}
 ],
 "chart": {
   "type": "bar",
   "labels": [],
   "values": [],
   "title": ""
 }
}

Rules:

• If the question involves municipalities, list them individually.
• If the question involves years, analyze the yearly columns.
• Always compute totals when possible.

If no chart is required, return:

{
 "text": "Answer"
}

------------------------------

CHAT HISTORY:
${historyContext}

------------------------------

KNOWLEDGE BASE DOCUMENTS:
${fileContext}

------------------------------

USER QUESTION:
${prompt}

`.trim();

  try {
    const groq = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true
    });

    const completion = await groq.chat.completions.create({
      model: SUPPORTED_MODEL, // Updated model
      messages: [
        {
          role: "system",
          content: "You are the SLP Knowledge Chatbot."
        },
        {
          role: "user",
          content: combinedText
        }
      ],
      temperature: 0.2
    });

    const responseText = completion.choices?.[0]?.message?.content || "";

    if (!responseText) {
      return { text: "The AI returned an empty response." };
    }

    return {
      text: responseText
    };
  }
  catch (error: any) {
    console.error("Groq API Error:", error);
    
    // Provide more specific error message
    if (error?.error?.code === "model_decommissioned") {
      return { 
        text: "The AI model is outdated. Please contact the administrator to update the model configuration." 
      };
    }
    
    return {
      text: "There was an error generating the AI response."
    };
  }
}