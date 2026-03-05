import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const { prompt, context } = req.body;

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt + "\n\n" + context
    });

    res.status(200).json({
      text: response.text
    });

  } catch (error) {

    console.error("Gemini Error:", error);

    res.status(500).json({
      error: "AI request failed"
    });

  }
}