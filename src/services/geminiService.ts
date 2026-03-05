import { GoogleGenAI, Part, Type } from "@google/genai";
import { findRelevantDocs } from "../../lib/vectorSearch";
import { ChartSpec } from "../types";

const getApiKey = (customKey?: string) => {
  if (!customKey || customKey.trim() === "") {
    throw new Error("Please paste your Gemini API key in the sidebar.");
  }

  return customKey.trim();
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

export async function generateContent(
  prompt: string,
  currentFiles: File[],
  knowledgeBase: KnowledgeDocument[],
  customKey?: string,
  chatHistory: any[] = []
): Promise<{ text: string; chart?: ChartSpec; fileDownload?: any }> {

  const apiKey = getApiKey(customKey);
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please configure it in the sidebar.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const imageParts = await Promise.all(
    currentFiles
      .filter(file => file.type.startsWith('image/'))
      .map(imageFileToGenerativePart)
  );

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


  const textPart = { text: combinedText };

  const contents = {
    parts: [textPart, ...imageParts]
  };


  try {

const response = await ai.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: contents,
  config: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: 'The textual response to the user.'
        },
        chart: {
          ...chartSchema,
          description: 'Chart visualization if needed.'
        },
        fileDownload: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.NUMBER },
            name: { type: Type.STRING }
          }
        }
      },
      required: ['text']
    }
  }
});
    const responseText = response.text;

    if (!responseText) {
      return { text: "The AI returned an empty response." };
    }

    const parsed = JSON.parse(responseText);

    return {
      text: parsed.text || "Process completed.",
      chart: parsed.chart,
      fileDownload: parsed.fileDownload
    };

  } catch (error: any) {

    console.error("Gemini API Error:", error);

    if (error instanceof SyntaxError) {
      return {
        text: "There was an error parsing the AI response."
      };
    }

    throw error;

  }

}