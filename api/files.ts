import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./db";

export default async function handler(req: VercelRequest, res: VercelResponse) {

  try {

    // =========================
    // GET FILES
    // =========================
    if (req.method === "GET") {

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("SUPABASE FETCH ERROR:", error);
        return res.status(500).json({
          error: error.message
        });
      }

      return res.status(200).json(data);
    }

    // =========================
    // UPLOAD FILE
    // =========================
    if (req.method === "POST") {

      const { name, category, content, type } = req.body || {};

      if (!name || !category || !content) {
        return res.status(400).json({
          error: "Missing required fields"
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
          error: error.message
        });
      }

      return res.status(200).json(data);
    }

    // =========================
    // DELETE FILE
    // =========================
    if (req.method === "DELETE") {

      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: "Missing file ID"
        });
      }

      const { error } = await supabase
        .from("files")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("SUPABASE DELETE ERROR:", error);
        return res.status(500).json({
          error: error.message
        });
      }

      return res.status(200).json({ success: true });
    }

    // =========================
    // UPDATE FILE
    // =========================
    if (req.method === "PUT") {

      const { id } = req.query;
      const { name, category } = req.body || {};

      if (!id) {
        return res.status(400).json({
          error: "Missing file ID"
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
          error: error.message
        });
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({
      error: "Method not allowed"
    });

  } catch (err: any) {

    console.error("FILES API CRASH:", err);

    return res.status(500).json({
      error: err.message || "Server crashed"
    });
  }
}