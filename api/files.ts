import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {

    // ===============================
    // GET FILES
    // ===============================
    if (req.method === "GET") {

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .order("uploaded_at", { ascending: false });

      if (error) {
        console.error("FETCH ERROR:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    // ===============================
    // UPLOAD FILE
    // ===============================
    if (req.method === "POST") {

      const body = typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

      if (!body) {
        return res.status(400).json({
          message: "Empty request body"
        });
      }

      const { name, category, content, type } = body;

      if (!name || !category || !content) {
        return res.status(400).json({
          message: "Missing required fields",
          received: body
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
        console.error("INSERT ERROR:", error);

        return res.status(500).json({
          message: "Upload failed",
          error: error.message
        });
      }

      return res.status(200).json(data);
    }

    // ===============================
    // DELETE FILE
    // ===============================
    if (req.method === "DELETE") {

      const id = req.query.id;

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
        console.error("DELETE ERROR:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ success: true });
    }

    // ===============================
    // UPDATE FILE
    // ===============================
    if (req.method === "PUT") {

      const id = req.query.id;
      const { name, category } = req.body;

      if (!id) {
        return res.status(400).json({
          message: "Missing file ID"
        });
      }

      const { data, error } = await supabase
        .from("files")
        .update({ name, category })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("UPDATE ERROR:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    return res.status(405).json({
      message: "Method not allowed"
    });

  } catch (err: any) {

    console.error("FILES API CRASH:", err);

    return res.status(500).json({
      message: "Server crashed",
      error: err?.message
    });
  }
}