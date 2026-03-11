import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Groq from "groq-sdk";
import { supabase } from "./src/db.ts";

const app = express();

// ---------------- CONFIG ----------------

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

// ---------------- EMBEDDINGS ----------------
// Serverless-safe embedding generator
async function generateEmbedding(text: string) {
  const res = await fetch("https://api.groq.com/openai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  const data = await res.json();
  return data.data[0].embedding;
}

// ---------------- DB HEALTH ----------------

app.get("/api/db/health", async (req, res) => {
  try {
    const { error: userError } = await supabase.from("users").select("id").limit(1);
    const { error: fileError } = await supabase.from("files").select("id").limit(1);
    const { error: chunkError } = await supabase
      .from("file_chunks")
      .select("id")
      .limit(1);

    const status = {
      users: !userError,
      files: !fileError,
      file_chunks: !chunkError,
    };

    res.json({ status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- AUTH ----------------

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing)
      return res.status(400).json({ success: false, message: "Email already exists" });

    const { data: authUser, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error)
      return res.status(400).json({ success: false, message: error.message });

    await supabase.from("users").insert({
      id: authUser.user.id,
      email,
      role: "user",
      status: "pending",
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: auth, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (!user)
      return res.status(404).json({ success: false, message: "User record missing" });

    if (user.status !== "approved")
      return res.status(403).json({
        success: false,
        message: "Account pending approval",
      });

    res.json({ success: true, user });
  } catch {
    res.status(500).json({ success: false });
  }
});

// ---------------- FILES ----------------

app.get("/api/files", async (req, res) => {
  const { data } = await supabase
    .from("files")
    .select("*")
    .order("uploaded_at", { ascending: false });

  res.json(data || []);
});

app.post("/api/files/upload", async (req, res) => {
  const { name, category, content } = req.body;

  try {
    const { data: file } = await supabase
      .from("files")
      .insert({ name, category })
      .select()
      .single();

    const chunkSize = 1000;
    const overlap = 200;

    for (let i = 0; i < content.length; i += chunkSize - overlap) {
      const chunk = content.slice(i, i + chunkSize);
      const embedding = await generateEmbedding(chunk);

      await supabase.from("file_chunks").insert({
        file_id: file.id,
        content: chunk,
        embedding,
      });
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- SEARCH ----------------

app.post("/api/search", async (req, res) => {
  const { query } = req.body;

  try {
    const embedding = await generateEmbedding(query);

    const { data } = await supabase.rpc("match_chunks", {
      query_embedding: embedding,
      match_threshold: 0.1,
      match_count: 5,
    });

    res.json(data || []);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------- CHAT ----------------

app.post("/api/chat", async (req, res) => {
  const { messages, context } = req.body;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "You are the SLP Knowledge Chatbot helping users search the knowledge base.",
        },
        ...messages,
      ],
    });

    res.json({ text: completion.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: "Chat failed" });
  }
});

// ---------------- SERVER START ----------------

export default app;

async function startServer() {
  const PORT = process.env.PORT || 3000;

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, () => console.log("Server running on", PORT));
  }
}

if (!process.env.VERCEL) startServer();