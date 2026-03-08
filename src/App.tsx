import { useState, FormEvent, ChangeEvent, useEffect } from 'react';
import { Paperclip, Send, File, X, LoaderCircle, LogOut, Users, CheckCircle, FolderOpen, ChevronRight, Edit3, Download, Key, Leaf, Plus, UserPlus, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateContent, KnowledgeDocument, analyzeImage } from './services/geminiService';
import { Message } from './types';
import Chart from './components/Chart';
import SLPChat from './components/SLPChat';

import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface UploadedFile {
  file?: File;
  id?: number;
  name: string;
  size?: number;
  type: string;
  category: string;
  content?: string;
}

interface User {
  email: string;
  role: 'admin' | 'user';
}

const CATEGORIES = [
  'GUIDELINES',
  'FORMS AND TEMPLATES',
  'ACTIVITY PHOTOS',
  'SLPIS',
  'SLP DPT',
  'PROPOSAL',
  'OTHERS FILES'
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'login' | 'register' | 'chat' | 'admin'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeDocument[]>([]);
  const [editingFile, setEditingFile] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [showOAuthDebug, setShowOAuthDebug] = useState(false);
  const [oAuthDebugInfo, setOAuthDebugInfo] = useState<any>(null);
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidationError, setKeyValidationError] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<{ status: 'ok' | 'error' | 'loading', message?: string, hint?: string }>({ status: 'loading' });
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('gemini_custom_key') || '');
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>(() =>
    (localStorage.getItem('gemini_key_status') as any) || 'idle'
  );
  const [quotaError, setQuotaError] = useState(false);
  const [retryCooldown, setRetryCooldown] = useState(0);
  const [estimatedTokens, setEstimatedTokens] = useState(0);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user');
  const [editingAdminUser, setEditingAdminUser] = useState<any>(null);

  // Auto restore login session
  useEffect(() => {
    const savedUser = localStorage.getItem('slp_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        setView('chat');
      } catch {
        localStorage.removeItem('slp_user');
      }
    }
  }, []);

  // Cooldown timer effect
  useEffect(() => {
    if (retryCooldown > 0) {
      const timer = setTimeout(() => setRetryCooldown(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [retryCooldown]);

  // Estimate tokens when knowledge base or messages change
  useEffect(() => {
    const kbText = knowledgeBase.map(doc => doc.content).join(' ');
    const msgText = messages.map(msg => msg.text).join(' ');
    const totalChars = kbText.length + msgText.length;
    setEstimatedTokens(Math.ceil(totalChars / 4));
  }, [knowledgeBase, messages]);

  // Auth Handlers
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthMessage('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });

      const data = await res.json();

      if (data.success && data.user) {
        setUser(data.user);
        localStorage.setItem('slp_user', JSON.stringify(data.user));
        setView('chat');
      } else {
        setAuthMessage(data.message || 'Login failed.');
      }
    } catch (error) {
      console.error('Login error:', error);
      setAuthMessage('Connection error.');
    }
  };

  const handleClearChat = () => {
    if (window.confirm('Clear all messages? This will also reset your token usage.')) {
      setMessages([]);
      setQuotaError(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setAuthMessage('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });
      const data = await res.json();
      setAuthMessage(data.message);
      if (data.success) setView('login');
    } catch (e) {
      setAuthMessage('Connection error. Please check your database configuration.');
    }
  };

  const fetchAdminUsers = async () => {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    setAdminUsers(data);
  };

  useEffect(() => {
    fetchAdminUsers();
  }, []);

  const approveUser = async (userId: number, role: string) => {
    try {
      const res = await fetch('/api/admin/update-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          role,
          status: "approved"
        })
      });
      const data = await res.json();
      if (!data.success) {
        alert('Failed to approve user: ' + data.message);
      }
      fetchAdminUsers();
    } catch (e) {
      console.error('Approval error:', e);
      alert('Connection error while approving user.');
    }
  };

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail, password: newUserPassword, role: newUserRole })
      });
      const data = await res.json();
      if (data.success) {
        setIsAddingUser(false);
        setNewUserEmail('');
        setNewUserPassword('');
        fetchAdminUsers();
      } else {
        alert('Failed to add user: ' + data.message);
      }
    } catch (e) {
      alert('Connection error.');
    }
  };

  const handleUpdateUserRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingAdminUser) return;
    try {
      const res = await fetch('/api/admin/update-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: editingAdminUser.id, role: editingAdminUser.role })
      });
      const data = await res.json();
      if (data.success) {
        setEditingAdminUser(null);
        fetchAdminUsers();
      } else {
        alert('Failed to update user: ' + data.message);
      }
    } catch (e) {
      alert('Connection error.');
    }
  };

  const rejectUser = async (userId: number) => {
    if (window.confirm('Are you sure you want to reject/delete this user?')) {
      try {
        const res = await fetch('/api/admin/delete-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });

        const data = await res.json();

        if (!data.success) {
          alert('Failed to reject user: ' + data.message);
        }

        fetchAdminUsers();

      } catch (e) {
        console.error('Rejection error:', e);
        alert('Connection error while rejecting user.');
      }
    }
  };

  const fetchKnowledgeBase = async () => {
    const res = await fetch('/api/files');
    const data = await res.json();
    setKnowledgeBase(data);
  };

  const deleteFile = async (id: number) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this document?"
    );

    if (!confirmDelete) return;

    const res = await fetch(`/api/files?id=${id}`, {
      method: "DELETE"
    });

    const data = await res.json();

    if (!res.ok) {
      alert("Delete failed");
      console.error(data);
      return;
    }

    fetchKnowledgeBase();
  };

  const updateFile = async (e: FormEvent) => {
    e.preventDefault();
    await fetch(`/api/files/${editingFile.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editingFile.name, category: editingFile.category })
    });
    setEditingFile(null);
    fetchKnowledgeBase();
  };

  const handleConnectDrive = () => {
    window.open(
      "https://drive.google.com/drive/folders/1gD2-yPxfUVazMp3jycUxBnHvLtGt7jy_",
      "_blank"
    );
  };

  const handleSyncDrive = async () => {
    alert("Google Drive sync is disabled.");
  };

  const handleFetchOAuthDebug = async () => {
    try {
      const res = await fetch('/api/auth/google/debug');
      const data = await res.json();
      setOAuthDebugInfo(data);
      setShowOAuthDebug(true);
    } catch (err) {
      alert("Failed to fetch OAuth debug info.");
    }
  };

  useEffect(() => {
    const checkDriveStatus = async () => {
      try {
        const res = await fetch('/api/drive/status');
        const data = await res.json();
        setIsDriveConnected(data.connected);
      } catch (e) {
        console.error('Failed to check drive status:', e);
      }
    };
    const checkDbHealth = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        setDbStatus(data);
      } catch (e) {
        setDbStatus({ status: 'error', message: 'Could not connect to backend.' });
      }
    };
    const cleanupFiles = async () => {
      try {
        await fetch('/api/cleanup', { method: 'POST' });
      } catch (e) {
        console.error('Cleanup failed:', e);
      }
    };
    checkDbHealth();
    cleanupFiles();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setIsDriveConnected(true);
        fetchKnowledgeBase();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (view === 'admin') fetchAdminUsers();
    if (view === 'chat') fetchKnowledgeBase();
  }, [view]);

  const extractTextFromPDF = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n';
      }
      return fullText;
    } catch (error) {
      console.error('Error extracting PDF text:', error);
      return '[Error extracting text from PDF]';
    }
  };

  const extractTextFromDocx = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (error) {
      console.error('Error extracting Docx text:', error);
      return '[Error extracting text from Word document]';
    }
  };

  const extractTextFromExcel = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer);
      let fullText = '';

      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        fullText += `--- Sheet: ${sheetName} ---\n${csv}\n\n`;
      });

      return fullText;
    } catch (error) {
      console.error('Error extracting Excel text:', error);
      return '[Error extracting text from Excel document]';
    }
  };

  // Chat Handlers
  const handleFileChange = async (selectedFiles: FileList | null, overrideCategory?: string) => {
    if (selectedFiles) {
      setIsLoading(true);
      const filesArray = Array.from(selectedFiles);
      const targetCategory = overrideCategory || selectedCategory;
      let processedCount = 0;

      try {
        for (const file of filesArray) {
          let content = '';
          const isText = file.type.startsWith('text/') ||
            file.type === 'application/json' ||
            file.name.endsWith('.txt') ||
            file.name.endsWith('.md') ||
            file.name.endsWith('.csv');
          const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf');
          const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx');
          const isExcel = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.type === 'application/vnd.ms-excel' ||
            file.name.endsWith('.xlsx') ||
            file.name.endsWith('.xls');
          const isImage = file.type.startsWith('image/');

          try {
            if (isPDF) {
              content = await extractTextFromPDF(file);
            } else if (isDocx) {
              content = await extractTextFromDocx(file);
            } else if (isExcel) {
              content = await extractTextFromExcel(file);
            } else if (isImage) {
              if (processedCount > 0 && processedCount % 5 === 0) {
                await new Promise(r => setTimeout(r, 2000));
              }
              content = await analyzeImage(file, customApiKey);
              processedCount++;
            } else if (isText) {
              const reader = new FileReader();
              content = await new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string);
                reader.readAsText(file);
              });
            } else {
              content = `[Binary File: ${file.type || 'unknown type'}]`;
            }

            await fetch('/api/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: file.name,
                category: targetCategory,
                content: content,
                type: file.type,
                apiKey: customApiKey
              })
            });

            await new Promise(r => setTimeout(r, 100));
          } catch (fileError: any) {
            console.error(`Error processing file ${file.name}:`, fileError);
            const errorMsg = fileError.message?.includes('429')
              ? 'Quota exceeded. Please wait a moment and try again.'
              : 'Error processing file.';
            alert(`Failed to upload ${file.name}: ${errorMsg}`);
            if (fileError.message?.includes('429')) {
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
        fetchKnowledgeBase();
      } catch (globalError) {
        console.error('Global upload error:', globalError);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    fetch('/api/cleanup', { method: 'POST' }).catch(() => {});

    const isQuotaError = (err: any) => {
      const errStr = JSON.stringify(err).toUpperCase();
      const msgStr = (err.message || '').toUpperCase();
      return errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || msgStr.includes('429') || msgStr.includes('RESOURCE_EXHAUSTED');
    };

    try {
      const response = await generateContent(currentInput, [], knowledgeBase, customApiKey, messages);
      setQuotaError(false);
      const modelResponse: Message = {
        role: 'model',
        text: response.text,
        chart: response.chart,
        fileDownload: response.fileDownload
      };
      setMessages(prev => [...prev, modelResponse]);
    } catch (error: any) {
      console.error("Error generating content:", error);
      let errorMessage = `Error: ${error.message || 'Something went wrong.'}`;

      if (isQuotaError(error)) {
        setQuotaError(true);
        if (customApiKey) {
          errorMessage = "⚠️ **Your API Quota Exhausted**: Your private key has reached its temporary limit (15 requests/min). Please wait 60 seconds and try again.";
        } else {
          errorMessage = "⚠️ **Shared Quota Exhausted**: The shared AI limit has been reached. \n\nTo fix this permanently and for free, please paste your own API key in the sidebar. [Get a free key here](https://aistudio.google.com/app/apikey).";
        }
      }

      const errorResponse: Message = {
        role: 'model',
        text: errorMessage,
      };
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    if (retryCooldown > 0) return;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      setInput(lastUserMsg.text);
      setRetryCooldown(5);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'model' && (last.text.includes('Error') || last.text.includes('Quota'))) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }
  };

  // Render based on view
  if (view === 'login' || view === 'register') {
    return (
      <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-emerald-100">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">SLP Knowledge Chatbot</h1>
            <p className="text-gray-500 mt-2">{view === 'login' ? 'Sign in to your account' : 'Create a new account'}</p>
            {dbStatus.status === 'error' && (
              <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl text-left">
                <p className="text-red-700 text-xs font-bold uppercase mb-1">Database Error</p>
                <p className="text-red-600 text-sm">{dbStatus.message}</p>
                {dbStatus.hint && <p className="text-red-500 text-xs mt-2 italic">{dbStatus.hint}</p>}
              </div>
            )}
          </div>

          <form onSubmit={view === 'login' ? handleLogin : handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none transition"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none transition"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>
            {authMessage && <p className={`text-sm ${authMessage.includes('success') ? 'text-emerald-600' : 'text-red-500'}`}>{authMessage}</p>}
            <button type="submit" className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition shadow-lg shadow-emerald-200">
              {view === 'login' ? 'Sign In' : 'Register'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setView(view === 'login' ? 'register' : 'login'); setAuthMessage(''); }}
              className="text-emerald-600 text-sm font-medium hover:underline"
            >
              {view === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'admin') {
    return (
      <div className="min-h-screen bg-emerald-50 p-8">
        <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-emerald-100">
          <div className="p-8 border-b border-gray-100 flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-gray-500">Manage user access and approvals</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setIsAddingUser(true)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-bold shadow-lg shadow-emerald-100"
              >
                <UserPlus className="w-4 h-4" /> Add User
              </button>
              <button onClick={() => setView('chat')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">
                Back to Chat
              </button>
            </div>
          </div>
          <div className="p-8">
            <div className="space-y-4">
              {adminUsers.length === 0 && <p className="text-gray-500 text-center py-8">No users found.</p>}
              {adminUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <div>
                    <p className="font-semibold text-gray-900">{u.email}</p>
                    <div className="flex gap-2 items-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {u.role}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${u.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {u.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {u.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <select
                          id={`role-${u.id}`}
                          className="text-xs p-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          defaultValue="user"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          onClick={() => {
                            const roleSelect = document.getElementById(`role-${u.id}`) as HTMLSelectElement;
                            approveUser(u.id, roleSelect.value);
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition text-sm font-bold"
                        >
                          <CheckCircle className="w-4 h-4" /> Approve
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setEditingAdminUser(u)}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                        title="Edit User Role"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => rejectUser(u.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition text-sm font-bold"
                      >
                        <X className="w-4 h-4" /> {u.status === 'pending' ? 'Reject' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Add User Modal */}
        {isAddingUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Add New User</h2>
              <form onSubmit={handleAddUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as any)}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsAddingUser(false)} className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition">
                    Cancel
                  </button>
                  <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">
                    Add User
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit User Role Modal */}
        {editingAdminUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Edit User Role</h2>
              <p className="text-sm text-gray-500 mb-4">Updating role for: <span className="font-bold text-gray-700">{editingAdminUser.email}</span></p>
              <form onSubmit={handleUpdateUserRole} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={editingAdminUser.role}
                    onChange={(e) => setEditingAdminUser({ ...editingAdminUser, role: e.target.value })}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setEditingAdminUser(null)} className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition">
                    Cancel
                  </button>
                  <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">
                    Update Role
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Chat view
  return <SLPChat />;
}

export default App;