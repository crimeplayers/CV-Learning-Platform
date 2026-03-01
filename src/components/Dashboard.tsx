import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, LogOut, FileText, CheckCircle } from 'lucide-react';

export default function Dashboard() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [units, setUnits] = useState<any[]>([]);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    fetch(`${API_BASE_URL}/api/units`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setUnits(data))
      .catch(console.error);
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <BookOpen className="w-6 h-6 text-indigo-600 mr-2" />
              <span className="font-semibold text-xl text-slate-900">计算机视觉基础</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-slate-600">你好, {user.username}</span>
              {user.role === 'admin' && (
                <button
                  onClick={() => navigate('/admin')}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium transition"
                >
                  管理后台
                </button>
              )}
              <button
                onClick={handleLogout}
                className="text-slate-500 hover:text-slate-700 flex items-center transition"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">课程单元</h1>
          <p className="text-slate-600 mt-2">按照顺序完成以下单元的学习任务。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {units.map((unit, index) => (
            <div
              key={unit.id}
              onClick={() => navigate(`/unit/${unit.id}`)}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 cursor-pointer hover:shadow-md transition group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="bg-indigo-50 text-indigo-700 text-sm font-medium px-3 py-1 rounded-full">
                  第 {unit.week_range} 周
                </div>
                <div className="text-slate-300 group-hover:text-indigo-500 transition">
                  <FileText className="w-6 h-6" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {index + 1}. {unit.title}
              </h3>
              <p className="text-slate-600 text-sm line-clamp-2 mb-4">
                {unit.description}
              </p>
              <div className="flex items-center text-sm text-indigo-600 font-medium">
                进入学习 &rarr;
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
