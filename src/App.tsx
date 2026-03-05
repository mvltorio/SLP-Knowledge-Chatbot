import { useState, FormEvent, ChangeEvent, useEffect } from 'react';
import { Paperclip, Send, File, X, LoaderCircle, LogOut, Users, CheckCircle, FolderOpen, ChevronRight, Edit3, Download, Key, Leaf, Plus, UserPlus, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateContent, KnowledgeDocument, analyzeImage } from './services/geminiService';
import { Message } from './types';
import Chart from './components/Chart';

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

export default function App() {
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
      const res = await fetch('/api/auth/login', {
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
      const res = await fetch('/api/auth/register', {
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
        body: JSON.stringify({ userId, role })
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
    await fetch(`/api/files/${id}`, { method: 'DELETE' });
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
  return (
    <div className="h-screen w-screen bg-emerald-50 flex antialiased overflow-hidden">
      {/* Knowledge Panel */}
      <div className="w-96 bg-white border-r border-emerald-100 flex flex-col shadow-2xl">
        <div className="p-6 border-b border-emerald-50 bg-emerald-50/50">
          <div className="flex flex-col items-center mb-6">
            <div className="w-20 h-20 bg-emerald-600 rounded-3xl flex items-center justify-center shadow-lg mb-3 rotate-3 hover:rotate-0 transition-transform duration-300">
              <Leaf className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-xl font-bold text-emerald-900 text-center">SLP Knowledge Chatbot</h1>
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mt-1">Sustainable Livelihood Program</p>
          </div>

          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Control Panel</h2>
            <div className="flex gap-2">
              {user?.role === 'admin' && (
                <>
                  <button onClick={() => setView('admin')} className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition" title="Admin Panel">
                    <Users className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleFetchOAuthDebug}
                    className="p-2 text-gray-400 hover:bg-emerald-100 rounded-lg transition"
                    title="Debug Connection"
                  >
                    <LoaderCircle className="w-5 h-5" />
                  </button>
                </>
              )}
              <button onClick={() => {
                localStorage.removeItem('slp_user');
                setUser(null);
                setView('login');
              }}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {user?.role === 'admin' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-2"><Key className="w-3 h-3" /> Custom API Key</span>
                    <div className="flex items-center gap-2">
                      {keyStatus === 'validating' && <span className="text-blue-600 animate-pulse text-[10px]">Validating...</span>}
                      {keyStatus === 'valid' && (
                        <span className="text-emerald-600 text-[10px] flex items-center gap-1 font-mono">
                          <CheckCircle className="w-3 h-3" /> Active: ...{customApiKey.slice(-4)}
                        </span>
                      )}
                      {keyStatus === 'invalid' && <span className="text-red-500 text-[10px] flex items-center gap-1"><X className="w-3 h-3" /> Invalid Key</span>}
                      {isKeySaved && !keyStatus && <span className="text-emerald-600 animate-pulse flex items-center gap-1 text-[10px]"><CheckCircle className="w-3 h-3" /> Saved!</span>}
                    </div>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Paste your key here..."
                      className={`flex-1 px-3 py-2 bg-white border rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none transition 
                    ${keyStatus === 'valid' ? 'border-emerald-500 bg-emerald-50/30' :
                          keyStatus === 'invalid' ? 'border-red-300 bg-red-50/30' : 'border-emerald-200'}`}
                      value={customApiKey}
                      onChange={(e) => {
                        setCustomApiKey(e.target.value);
                        if (keyStatus !== 'idle') setKeyStatus('idle');
                      }}
                    />
                  </div>
                </div>

                <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100/50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase">Quota Monitor</span>
                    <span className={`text-[10px] font-bold ${estimatedTokens > 800000 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {estimatedTokens.toLocaleString()} / 1M TPM
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-emerald-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${estimatedTokens > 800000 ? 'bg-red-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, (estimatedTokens / 1000000) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-emerald-600 leading-tight">
                    Free tier limit: 15 RPM / 1M TPM. If you hit 100%, clear the chat or wait 60s.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Target Folder</label>
                  <div className="grid grid-cols-1 gap-1">
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).classList.add('bg-emerald-100');
                        }}
                        onDragLeave={(e) => {
                          (e.currentTarget as HTMLElement).classList.remove('bg-emerald-100');
                        }}
                        onDrop={async (e) => {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).classList.remove('bg-emerald-100');
                          setSelectedCategory(cat);
                          handleFileChange(e.dataTransfer.files, cat);
                        }}
                        className={`text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ${selectedCategory === cat ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-600 hover:bg-emerald-50'}`}
                      >
                        {cat}
                        {selectedCategory === cat && <ChevronRight className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {user?.role === 'user' && (
              <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                <p className="text-sm text-emerald-800 font-medium">Welcome to SLP Chatbot!</p>
                <p className="text-xs text-emerald-600 mt-2">You have access to the chat and the shared knowledge base. Ask anything about the guidelines or data.</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          {user?.role === 'admin' ? (
            <>
              <div
                className={`relative group h-40 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all ${isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-emerald-200 hover:border-emerald-400 bg-emerald-50/30'}`}
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileChange(e.dataTransfer.files); }}
              >
                <input
  type="file"
  multiple
  {...({ webkitdirectory: "true", directory: "" } as any)}
  className="absolute inset-0 opacity-0 cursor-pointer"
  onChange={(e) => handleFileChange(e.target.files)}
/>
                <Paperclip className="w-8 h-8 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-emerald-700 text-xs font-medium text-center px-4">Drop files into <span className="font-bold">{selectedCategory}</span></p>
              </div>

              {knowledgeBase.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Knowledge Base</h2>
                  <div className="space-y-2">
                    {knowledgeBase
                      .filter((file: any) => file.category === selectedCategory)
                      .map((file: any, idx) => (
                      <div key={idx} className="flex flex-col bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                        <div className="flex items-center justify-between min-w-0">
                          <div className="flex items-center min-w-0">
                            <File className="w-4 h-4 text-emerald-500 mr-3 flex-shrink-0" />
                            <div className="truncate">
                              <p className="text-sm font-medium text-emerald-900 truncate">{file.name}</p>
                              <p className="text-[10px] text-emerald-600 uppercase">{file.category}</p>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setPreviewFile(file)} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded transition" title="Preview Content">
                              <ChevronRight className="w-3 h-3" />
                            </button>
                            <button onClick={() => setEditingFile(file)} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded transition" title="Edit Document">
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteFile(file.id)} className="p-1 text-emerald-300 hover:text-red-500 transition" title="Delete Document">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <FolderOpen className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-emerald-900">Shared Knowledge Base</h3>
              <p className="text-sm text-emerald-600 mt-2 max-w-xs">
                The administrator has uploaded {knowledgeBase.length} documents to help answer your questions.
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-emerald-50 bg-emerald-50/30">
          <div className="flex flex-col items-center gap-1">
            <p className="text-[10px] text-emerald-700 font-bold tracking-widest uppercase">© 2026 MVLTORIO</p>
          </div>
        </div>

        {/* Edit Modal */}
        {editingFile && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Edit Document</h2>
              <form onSubmit={updateFile} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
                  <input
                    type="text"
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={editingFile.name}
                    onChange={(e) => setEditingFile({ ...editingFile, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={editingFile.category}
                    onChange={(e) => setEditingFile({ ...editingFile, category: e.target.value })}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setEditingFile(null)} className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition">
                    Cancel
                  </button>
                  <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {previewFile && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Preview: {previewFile.name}</h2>
                <button onClick={() => setPreviewFile(null)} className="p-2 hover:bg-gray-100 rounded-full transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto bg-gray-50 p-6 rounded-2xl border border-gray-200 font-mono text-sm whitespace-pre-wrap">
                {previewFile.content || '[No content extracted]'}
              </div>
            </div>
          </div>
        )}

        <div className="mt-auto p-6 border-t border-emerald-100 space-y-3">
          <button
            onClick={handleClearChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-emerald-600 border border-emerald-200 rounded-xl text-xs font-bold hover:bg-emerald-50 transition shadow-sm"
          >
            <X className="w-4 h-4" /> Clear Chat History
          </button>
        </div>
      </div>

      {/* Chat Panel */}
      <div className="flex-1 flex flex-col bg-emerald-50/30 relative">
        {quotaError && (
          <div className="absolute top-0 left-0 right-0 z-50 bg-red-600 text-white p-4 flex items-center justify-between shadow-lg animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-3">
              <Key className="w-6 h-6 animate-bounce" />
              <div>
                <p className="font-bold text-sm">AI Quota Exhausted!</p>
                <p className="text-xs opacity-90">Please paste your own FREE API key in the sidebar to continue.</p>
              </div>
            </div>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              className="px-4 py-2 bg-white text-red-600 rounded-xl text-xs font-bold hover:bg-red-50 transition shadow-sm"
            >
              Get Free Key
            </a>
          </div>
        )}
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-3xl mx-auto space-y-8">
            {messages.length === 0 && (
              <div className="text-center pt-20">
                <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                  <FolderOpen className="w-10 h-10 text-emerald-600" />
                </div>
                <h2 className="text-3xl font-bold text-emerald-900">Hello, {user?.email.split('@')[0]}</h2>
                <p className="text-emerald-600 mt-2 text-lg">I'm ready to analyze your knowledge base.</p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={idx} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'model' && (
                    <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-200">
                      <FolderOpen className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <div className={`p-5 rounded-3xl max-w-xl shadow-sm border ${msg.role === 'user' ? 'bg-emerald-600 text-white border-emerald-500 rounded-br-none' : 'bg-white text-gray-800 border-emerald-100 rounded-bl-none'}`}>
                    <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : 'prose-emerald'}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                    {msg.chart && <Chart spec={msg.chart} />}
                    {msg.fileDownload && (
                      <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <File className="w-5 h-5 text-emerald-600" />
                          <span className="text-sm font-medium text-emerald-900">{msg.fileDownload.name}</span>
                        </div>
                        <a
                          href={`/api/files/download/${msg.fileDownload.id}`}
                          download={msg.fileDownload.name}
                          className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition shadow-sm"
                          title="Download File"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                {msg.role === 'model' && (msg.text.includes('Error') || msg.text.includes('Quota')) && (
                  <button
                    onClick={handleRetry}
                    disabled={retryCooldown > 0}
                    className={`ml-14 text-xs font-bold flex items-center gap-1 ${retryCooldown > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-emerald-600 hover:underline'}`}
                  >
                    <Send className="w-3 h-3" /> {retryCooldown > 0 ? `Wait ${retryCooldown}s to retry` : 'Click here to retry after adding your key'}
                  </button>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <LoaderCircle className="w-5 h-5 animate-spin text-emerald-600" />
                </div>
                <div className="p-5 rounded-3xl bg-white border border-emerald-100 shadow-sm">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-emerald-200 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-emerald-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-8 bg-white border-t border-emerald-100">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSubmit} className="relative group">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your knowledge base..."
                className="w-full p-4 pr-24 bg-emerald-50/50 border border-emerald-100 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 focus:outline-none transition-all placeholder:text-emerald-300"
                disabled={isLoading}
              />
              <div className="absolute right-2 top-2 flex gap-2">
                <label className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl cursor-pointer transition-all">
                  <input
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;

                      setIsLoading(true);
                      try {
                        const file = files[0];
                        let content = '';
                        if (file.type === 'application/pdf') content = await extractTextFromPDF(file);
                        else if (file.type.includes('word')) content = await extractTextFromDocx(file);
                        else if (file.type.includes('excel') || file.type.includes('spreadsheet')) content = await extractTextFromExcel(file);
                        else if (file.type.startsWith('image/')) content = await analyzeImage(file, customApiKey);
                        else {
                          const reader = new FileReader();
                          content = await new Promise((resolve) => {
                            reader.onload = () => resolve(reader.result as string);
                            reader.readAsText(file);
                          });
                        }

                        const expiresAt = new Date();
                        expiresAt.setHours(expiresAt.getHours() + 24);

                        await fetch('/api/files/upload', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: file.name,
                            category: 'CHAT_UPLOAD',
                            content,
                            type: file.type,
                            expires_at: expiresAt.toISOString(),
                            apiKey: customApiKey
                          })
                        });

                        setMessages(prev => [...prev, {
                          role: 'user',
                          text: `Uploaded file: ${file.name} (Available for 24h)`
                        }]);

                        fetchKnowledgeBase();
                      } catch (err) {
                        console.error('Chat upload error:', err);
                        alert('Failed to upload file to chat.');
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                  />
                  <Paperclip className="w-6 h-6" />
                </label>
                <button
                  type="submit"
                  className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:bg-emerald-200 transition-all shadow-lg shadow-emerald-100"
                  disabled={isLoading || !input.trim()}
                >
                  <Send className="w-6 h-6" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* OAuth Debug Modal */}
        {showOAuthDebug && oAuthDebugInfo && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Google OAuth Debug</h2>
                <button onClick={() => setShowOAuthDebug(false)} className="p-2 hover:bg-gray-100 rounded-full transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4">
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-sm text-red-700 font-bold mb-2">MANDATORY ACTION:</p>
                  <p className="text-xs text-red-600 leading-relaxed">
                    You MUST copy the URI below and add it to your <strong>Google Cloud Console</strong> under
                    "Authorized redirect URIs" for your OAuth 2.0 Client ID.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Authorized Redirect URI to Add:</label>
                  <div className="p-3 bg-gray-100 rounded-xl font-mono text-xs break-all border border-gray-200 select-all">
                    {oAuthDebugInfo.calculatedRedirectUri}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Client ID Status:</label>
                    <p className="text-sm font-medium">{oAuthDebugInfo.clientId}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Client Secret Status:</label>
                    <p className="text-sm font-medium">{oAuthDebugInfo.clientSecret}</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Current Origin:</label>
                  <p className="text-xs font-mono">{oAuthDebugInfo.origin_passed}</p>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-xs text-blue-700">
                    <strong>Tip:</strong> If you are testing in the AI Studio preview, the URI will change between "Dev" and "Shared" views. You should add BOTH URIs to your Google Console.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowOAuthDebug(false)}
                className="mt-6 w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}