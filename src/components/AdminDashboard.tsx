import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Settings, ArrowLeft, Plus, Edit, Trash2, Save } from 'lucide-react';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'users' | 'settings'>('users');
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
        {activeTab === 'users' ? <UsersManagement /> : <AISettings />}
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

function AISettings() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [settings, setSettings] = useState({ ai_api_key: '', ai_base_url: '', ai_model: 'gemini-3-flash-preview' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

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

        <div className="pt-4 flex items-center">
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 flex items-center disabled:opacity-50 transition"
          >
            <Save className="w-4 h-4 mr-2" /> {saving ? '保存中...' : '保存配置'}
          </button>
          {message && <span className="ml-4 text-emerald-600 text-sm font-medium">{message}</span>}
        </div>
      </div>
    </div>
  );
}
