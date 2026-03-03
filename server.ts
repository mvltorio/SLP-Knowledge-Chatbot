import express from "express";
import { createServer as createViteServer } from "vite";
import { supabase } from "./src/db.ts";
import path from "path";
import { google } from 'googleapis';
import { GoogleGenAI } from "@google/genai";

const app = express();

function getApiKey(customKey?: string) {
  const key = (customKey && typeof customKey === 'string' && customKey.trim() !== '' && customKey !== 'undefined' && customKey !== 'null')
    ? customKey.trim()
    : process.env.GEMINI_API_KEY;
  return key?.trim();
}

async function generateEmbedding(text: string, customApiKey?: string) {
  try {
    const key = getApiKey(customApiKey);
    if (!key) throw new Error("Gemini API Key is missing. Please configure it in the environment or sidebar.");
    
    console.log(`Using API Key: ${key.substring(0, 4)}...${key.substring(key.length - 4)}`);
    
    const aiClient = new GoogleGenAI({ apiKey: key });
    const result = await aiClient.models.embedContent({
      model: "text-embedding-004",
      contents: [{ parts: [{ text: text.substring(0, 30000) }] }],
    });
    
    if (!result.embeddings || result.embeddings.length === 0) {
      throw new Error("No embeddings returned from API");
    }
    
    return result.embeddings[0].values;
  } catch (e: any) {
    console.error("Embedding generation error:", e.message || e);
    throw e;
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- UPDATED GOOGLE OAUTH LOGIC ---

// Helper para makuha ang tamang Redirect URI base sa kasalukuyang host
function getRedirectUri(origin?: string) {
  // Priority: 1. origin from request, 2. APP_URL env, 3. fallback to a default if possible
  let base = (origin || process.env.APP_URL || '').replace(/\/$/, '');
  
  // If we are in a dev environment and base is empty, we might need a better fallback
  // but for now, we rely on the passed origin or APP_URL.
  if (!base && process.env.NODE_ENV !== 'production') {
    console.warn("WARNING: No base URL found for Redirect URI. OAuth might fail.");
  }

  const uri = `${base}/api/auth/google/callback`;
  return uri;
}

function getOAuth2Client(origin?: string) {
  const currentRedirectUri = getRedirectUri(origin);
  
  console.log("DEBUG: Initializing OAuth2 Client");
  console.log(" - Client ID:", process.env.GOOGLE_CLIENT_ID ? 'Present' : 'MISSING');
  console.log(" - Redirect URI:", currentRedirectUri);

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    currentRedirectUri
  );
}

async function getDriveClient() {
  // 1. Try Service Account first
  if (process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL) {
    try {
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file']
      });
      return google.drive({ version: 'v3', auth });
    } catch (e) {
      console.error('Service Account Auth Error:', e);
    }
  }

  // 2. Fallback to OAuth2
  const { data: tokensSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'google_tokens')
    .single();
  
  if (!tokensSetting) return null;
  
  const tokens = JSON.parse(tokensSetting.value);
  // Dito, gagamit tayo ng default client. 
  // Note: Mas mainam kung ang origin ay naka-save din sa settings kung pabago-bago ang URL.
  const client = getOAuth2Client(); 
  client.setCredentials(tokens);
  
  client.on('tokens', async (newTokens) => {
    const updatedTokens = { ...tokens, ...newTokens };
    await supabase
      .from('settings')
      .upsert({ key: 'google_tokens', value: JSON.stringify(updatedTokens) });
  });

  return google.drive({ version: 'v3', auth: client });
}

app.get('/api/auth/google/debug', (req, res) => {
  const origin = (req.query.origin as string) || process.env.APP_URL;
  res.json({ 
    origin_passed: req.query.origin || 'none',
    calculatedRedirectUri: getRedirectUri(origin),
    envAppUrl: process.env.APP_URL || 'not set',
    clientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not Set',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not Set',
    nodeEnv: process.env.NODE_ENV
  });
});

