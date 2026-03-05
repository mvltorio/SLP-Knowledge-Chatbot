import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {

    // GET FILES
    if (req.method === "GET") {

      const response = await supabase
        .from("files")
        .select("*");

      if (response.error) {
        console.error("Supabase error:", response.error);
        return res.status(500).json({
          error: response.error.message
        });
      }

      return res.status(200).json(response.data);
    }

    // UPLOAD FILE
    if (req.method === "POST") {

      const { name, category, content, type } = req.body || {};

      if (!name || !category || !content) {
        return res.status(400).json({
          error: "Missing required fields"
        });
      }

      const response = await supabase
        .from("files")
        .insert([
          {
            name,
            category,
            content,
            type
          }
        ])
        .select()
        .single();

      if (response.error) {
        console.error("Insert error:", response.error);
        return res.status(500).json({
          error: response.error.message
        });
      }

      return res.status(200).json(response.data);
    }

    return res.status(405).json({
      error: "Method not allowed"
    });

  } catch (err: any) {

    console.error("FILES API CRASH:", err);

    return res.status(500).json({
      error: err.message
    });
  }
}