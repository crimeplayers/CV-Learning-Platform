import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Settings, ArrowLeft, Plus, Edit, Trash2, Save, FileText } from 'lucide-react';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'users' | 'records' | 'settings'>('users');
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    if (user.role !== 'admin') {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col">
        <div className="flex items-center mb-8 px-2">
          <span className="font-bold text-xl text-slate-900">管理后台</span>
        </div>
        <nav className="space-y-1 flex-1">
          <button
            onClick={() => setActiveTab('users')}
            className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-lg ${activeTab === 'users' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            <Users className="w-5 h-5 mr-3" /> 学生账户管理
          </button>
          <button
            onClick={() => setActiveTab('records')}
            className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-lg ${activeTab === 'records' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            <FileText className="w-5 h-5 mr-3" /> 学习记录
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-lg ${activeTab === 'settings' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            <Settings className="w-5 h-5 mr-3" /> AI 配置
          </button>
        </nav>
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition mt-auto"
        >
          <ArrowLeft className="w-5 h-5 mr-3" /> 返回前台
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        {activeTab === 'users' ? <UsersManagement /> : activeTab === 'records' ? <AdminRecords /> : <AISettings />}
      </div>
    </div>
  );
}

function UsersManagement() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [users, setUsers] = useState<any[]>([]);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'student' });

  const fetchUsers = () => {
    fetch(`${API_BASE_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(res => res.json())
      .then(data => setUsers(data));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingUser ? `${API_BASE_URL}/api/admin/users/${editingUser.id}` : `${API_BASE_URL}/api/admin/users`;
    const method = editingUser ? 'PUT' : 'POST';
    
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(formData)
    });
    
    setIsModalOpen(false);
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'student' });
    fetchUsers();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该用户吗？')) return;
    await fetch(`${API_BASE_URL}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    fetchUsers();
  };

  const openEdit = (user: any) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role });
    setIsModalOpen(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900">学生账户管理</h2>
        <button
          onClick={() => { setEditingUser(null); setFormData({ username: '', password: '', role: 'student' }); setIsModalOpen(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center transition"
        >
          <Plus className="w-4 h-4 mr-2" /> 添加账户
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">用户名</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">角色</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {users.map(user => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{user.id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{user.username}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
                    {user.role === 'admin' ? '管理员' : '学生'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button onClick={() => openEdit(user)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(user.id)} className="text-red-600 hover:text-red-900" disabled={user.username === 'admin'}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editingUser ? '编辑账户' : '添加账户'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">用户名</label>
                <input required type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">密码 {editingUser && <span className="text-slate-400 text-xs">(留空表示不修改)</span>}</label>
                <input type="password" required={!editingUser} value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">角色</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="student">学生</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminRecords() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [notes, setNotes] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const resolveFileUrl = (fileUrl: string | null) => {
    if (!fileUrl) return '';
    if (fileUrl.startsWith('http')) return fileUrl;
    return `${API_BASE_URL}${fileUrl}`;
  };

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE_URL}/api/admin/notes`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }).then(res => res.json()),
      fetch(`${API_BASE_URL}/api/admin/plans`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }).then(res => res.json())
    ])
      .then(([notesData, plansData]) => {
        setNotes(notesData);
        setPlans(plansData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatDate = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">学习记录</h2>
          <p className="text-slate-500 mt-1">管理员可查看所有学生提交的历史笔记和学习计划，并下载附件。</p>
        </div>
        <button onClick={loadData} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">刷新</button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-slate-500">加载中...</div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">学习笔记</h3>
                <p className="text-sm text-slate-500">查看全部学生的笔记内容、附件与评分。</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">学生</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">单元</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">周次</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">提交时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">评分</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">附件</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">内容摘要</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {notes.map((note: any) => (
                    <tr key={note.id}>
                      <td className="px-4 py-3 text-sm text-slate-800">{note.student_username}</td>
                      <td className="px-4 py-3 text-sm text-slate-800">{note.unit_title}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{note.week || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(note.created_at)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{note.grade ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-indigo-600">
                        {note.file_url ? (
                          <a className="hover:underline" href={resolveFileUrl(note.file_url)} target="_blank" rel="noreferrer">下载</a>
                        ) : (
                          <span className="text-slate-400">无</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 max-w-xs whitespace-pre-wrap">
                        {note.content ? `${note.content.slice(0, 100)}${note.content.length > 100 ? '...' : ''}` : '无'}
                      </td>
                    </tr>
                  ))}
                  {notes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">暂无笔记记录</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">学习计划</h3>
                <p className="text-sm text-slate-500">按更新时间查看所有学生的学习计划。</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">学生</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">单元</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">更新时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">计划内容</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {plans.map((plan: any) => (
                    <tr key={plan.id}>
                      <td className="px-4 py-3 text-sm text-slate-800">{plan.student_username}</td>
                      <td className="px-4 py-3 text-sm text-slate-800">{plan.unit_title}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(plan.updated_at)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap max-w-lg">{plan.plan_content}</td>
                    </tr>
                  ))}
                  {plans.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-500">暂无学习计划</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AISettings() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [settings, setSettings] = useState({ ai_api_key: '', ai_base_url: '', ai_model: 'gemini-3-flash-preview' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('你好，这是测试消息');
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/admin/settings`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(res => res.json())
      .then(data => {
        const newSettings = { ...settings };
        data.forEach((item: any) => {
          if (item.key in newSettings) {
            (newSettings as any)[item.key] = item.value;
          }
        });
        setSettings(newSettings);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    const payload = Object.entries(settings).map(([key, value]) => ({ key, value }));
    try {
      await fetch(`${API_BASE_URL}/api/admin/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ settings: payload })
      });
      setMessage('保存成功！');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ message: testMessage })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || '测试失败');
      }
      setTestResult(data.reply || 'AI 已响应，但无返回文本');
    } catch (err: any) {
      setTestResult(`错误: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">AI 配置</h2>
        <p className="text-slate-500 mt-1">配置网站使用的 AI 模型参数。</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">API Key</label>
          <input 
            type="password" 
            value={settings.ai_api_key} 
            onChange={e => setSettings({...settings, ai_api_key: e.target.value})} 
            placeholder="留空则使用环境变量中的 GEMINI_API_KEY"
            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" 
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Base URL</label>
          <input 
            type="text" 
            value={settings.ai_base_url} 
            onChange={e => setSettings({...settings, ai_base_url: e.target.value})} 
            placeholder="例如: https://generativelanguage.googleapis.com"
            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" 
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">模型名称</label>
          <input 
            type="text" 
            value={settings.ai_model} 
            onChange={e => setSettings({...settings, ai_model: e.target.value})} 
            placeholder="例如: gemini-3-flash-preview"
            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition" 
          />
        </div>

        <div className="pt-4 flex flex-col gap-3">
          <div className="flex items-center">
            <button 
              onClick={handleSave} 
              disabled={saving}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 flex items-center disabled:opacity-50 transition"
            >
              <Save className="w-4 h-4 mr-2" /> {saving ? '保存中...' : '保存配置'}
            </button>
            {message && <span className="ml-4 text-emerald-600 text-sm font-medium">{message}</span>}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              className="w-64 border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="测试消息"
            />
            <button
              onClick={handleTest}
              disabled={testing}
              className="bg-slate-100 text-slate-800 px-4 py-2 rounded-lg hover:bg-slate-200 transition disabled:opacity-50"
            >
              {testing ? '测试中...' : '发送测试消息'}
            </button>
          </div>
          {testResult && (
            <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">
              {testResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
