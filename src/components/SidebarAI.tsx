import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Bot, User, X, ChevronRight, ChevronLeft } from 'lucide-react';

export default function SidebarAI({ context }: { context: string }) {
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: userMsg, context }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'ai', content: data.answer }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { role: 'ai', content: '抱歉，我遇到了一些问题。' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`fixed right-0 top-0 h-full bg-white shadow-2xl border-l border-slate-200 transition-all duration-300 z-50 flex flex-col ${
        isOpen ? 'w-96' : 'w-12'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-indigo-50">
        {isOpen && (
          <div className="flex items-center text-indigo-900 font-semibold">
            <Bot className="w-5 h-5 mr-2 text-indigo-600" />
            AI 答疑助手
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-1 rounded-md hover:bg-indigo-100 text-indigo-600 transition"
        >
          {isOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Messages */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 text-sm mt-10">
              你好！我是你的AI答疑助手。
              <br />
              关于本单元的学习内容或笔记，有什么我可以帮你的吗？
            </div>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 text-slate-500 rounded-2xl rounded-tl-none px-4 py-2 text-sm shadow-sm flex items-center space-x-2">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-75" />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-150" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      {isOpen && (
        <div className="p-4 border-t border-slate-100 bg-white">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="输入你的问题..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
