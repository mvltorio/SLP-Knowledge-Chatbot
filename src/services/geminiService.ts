import { GoogleGenAI, Part, Type } from "@google/genai";
import { findRelevantDocs } from "../../lib/vectorSearch";
import { ChartSpec } from "../types";

const getApiKey = (customKey?: string) => {
  const key = (customKey && typeof customKey === 'string' && customKey.trim() !== '' && customKey !== 'undefined' && customKey !== 'null')
    ? customKey.trim()
    : process.env.GEMINI_API_KEY;
  return key?.trim();
};

const chartSchema = {
  type: Type.OBJECT,
  properties: {
    chartType: {
      type: Type.STRING,
      enum: ['bar', 'line', 'pie'],
      description: 'The type of chart to display.'
    },
    data: {
      type: Type.ARRAY,
      description: 'The data for the chart.',
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'The label for this data point.' },
          value: { type: Type.NUMBER, description: 'The value for this data point.' },
        },
        required: ['name', 'value']
      }
    },
    title: { type: Type.STRING, description: 'The title of the chart.' },
    dataKey: { type: Type.STRING, description: 'The key in the data objects that holds the value for bar/line charts.' }
  },
  required: ['chartType', 'data']
};

// Converts an image File object to a GoogleGenerativeAI.Part object.
async function imageFileToGenerativePart(file: File): Promise<Part> {
  const base64EncodedData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return {
    inlineData: {
      data: base64EncodedData,
      mimeType: file.type,
    },
  };
}

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

export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const apiKey = getApiKey(key);
    if (!apiKey) return false;
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'hi',
      config: { maxOutputTokens: 1 }
    });
    return true;
  } catch (error) {
    console.error("API Key Validation Error:", error);
    return false;
  }
}

export async function analyzeImage(file: File, customKey?: string): Promise<string> {
  const apiKey = getApiKey(customKey);
  if (!apiKey) throw new Error("Gemini API Key is missing. Please configure it in the sidebar.");

  const ai = new GoogleGenAI({ apiKey });
  const part = await imageFileToGenerativePart(file);
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { text: "Describe this image in detail, including any text you see. If it's a document, extract all the text accurately." },
        part
      ]
    }
  });
  
  return response.text || "[No description generated]";
}

export async function generateContent(prompt: string, currentFiles: File[], knowledgeBase: KnowledgeDocument[], customKey?: string, chatHistory: any[] = []): Promise<{ text: string; chart?: ChartSpec; fileDownload?: any }> {
  const apiKey = getApiKey(customKey);
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please configure it in the sidebar.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const imageParts = await Promise.all(
    currentFiles.filter(file => file.type.startsWith('image/')).map(imageFileToGenerativePart)
  );

  // RAG: Search for relevant documents from the backend
  let relevantDocs: any[] = [];
  try {
    const searchRes = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt, limit: 5, apiKey })
    });
    if (searchRes.ok) {
      relevantDocs = await searchRes.json();
    }
  } catch (e) {
    console.error("RAG Search Error:", e);
    // Fallback to provided knowledgeBase if search fails
    relevantDocs = knowledgeBase
  .filter(doc => doc.content)
  .slice(0, 5);
  }

  const fileContext = relevantDocs
  .map(doc => `
Document: ${doc.name}
Category: ${doc.category}

${doc.content}
`)
  .join("\n\n---\n\n");

  const historyContext = chatHistory.slice(-5).map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`).join('\n');
  
  const combinedText = `
User Question: ${prompt}

You are a SLP Knowledge Assistant. Use the following documents from the user's knowledge base to answer the question. 

CHAT HISTORY (Last 5 messages):
${historyContext}

KNOWLEDGE BASE DOCUMENTS (Most relevant found via RAG):
${fileContext}

INSTRUCTIONS:
1. Answer the question accurately based ONLY on the provided documents.
2. If the user asks for a copy, download, or to see a specific document, identify the File ID and Name from the list above and include it in the "fileDownload" field of your response.
3. For SLPIS data, if the data is available in the documents:
   - Create a "chart" object with the appropriate data.
   - Include a Markdown table in the "text" field.
4. If the information is not in the documents, say "I don't have that information in my current knowledge base."
`.trim();

  const textPart = { text: combinedText };
  const contents = { parts: [textPart, ...imageParts] };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: 'The textual response to the user.' },
            chart: { ...chartSchema, description: 'A chart visualization, if requested.' },
            fileDownload: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.NUMBER, description: 'The ID of the file to download.' },
                name: { type: Type.STRING, description: 'The name of the file to download.' }
              },
              required: ['id', 'name'],
              description: 'Information about a file the user wants to download.'
            }
          },
          required: ['text']
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
        return { text: 'The AI model returned an empty response.' };
    }

    const responseObject = JSON.parse(responseText);
    return {
        text: responseObject.text || 'Process completed.',
        chart: responseObject.chart,
        fileDownload: responseObject.fileDownload
    };
  } catch (e: any) {
    console.error("Gemini API Error:", e);
    if (e instanceof SyntaxError) {
        return { text: "I encountered an error formatting the response. " + (e as any).target?.responseText || "Error parsing AI response." };
    }
    throw e;
  }
}