app.get('/api/auth/google/url', (req, res) => {
  const origin = (req.query.origin as string) || process.env.APP_URL;
  const client = getOAuth2Client(origin);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state: origin, 
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly'
    ],
  });
  res.json({ url });
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const origin = state as string; 
  try {
    const client = getOAuth2Client(origin);
    const { tokens } = await client.getToken(code as string);
    await supabase.from('settings').upsert({ key: 'google_tokens', value: JSON.stringify(tokens) });
    
    client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: client });
    
    let { data: rootFolderIdSetting } = await supabase.from('settings').select('value').eq('key', 'drive_root_id').single();
    let rootFolderId = rootFolderIdSetting?.value;

    if (!rootFolderId) {
      const rootRes = await drive.files.create({
        requestBody: {
          name: 'SLP Knowledge Chatbot',
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });
      rootFolderId = rootRes.data.id;
      await supabase.from('settings').upsert({ key: 'drive_root_id', value: rootFolderId });
    }

    const subfolders = ['GUIDELINES', 'FORMS AND TEMPLATES', 'ACTIVITY PHOTOS', 'SLPIS', 'SLP DPT', 'PROPOSAL', 'OTHERS FILES'];
    for (const folderName of subfolders) {
      const settingKey = `drive_folder_${folderName.replace(/\s+/g, '_')}_id`;
      let { data: folderIdSetting } = await supabase.from('settings').select('value').eq('key', settingKey).single();
      
      if (!folderIdSetting) {
        const folderRes = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [rootFolderId],
          },
          fields: 'id',
        });
        await supabase.from('settings').upsert({ key: settingKey, value: folderRes.data.id });
      }
    }

    res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
            window.close();
          </script>
          <p>Google Drive connected and folders created! You can close this window.</p>
        </body>
      </html>
    `);
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).send('Authentication failed');
  }
});

// --- REST OF ORIGINAL ROUTES (WALANG BINAWAS) ---

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;
  const { error } = await supabase.from('users').insert({ email, password, role: 'user', status: 'pending' });
  if (error) return res.status(400).json({ success: false, message: "Email already exists or error occurred." });
  res.json({ success: true, message: "Registration successful. Waiting for admin approval." });
});

app.post("/api/auth/validate-key", async (req, res) => {
  const { apiKey } = req.body;
  const key = getApiKey(apiKey);
  if (!key) return res.json({ valid: false, message: "No API key provided." });

  try {
    const aiClient = new GoogleGenAI({ apiKey: key });
    const model = aiClient.models.get({ model: "gemini-3-flash-preview" });
    // Just a small check
    await aiClient.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: "hi" }] }],
      config: { maxOutputTokens: 1 }
    });
    res.json({ valid: true });
  } catch (e: any) {
    console.error("Key validation error:", e.message || e);
    res.json({ valid: false, message: e.message || "Invalid API key." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .maybeSingle();
    
    if (error) {
      console.error('Supabase login error:', error.message || error);
      return res.status(500).json({ 
        success: false, 
        message: `Database connection error: ${error.message || 'Unknown error'}.` 
      });
    }

    if (user) {
      if (user.status !== 'approved') {
        return res.status(403).json({ success: false, message: "Your account is pending approval." });
      }
      res.json({ success: true, user: { email: user.email, role: user.role } });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials." });
    }
  } catch (e: any) {
    console.error('Login exception:', e);
    res.status(500).json({ success: false, message: "An unexpected error occurred." });
  }
});

app.get("/api/db/health", async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
    if (error) throw error;
    res.json({ status: 'ok', message: 'Database connected and tables found.' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get("/api/drive/status", async (req, res) => {
  const hasServiceAccount = !!(process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CLIENT_EMAIL);
  const { data: tokens } = await supabase.from('settings').select('value').eq('key', 'google_tokens').single();
  res.json({ connected: !!tokens || hasServiceAccount, method: hasServiceAccount ? 'service_account' : 'oauth2' });
});

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
  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

app.post("/api/admin/users/add", async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const { data, error } = await supabase.from('users').insert({ 
      email, password, role: role || 'user', status: 'approved' 
    }).select().single();
    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/api/admin/users/update", async (req, res) => {
  const { userId, role } = req.body;
  const { error } = await supabase.from('users').update({ role }).eq('id', userId);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true });
});

app.get("/api/files", async (req, res) => {
  const { data: files } = await supabase.from('files').select('*').order('uploaded_at', { ascending: false });
  res.json(files || []);
});

app.post("/api/files/upload", async (req, res) => {
  const { name, category, content, type, expires_at, apiKey } = req.body;
  try {
    let driveFileId = null;
    const drive = await getDriveClient();
    
    if (drive && category !== 'CHAT_UPLOAD') {
      const folderKey = `drive_folder_${category.replace(/\s+/g, '_')}_id`;
      const { data: folderSetting } = await supabase.from('settings').select('value').eq('key', folderKey).single();
      const parentId = folderSetting?.value;

      const driveRes = await drive.files.create({
        requestBody: {
          name: name.endsWith('.txt') ? name : `${name}.txt`,
          parents: parentId ? [parentId] : [],
          mimeType: 'text/plain',
        },
        media: { mimeType: 'text/plain', body: content },
        fields: 'id',
      });
      driveFileId = driveRes.data.id;
    }

    const embedding = await generateEmbedding(content, apiKey);

    await supabase.from('files').insert({
      name, category, content, type, drive_file_id: driveFileId, embedding, expires_at: expires_at || null
    });

    res.json({ success: true, driveFileId });
  } catch (e) {
    res.status(500).json({ success: false, message: "Failed to upload file." });
  }
});

app.get("/api/drive/sync", async (req, res) => {
  const { apiKey } = req.query;
  try {
    const drive = await getDriveClient();
    if (!drive) return res.status(401).json({ success: false, message: "Drive not connected" });

    const subfolders = ['GUIDELINES', 'FORMS AND TEMPLATES', 'ACTIVITY PHOTOS', 'SLPIS', 'SLP DPT', 'PROPOSAL', 'OTHERS FILES'];
    let newFilesCount = 0;

    for (const folderName of subfolders) {
      const folderKey = `drive_folder_${folderName.replace(/\s+/g, '_')}_id`;
      const { data: folderSetting } = await supabase.from('settings').select('value').eq('key', folderKey).single();
      if (!folderSetting) continue;

      const folderId = folderSetting.value;
      const driveFiles = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, modifiedTime)',
      });

      if (driveFiles.data.files) {
        for (const file of driveFiles.data.files) {
          const { data: existing } = await supabase.from('files').select('id').eq('drive_file_id', file.id).single();
          if (!existing) {
            try {
              let content = '';
              if (file.mimeType === 'text/plain' || file.mimeType === 'application/json' || file.mimeType?.startsWith('text/')) {
                const contentRes = await drive.files.get({ fileId: file.id!, alt: 'media' });
                content = typeof contentRes.data === 'string' ? contentRes.data : JSON.stringify(contentRes.data);
              } else {
                content = `[File from Drive: ${file.name} (${file.mimeType})]`;
              }
              const embedding = await generateEmbedding(content, apiKey as string);
              await supabase.from('files').insert({
                name: file.name, category: folderName, content, type: file.mimeType, drive_file_id: file.id, embedding
              });
              newFilesCount++;
            } catch (downloadErr) {
              console.error(`Failed to download ${file.name}:`, downloadErr);
            }
          }
        }
      }
    }
    res.json({ success: true, newFilesCount });
  } catch (e) {
    res.status(500).json({ success: false, message: "Failed to sync with Drive." });
  }
});

app.put("/api/files/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category } = req.body;
  await supabase.from('files').update({ name, category }).eq('id', id);
  res.json({ success: true });
});

app.delete("/api/files/:id", async (req, res) => {
  const { id } = req.params;
  await supabase.from('files').delete().eq('id', id);
  res.json({ success: true });
});

app.post("/api/files/cleanup", async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('files').delete().lt('expires_at', now);
    if (error && error.code === '42703') return res.json({ success: true, skipped: true });
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get("/api/files/download/:id", async (req, res) => {
  const { id } = req.params;
  const { data: file } = await supabase.from('files').select('*').eq('id', id).single();
  if (file) {
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Content-Type', file.type || 'application/octet-stream');
    res.send(file.content);
  } else {
    res.status(404).json({ success: false, message: "File not found." });
  }
});

app.post("/api/search", async (req, res) => {
  const { query, limit = 5, apiKey } = req.body;
  try {
    const embedding = await generateEmbedding(query, apiKey);
    if (!embedding) return res.status(500).json({ error: "Failed to generate embedding" });
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding, match_threshold: 0.5, match_count: limit,
    });
    if (error) throw error;
    res.json(documents);
  } catch (e) {
    res.status(500).json({ error: "Search failed" });
  }
});

async function startServer() {
  const PORT = process.env.PORT || 3000;
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => res.sendFile(path.resolve("dist/index.html")));
  }
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  startServer();
}

export default app;