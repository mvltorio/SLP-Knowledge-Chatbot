import React, { useState, useEffect, useRef } from 'react';
import HybridSearchService, { HybridSearchResponse } from '../services/hybridSearch';
import { File, Send, LoaderCircle, Download } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
}

export default function SLPChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hybridSearch, setHybridSearch] = useState<HybridSearchService | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Available SLP categories
  const categories = ['PROPOSAL', 'GUIDELINES', 'FORMS', 'REPORTS', 'ALL'];
  
  // Initialize hybrid search
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!apiKey) {
      console.error('Missing Groq API key');
      return;
    }
    
    const service = new HybridSearchService(apiKey);
    service.initPagefind().then(() => {
      setHybridSearch(service);
      console.log('✅ Hybrid search ready');
    });
  }, []);
  
  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !hybridSearch) return;
    
    // Add user message
    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    
    try {
      // Perform hybrid search
      const options = selectedCategory && selectedCategory !== 'ALL' 
        ? { category: selectedCategory }
        : {};
      
      const response = await hybridSearch.searchWithRetry(input, options);
      
      // Format assistant message with sources
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.answer,
        sources: response.sources
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
    } catch (error) {
      console.error('Search failed:', error);
      
      // Error message
      const errorMessage: Message = {
        role: 'assistant',
        content: '⚠️ An error occurred. Please try again in a moment.'
      };
      setMessages(prev => [...prev, errorMessage]);
      
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar with filters */}
      <div className="w-64 bg-white border-r p-4">
        <h2 className="font-bold text-lg mb-4">SLP Documents</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Filter by Category</label>
          <select 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full p-2 border rounded-lg"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        
        <div className="text-xs text-gray-500 mt-4">
          <p>🔍 Pagefind: Fast document search</p>
          <p>🤖 Groq: AI-powered answers</p>
          <p className="mt-2">Try asking:</p>
          <ul className="list-disc pl-4 mt-1">
            <li>"fish vending proposals"</li>
            <li>"what is Punla phase?"</li>
            <li>"URA Fishpond details"</li>
          </ul>
        </div>
      </div>
      
      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <h3 className="text-2xl font-bold mb-2">SLP Knowledge Assistant</h3>
                <p>Ask about proposals, guidelines, or specific documents</p>
              </div>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
            >
              <div
                className={`inline-block max-w-2xl p-4 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border shadow-sm'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                
                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-bold mb-2">📄 SOURCES:</p>
                    {msg.sources.map((source, i) => (
                      <div key={i} className="text-xs mb-2 p-2 bg-gray-50 rounded">
                        <div className="font-bold">{source.fileName}</div>
                        <div className="text-gray-500">Folder: {source.category}</div>
                        <div className="mt-1 italic">"{source.excerpt}"</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex items-center gap-2 text-gray-500">
              <LoaderCircle className="w-4 h-4 animate-spin" />
              <span>Searching documents and generating answer...</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
        
        {/* Input form */}
        <form onSubmit={handleSubmit} className="p-4 border-t bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about SLP documents..."
              className="flex-1 p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="p-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}