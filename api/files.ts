import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {

    // ===================================
    // GET FILES
    // ===================================
    if (req.method === "GET") {

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .order("uploaded_at", { ascending: false });

      if (error) {
        console.error("SUPABASE FETCH ERROR:", error);

        return res.status(500).json({
          message: "Failed to fetch files",
          error: error.message
        });
      }

      return res.status(200).json(data);
    }


    // ===================================
    // UPLOAD FILE (TEXT CONTENT)
    // ===================================
    if (req.method === "POST") {

      if (!req.body) {
        return res.status(400).json({
          message: "Request body is empty"
        });
      }

      const { name, category, content, type } = req.body;

      if (!name || !category || !content) {
        return res.status(400).json({
          message: "Missing required fields",
          required: ["name", "category", "content"]
        });
      }

      const { data, error } = await supabase
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

      if (error) {
        console.error("SUPABASE INSERT ERROR:", error);

        return res.status(500).json({
          message: "Upload failed",
          error: error.message
        });
      }

      return res.status(200).json(data);
    }


    // ===================================
    // DELETE FILE
    // ===================================
    if (req.method === "DELETE") {

      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          message: "Missing file ID"
        });
      }

      const { error } = await supabase
        .from("files")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("SUPABASE DELETE ERROR:", error);

        return res.status(500).json({
          message: "Delete failed",
          error: error.message
        });
      }

      return res.status(200).json({
        success: true
      });
    }


    // ===================================
    // UPDATE FILE
    // ===================================
    if (req.method === "PUT") {

      const { id } = req.query;
      const { name, category } = req.body;

      if (!id) {
        return res.status(400).json({
          message: "Missing file ID"
        });
      }

      const { data, error } = await supabase
        .from("files")
        .update({
          name,
          category
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("SUPABASE UPDATE ERROR:", error);

        return res.status(500).json({
          message: "Update failed",
          error: error.message
        });
      }

      return res.status(200).json(data);
    }


    // ===================================
    // METHOD NOT ALLOWED
    // ===================================
    return res.status(405).json({
      message: "Method not allowed"
    });

  } catch (err: any) {

    console.error("FILES API CRASH:", err);

    return res.status(500).json({
      message: "Server crashed",
      error: err?.message || "Unknown error"
    });
  }
}