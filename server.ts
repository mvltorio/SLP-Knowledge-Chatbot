import express from "express";
import { createServer as createViteServer } from "vite";
import { supabase } from "./src/db.ts";
import path from "path";
import Groq from "groq-sdk";
import { pipeline } from '@xenova/transformers';

const app = express();

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
});

// Initialize Embedding Pipeline (Local)
let embedder: any = null;
async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

async function generateEmbedding(text: string) {
  try {
    const generate = await getEmbedder();
    const output = await generate(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (e: any) {
    console.error("Embedding generation error:", e.message || e);
    throw e;
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get("/api/db/health", async (req, res) => {
  try {
    // Check users table
    const { error: userError } = await supabase.from('users').select('id').limit(1);
    
    // Check files table
    const { error: fileError } = await supabase.from('files').select('id').limit(1);
    
    // Check file_chunks table and FTS column
    const { error: chunkError } = await supabase.from('file_chunks').select('id, fts').limit(1);
    
    // Check match_chunks function
    const { error: rpcError } = await supabase.rpc('match_chunks', {
      query_embedding: new Array(384).fill(0),
      match_threshold: 0.5,
      match_count: 1
    });

    const status = {
      users: !userError,
      files: !fileError,
      file_chunks: !chunkError,
      match_chunks: !rpcError,
    };

    const allOk = Object.values(status).every(v => v);

    if (allOk) {
      res.json({ status: 'ok', message: 'Database is healthy and fully configured.' });
    } else {
      res.status(500).json({ 
        status: 'error', 
        message: 'Database is partially configured.',
        details: status,
        hint: 'Please ensure you have run the required SQL setup in your Supabase SQL Editor. Check the "match_chunks" function and "file_chunks" table.'
      });
    }
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// --- AUTH ROUTES ---

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already exists." });
    }

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ success: false, message: authError.message });
    }

    const { error: dbError } = await supabase.from('users').insert({ 
      id: authUser.user.id,
      email, 
      role: 'user', 
      status: 'pending' 
    });

    if (dbError) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return res.status(400).json({ success: false, message: "Error creating user record." });
    }

    res.json({ success: true, message: "Registration successful. Waiting for admin approval." });
  } catch (e: any) {
    res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    
    if (dbError) throw dbError;

    if (user) {
      if (user.status !== 'approved') {
        return res.status(403).json({ success: false, message: "Your account is pending approval." });
      }
      res.json({ success: true, user: { email: user.email, role: user.role } });
    } else {
      res.status(403).json({ success: false, message: "User record not found." });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
});

// --- ADMIN ROUTES ---

app.get("/api/admin/users", async (req, res) => {
  const { data: users } = await supabase.from('users').select('id, email, role, status');
  res.json(users || []);
});

app.post("/api/admin/approve", async (req, res) => {
  const { userId, role } = req.body;
  const { error } = await supabase.from('users').update({ status: 'approved', role: role || 'user' }).eq('id', userId);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

app.post("/api/admin/reject", async (req, res) => {
  const { userId } = req.body;
  try {
    const { data: user } = await supabase.from('users').select('email').eq('id', userId).single();
    if (user) {
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const authUser = users.find((u: any) => u.email === user.email);
      if (authUser) await supabase.auth.admin.deleteUser(authUser.id);
    }
    await supabase.from('users').delete().eq('id', userId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- FILE ROUTES ---

app.get("/api/files", async (req, res) => {
  const { data: files } = await supabase.from('files').select('*').order('uploaded_at', { ascending: false });
  res.json(files || []);
});

app.get("/api/files/:id/content", async (req, res) => {
  const { id } = req.params;
  try {
    const { data: chunks, error } = await supabase
      .from('file_chunks')
      .select('content')
      .eq('file_id', id)
      .order('page_number', { ascending: true });

    if (error) throw error;
    
    const fullContent = chunks.map(c => c.content).join('');
    res.json({ content: fullContent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/files/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category, content } = req.body;
  try {
    // 1. Update metadata
    await supabase.from('files').update({ name, category }).eq('id', id);

    // 2. If content is provided, re-chunk
    if (content) {
      // Delete old chunks
      await supabase.from('file_chunks').delete().eq('file_id', id);

      // Create new chunks
      const chunks = [];
      const chunkSize = 1000;
      const overlap = 200;
      for (let i = 0; i < content.length; i += chunkSize - overlap) {
        chunks.push(content.slice(i, i + chunkSize));
        if (i + chunkSize >= content.length) break;
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await generateEmbedding(chunk);
        await supabase.from('file_chunks').insert({
          file_id: id,
          content: chunk,
          embedding,
          page_number: i + 1
        });
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/files/upload", async (req, res) => {
  const { name, category, content, type, expires_at } = req.body;
  try {
    // 1. Insert file metadata
    const { data: file, error: fileError } = await supabase
      .from('files')
      .insert({ name, category, type, expires_at: expires_at || null })
      .select()
      .single();

    if (fileError) throw fileError;

    // 2. Chunk the content
    const chunks = [];
    const chunkSize = 1000;
    const overlap = 200;
    
    for (let i = 0; i < content.length; i += chunkSize - overlap) {
      chunks.push(content.slice(i, i + chunkSize));
      if (i + chunkSize >= content.length) break;
    }

    // 3. Generate embeddings and insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk);
      await supabase.from('file_chunks').insert({
        file_id: file.id,
        content: chunk,
        embedding,
        page_number: i + 1
      });
    }

    res.json({ success: true });
  } catch (e: any) {
    console.error("Upload Error:", e);
    res.status(500).json({ success: false, message: e.message || "Failed to upload file." });
  }
});

app.delete("/api/files/:id", async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('files').delete().eq('id', id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

// --- CHAT & SEARCH ROUTES ---

app.post("/api/chat", async (req, res) => {
  const { messages, context } = req.body;
  try {
    // Truncate context to avoid token limits (approx 3 characters per token to be safe)
    // 12000 tokens * 3 = 36000 characters. Let's use 25000 to leave room for messages.
    const MAX_CONTEXT_CHARS = 25000;
    const truncatedContext = context && context.length > MAX_CONTEXT_CHARS 
      ? context.substring(0, MAX_CONTEXT_CHARS) + "... [Context truncated due to size limits]"
      : context;

    const systemPrompt = `You are the SLP Knowledge Chatbot, a smart assistant for the Sustainable Livelihood Program.
    Your goal is to help users find information within the uploaded documents (Knowledge Base).
    
    GUIDELINES:
    1. Use the provided CONTEXT to answer the question. The context includes snippets from files, their names, and categories.
    2. If the user asks about the existence of files (e.g., "Do you have proposals about fish?"), check the SOURCE names and CATEGORIES in the context.
    3. If you find relevant information, cite the file name.
    4. If the context doesn't contain the answer but you see a file name that seems relevant, mention that file.
    5. Be professional, concise, and helpful.
    6. If you truly cannot find any relevant information in the context or knowledge base, politely say so and suggest what the user might look for.
    
    CONTEXT:
    ${truncatedContext || 'No relevant documents found in the current search.'}`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      model: "llama-3.1-8b-instant",
    });

    res.json({ text: completion.choices[0].message.content });
  } catch (e: any) {
    console.error("Groq Chat Error:", e);
    
    // Check for specific Groq errors
    if (e.status === 413 || (e.message && e.message.includes('rate_limit_exceeded'))) {
      return res.status(429).json({ 
        error: "The request was too large or the rate limit was exceeded. I've attempted to truncate the context, but please try a shorter question or wait a moment.",
        details: e.message 
      });
    }
    
    res.status(500).json({ error: "Failed to generate response." });
  }
});

app.post("/api/search", async (req, res) => {
  const { query, limit = 5 } = req.body;
  try {
    const queryEmbedding = await generateEmbedding(query);
    
    // 1. Vector Search on Chunks
    let vectorResults = [];
    try {
      const { data, error: vError } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.1, // Lower threshold to be more inclusive
        match_count: limit
      });
      if (vError) {
        console.warn("Vector search RPC failed:", vError.message);
      } else {
        vectorResults = data || [];
      }
    } catch (err: any) {
      console.warn("Vector search exception:", err.message);
    }

    // 2. Keyword Search on Chunks (with ilike fallback)
    let keywordResults = [];
    try {
      const { data, error: kError } = await supabase
        .from('file_chunks')
        .select('id, file_id, content, files(name, category)')
        .textSearch('fts', query)
        .limit(limit);
      
      if (kError) {
        console.warn("Keyword search (fts) failed, trying ilike:", kError.message);
        // Fallback to ilike if fts fails
        const { data: ilikeData } = await supabase
          .from('file_chunks')
          .select('id, file_id, content, files(name, category)')
          .ilike('content', `%${query}%`)
          .limit(limit);
        keywordResults = ilikeData || [];
      } else {
        keywordResults = data || [];
      }
    } catch (err: any) {
      console.warn("Keyword search exception:", err.message);
    }

    // 2.5 Metadata Search on Files (Name/Category)
    let metadataResults = [];
    try {
      const { data: filesData } = await supabase
        .from('files')
        .select('id, name, category')
        .or(`name.ilike.%${query}%,category.ilike.%${query}%`)
        .limit(3);
      
      if (filesData && filesData.length > 0) {
        // For each matching file, get its first chunk to provide some context
        for (const file of filesData) {
          const { data: firstChunk } = await supabase
            .from('file_chunks')
            .select('id, content')
            .eq('file_id', file.id)
            .order('page_number', { ascending: true })
            .limit(1)
            .single();
          
          if (firstChunk) {
            metadataResults.push({
              id: firstChunk.id,
              file_id: file.id,
              content: `[FILE MATCH] This file matches your search by name or category. Content preview: ${firstChunk.content.substring(0, 500)}...`,
              file_name: file.name,
              category: file.category,
              similarity: 0.9 // High similarity for direct metadata matches
            });
          }
        }
      }
    } catch (err: any) {
      console.warn("Metadata search exception:", err.message);
    }

    // 3. Combine and Deduplicate
    const combined = [...vectorResults, ...metadataResults];
    const seenIds = new Set(combined.map(r => r.id));

    keywordResults.forEach((r: any) => {
      if (!seenIds.has(r.id)) {
        combined.push({
          id: r.id,
          file_id: r.file_id,
          content: r.content,
          file_name: r.files?.name,
          category: r.files?.category,
          similarity: 0.5
        });
      }
    });

    if (combined.length === 0) {
      // Fallback 1: Try searching for individual keywords if the full query failed
      const keywords = query.split(/\s+/).filter((w: string) => w.length > 3);
      if (keywords.length > 0) {
        const keywordQuery = keywords.join(' | ');
        try {
          const { data: kwData } = await supabase
            .from('file_chunks')
            .select('id, file_id, content, files(name, category)')
            .textSearch('fts', keywordQuery)
            .limit(limit);
          
          if (kwData && kwData.length > 0) {
            kwData.forEach((r: any) => {
              if (!seenIds.has(r.id)) {
                combined.push({
                  id: r.id,
                  file_id: r.file_id,
                  content: r.content,
                  file_name: r.files?.name,
                  category: r.files?.category,
                  similarity: 0.4
                });
                seenIds.add(r.id);
              }
            });
          }
        } catch (e) { /* ignore */ }
      }
    }

    if (combined.length === 0) {
      // Fallback 2: just get the most recent chunks if nothing matched
      const { data: fallback } = await supabase
        .from('file_chunks')
        .select('id, file_id, content, files(name, category)')
        .limit(limit);
      
      if (fallback) {
        fallback.forEach((r: any) => {
          combined.push({
            id: r.id,
            file_id: r.file_id,
            content: r.content,
            file_name: r.files?.name,
            category: r.files?.category,
            similarity: 0.1
          });
        });
      }
    }

    res.json(combined.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, limit));
  } catch (e: any) {
    console.error("Search failed detailed error:", {
      message: e.message,
      details: e.details,
      hint: e.hint,
      code: e.code,
      stack: e.stack
    });
    res.status(500).json({ error: "Search failed", details: e.message });
  }
});

// Export the app for Vercel
export default app;

async function startServer() {
  const PORT = process.env.PORT || 3000;
  
  // Only use Vite in development and when not running on Vercel
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    // In production (including Vercel), serve static files
    // Note: Vercel usually handles this via vercel.json rewrites, 
    // but this keeps the Express app functional in other environments.
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      // Check if we are in a serverless environment where dist might not be local
      const distPath = path.resolve("dist/index.html");
      res.sendFile(distPath);
    });
  }

  // Only listen if we're not in a serverless environment (like Vercel)
  if (!process.env.VERCEL) {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

// Only start the server if this file is run directly
if (import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  startServer();
} else if (process.env.VERCEL) {
  // On Vercel, we still need to initialize things like the embedder
  // but we don't call listen(). 
  // We can call startServer without listen or just let the routes handle it.
  // For now, we'll let the lazy initialization of the embedder handle it.
}
