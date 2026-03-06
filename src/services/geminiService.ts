import Groq from "groq-sdk";
import { ChartSpec } from "../types";

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
  model: "llama3-8b-8192",
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

const completion = await groq.chat.completions.create({
  model: "llama3-8b-8192",
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
      .slice(0, 5);

  }

  // ===============================
  // BUILD DOCUMENT CONTEXT
  // ===============================

  const fileContext = relevantDocs
  .map(doc => `
Document: ${doc.name}
Category: ${doc.category}

${doc.content.slice(0,800)}
`)
  .join("\n\n---\n\n");


  const historyContext = chatHistory
    .slice(-5)
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`)
    .join('\n');


  const combinedText = `

You are the **SLP Knowledge Chatbot**.

Your job is to answer questions using ONLY the uploaded documents.

If the answer exists in the documents, explain clearly.

If the user asks about proposals, guidelines, forms, or SLP data,
analyze the documents and summarize them.

If the answer is not in the documents say:

"I don't have that information in my current knowledge base."

------------------------------

CHAT HISTORY:
${historyContext}

------------------------------

KNOWLEDGE BASE DOCUMENTS:

${fileContext}

------------------------------

USER QUESTION:
${prompt}

------------------------------

Answer clearly and professionally.

`.trim();

try {

 const groq = new Groq({
  apiKey,
  dangerouslyAllowBrowser: true
});

  const completion = await groq.chat.completions.create({
    model: "llama3-8b-8192",
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

  return {
    text: "There was an error generating the AI response."
  };

}

}