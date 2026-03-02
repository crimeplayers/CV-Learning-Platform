import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, CheckCircle, Clock, BookOpen, MessageSquare, Send, Paperclip, Link as LinkIcon } from 'lucide-react';
import SidebarAI from './SidebarAI';
import { marked } from 'marked';

export default function UnitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const API_BASE_URL = import.meta.env.VITE_API_URL || '';
  const [unit, setUnit] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [grading, setGrading] = useState(false);
  const [gradeResult, setGradeResult] = useState<any>(null);
  const [submittingNote, setSubmittingNote] = useState(false);
  const [planActionMessage, setPlanActionMessage] = useState('');
  const [planActionError, setPlanActionError] = useState('');
  const [showPretestModal, setShowPretestModal] = useState(false);
  const [pretestQuestion, setPretestQuestion] = useState('');
  const [pretestAnswer, setPretestAnswer] = useState('');
  const [loadingPretest, setLoadingPretest] = useState(false);
  const [submittingPretest, setSubmittingPretest] = useState(false);
  const renderedPlan = useMemo(() => marked.parse(plan?.plan_content || ''), [plan?.plan_content]);
  const renderedPretestQuestion = useMemo(() => marked.parse(pretestQuestion || ''), [pretestQuestion]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    fetch(`${API_BASE_URL}/api/units/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setUnit(data));

    fetch(`${API_BASE_URL}/api/plans/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setPlan(data));

    fetch(`${API_BASE_URL}/api/notes/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setNotes(data));
  }, [id, navigate]);

  const generatePlan = async (inputPretestAnswer = '') => {
    setLoadingPlan(true);
    setPlanActionError('');
    setPlanActionMessage('');
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/plans/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitId: id, pretestAnswer: inputPretestAnswer }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '学习计划生成失败');
      }
      setPlan(data);
      if (typeof data.remaining_generate_count === 'number') {
        setPlanActionMessage(`学习计划已更新。剩余可重生成次数：${data.remaining_generate_count}`);
      }
    } catch (err) {
      console.error(err);
      setPlanActionError(err instanceof Error ? err.message : '学习计划生成失败');
      throw err;
    } finally {
      setLoadingPlan(false);
    }
  };

  const handlePlanButtonClick = async () => {
    if (plan) {
      await generatePlan();
      return;
    }

    setLoadingPretest(true);
    setPlanActionError('');
    setPlanActionMessage('');
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/plans/pretest/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '无法加载测评题');
      }

      setPretestQuestion(data?.question || '');
      setPretestAnswer('');
      setShowPretestModal(true);
    } catch (err) {
      console.error(err);
      setPlanActionError(err instanceof Error ? err.message : '无法加载测评题');
    } finally {
      setLoadingPretest(false);
    }
  };

  const submitPretestAndGenerate = async () => {
    const answer = pretestAnswer.trim();
    if (!answer) {
      setPlanActionError('请先填写测评答案后再生成学习计划。');
      return;
    }

    setSubmittingPretest(true);
    try {
      await generatePlan(answer);
      setShowPretestModal(false);
      setPretestQuestion('');
      setPretestAnswer('');
    } finally {
      setSubmittingPretest(false);
    }
  };

  const submitNote = async () => {
    if (!newNote.trim() && !file) return;
    setSubmittingNote(true);
    const token = localStorage.getItem('token');
    try {
      const formData = new FormData();
      formData.append('unitId', id!);
      formData.append('week', unit.week_range);
      formData.append('content', newNote);
      if (file) {
        formData.append('file', file);
      }

      const noteRes = await fetch(`${API_BASE_URL}/api/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const noteData = await noteRes.json();
      if (!noteRes.ok) {
        throw new Error(noteData?.error || '笔记提交失败');
      }
      if (noteData?.plan_adjusted) {
        setPlanActionMessage(`已根据笔记更新计划。剩余可调整次数：${noteData.remaining_adjust_count ?? '-'} `);
        setPlanActionError('');
      } else if (noteData?.adjust_skipped_reason) {
        setPlanActionError(noteData.adjust_skipped_reason);
      }
      setNewNote('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // Refresh notes and plan
      fetch(`${API_BASE_URL}/api/notes/${id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setNotes(data));
      fetch(`${API_BASE_URL}/api/plans/${id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setPlan(data));
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingNote(false);
    }
  };

  const gradeUnit = async () => {
    setGrading(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/grade/${id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setGradeResult(data);
      // Refresh notes to show grade
      fetch(`${API_BASE_URL}/api/notes/${id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setNotes(data));
    } catch (err) {
      console.error(err);
    } finally {
      setGrading(false);
    }
  };

  if (!unit) return <div className="p-8 text-center text-slate-500">加载中...</div>;

  let resources = [];
  try {
    resources = JSON.parse(unit.resources || '[]');
  } catch (e) {}

  const maxGenerateCount = Number(plan?.max_generate_count ?? 3);
  const generateCount = Number(plan?.generate_count || 0);
  const remainingGenerateCount = plan
    ? Number(plan?.remaining_generate_count ?? Math.max(0, maxGenerateCount - generateCount))
    : maxGenerateCount;

  const maxAdjustCount = Number(plan?.max_adjust_count ?? 3);
  const adjustCount = Number(plan?.adjust_count || 0);
  const remainingAdjustCount = plan
    ? Number(plan?.remaining_adjust_count ?? Math.max(0, maxAdjustCount - adjustCount))
    : maxAdjustCount;

  const contextContent = `
单元名称：${unit.title}
单元描述：${unit.description}
学习目标：${unit.objectives}
相关学习资源：${resources.map((r: any) => r.title).join(', ')}
当前学习计划：${plan?.plan_content || '无'}
最近一次笔记：${notes[0]?.content || '无'}
`;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Main Content */}
      <div className="flex-1 max-w-5xl mx-auto p-8 pr-16 lg:pr-[26rem] transition-all duration-300">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center text-slate-500 hover:text-indigo-600 mb-6 transition"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> 返回课程列表
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <div className="text-indigo-600 font-medium mb-2">第 {unit.week_range} 周</div>
              <h1 className="text-3xl font-bold text-slate-900">{unit.title}</h1>
            </div>
            <div className="bg-slate-100 p-3 rounded-xl">
              <BookOpen className="w-8 h-8 text-slate-600" />
            </div>
          </div>
          <p className="text-slate-600 text-lg mb-6">{unit.description}</p>
          
          <div className="bg-indigo-50 rounded-xl p-6 border border-indigo-100 mb-6">
            <h3 className="text-indigo-900 font-semibold mb-2 flex items-center">
              <CheckCircle className="w-5 h-5 mr-2" /> 学习目标
            </h3>
            <p className="text-indigo-800">{unit.objectives}</p>
          </div>

          {resources.length > 0 && (
            <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
              <h3 className="text-slate-900 font-semibold mb-4 flex items-center">
                <LinkIcon className="w-5 h-5 mr-2 text-slate-600" /> 学习资源
              </h3>
              <ul className="space-y-3">
                {resources.map((res: any, idx: number) => (
                  <li key={idx} className="flex flex-col">
                    <div className="flex items-center">
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full mr-2"></span>
                      {res.url ? (
                        <a href={res.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium">
                          {res.title}
                        </a>
                      ) : (
                        <span className="text-slate-800 font-medium">{res.title}</span>
                      )}
                    </div>
                    {res.description && (
                      <p className="text-sm text-slate-500 mt-1 ml-3.5">{res.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Study Plan Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-slate-900 flex items-center">
              <Clock className="w-6 h-6 mr-2 text-indigo-600" /> AI 学习计划
            </h2>
            <button
              onClick={handlePlanButtonClick}
              disabled={loadingPlan || loadingPretest || remainingGenerateCount <= 0}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loadingPlan || submittingPretest ? '生成中...' : loadingPretest ? '加载测评题...' : plan ? '重新生成学习计划' : '生成学习计划'}
            </button>
          </div>

          <div className="text-sm text-slate-500 mb-4">
            学习计划生成次数：{generateCount}/{maxGenerateCount}（剩余 {remainingGenerateCount} 次）
          </div>
          {planActionMessage && <div className="text-sm text-emerald-600 mb-3">{planActionMessage}</div>}
          {planActionError && <div className="text-sm text-rose-600 mb-3">{planActionError}</div>}
          
          {plan ? (
            <div
              className="prose prose-indigo max-w-none text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderedPlan as any }}
            />
          ) : (
            <div className="text-center py-8 text-slate-500">
              暂无学习计划，点击右上角按钮生成。
            </div>
          )}
        </div>

        {/* Notes Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center mb-6">
            <FileText className="w-6 h-6 mr-2 text-indigo-600" /> 学习笔记
          </h2>
          
          <div className="mb-8">
            <label className="block text-sm font-medium text-slate-700 mb-2">提交新笔记 (提交后AI将动态调整计划)</label>
            <div className="text-sm text-slate-500 mb-2">
              计划自动调整次数：{adjustCount}/{maxAdjustCount}（剩余 {remainingAdjustCount} 次）
            </div>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="w-full h-32 px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition resize-none mb-3"
              placeholder="在这里记录你的学习心得、遇到的问题..."
            />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="file"
                  id="note-file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  ref={fileInputRef}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <label
                  htmlFor="note-file"
                  className="cursor-pointer flex items-center text-sm text-slate-600 hover:text-indigo-600 transition"
                >
                  <Paperclip className="w-4 h-4 mr-1" />
                  {file ? file.name : '添加附件 (PDF, 图片等)'}
                </label>
                {file && (
                  <button
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="ml-2 text-red-500 hover:text-red-700 text-sm"
                  >
                    删除
                  </button>
                )}
              </div>
              
              <button
                onClick={submitNote}
                disabled={(!newNote.trim() && !file) || submittingNote}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 flex items-center"
              >
                <Send className="w-4 h-4 mr-2" /> {submittingNote ? '提交中...' : '提交笔记'}
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-slate-900 border-b pb-2">历史笔记</h3>
            {notes.length === 0 ? (
              <p className="text-slate-500 text-center py-4">暂无笔记记录。</p>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                  <div className="text-sm text-slate-500 mb-3 flex items-center">
                    <Clock className="w-4 h-4 mr-1" /> {new Date(note.created_at).toLocaleString()}
                  </div>
                  <p className="text-slate-800 whitespace-pre-wrap mb-4">{note.content}</p>
                  
                  {note.file_url && (
                    <div className="mb-4">
                      <a 
                        href={note.file_url} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg transition"
                      >
                        <Paperclip className="w-4 h-4 mr-1.5" />
                        查看附件
                      </a>
                    </div>
                  )}

                  {note.grade && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <div className="flex items-center mb-2">
                        <span className="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">评分: {note.grade}</span>
                      </div>
                      <p className="text-sm text-slate-600"><strong>AI反馈:</strong> {note.feedback}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Grading Section */}
        {notes.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">单元结课评分</h3>
              <p className="text-slate-500 text-sm">根据最后一次提交的笔记和学习计划进行AI评分。</p>
            </div>
            <button
              onClick={gradeUnit}
              disabled={grading}
              className="bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {grading ? '评分中...' : '进行AI评分'}
            </button>
          </div>
        )}
      </div>

      {/* AI Sidebar */}
      <SidebarAI context={contextContent} unitId={id} />

      {showPretestModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-900 mb-3">首次学习计划生成前测评</h3>
            <div
              className="prose prose-slate max-w-none text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 max-h-72 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: renderedPretestQuestion as any }}
            />

            <label className="block text-sm font-medium text-slate-700 mb-2">请输入你的答案（用于评估基础水平）</label>
            <textarea
              value={pretestAnswer}
              onChange={(e) => setPretestAnswer(e.target.value)}
              className="w-full h-36 px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition resize-none"
              placeholder="请按题目要求作答，AI将根据你的基础水平制定计划。"
            />

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  if (submittingPretest || loadingPlan) return;
                  setShowPretestModal(false);
                }}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
                disabled={submittingPretest || loadingPlan}
              >
                取消
              </button>
              <button
                onClick={submitPretestAndGenerate}
                disabled={submittingPretest || loadingPlan || !pretestAnswer.trim()}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {submittingPretest || loadingPlan ? '提交并生成中...' : '提交答案并生成计划'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
