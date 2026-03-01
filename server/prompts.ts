export const prompts = {
  // 1. AI学习计划生成提示词
  generatePlan: (unit: any, resourcesText: string) => `为学生制定本周学习计划。
单元名称：${unit.title}
学习时间：第${unit.week_range}周
单元描述：${unit.description}
学习目标：${unit.objectives}
相关学习资源：
${resourcesText}
总资源：FILES: /data/admin/计算机视觉基础大纲.md, /data/admin/计算机视觉基础辅修说明.pdf

请根据上述内容，为学生制定一份详细的每周学习计划，帮助他们完成学习目标，并合理安排学习资源的使用。请直接返回计划内容，不要包含多余的废话。`,

  // 2. AI根据笔记重新调整学习计划提示词
  adjustPlan: (unit: any, plan: any, content: string, fileUrl: string | null) => `学生提交了学习笔记。请根据学生的笔记进度，动态调整先前的学习计划，以便学生在该周剩下的时间里完成学习目标。
单元名称：${unit.title}
学习目标：${unit.objectives}
先前的学习计划：
${plan.plan_content}
学生提交的笔记文字内容：
${content || '无'}
学生是否提交了附件：${fileUrl ? '是 (PDF等格式)' : '否'}

请输出调整后的学习计划，直接返回计划内容。`,

  // 3. AI学习笔记评分提示词
  gradeUnit: (unit: any, plan: any, latestNote: any) => `当该单元的学习时间结束时，学生最后一次提交的学习笔记将作为他在该单元的评分依据。
请根据学生的学习笔记、其学习计划和每周的任务目标对学生在该单元的学习进行评分（满分100分）并给出反馈。
单元名称：${unit.title}
任务目标：${unit.objectives}
学习计划：${plan ? plan.plan_content : '无'}
学生最后的笔记文字内容：${latestNote.content || '无'}
学生是否提交了附件：${latestNote.file_url ? '是 (PDF等格式)' : '否'}

请以JSON格式返回：
{
  "grade": "分数（例如：85）",
  "feedback": "详细的评价和反馈"
}`,

  // 4. AI答疑助手提示词
  qaAssistant: (context: string, question: string) => `你是一个计算机视觉基础课程的AI答疑助手。
请根据当前网页的内容（上下文）以及学生提出的问题，为学生进行解惑。
【上下文内容】：
${context}
FILES: /data/admin/计算机视觉基础辅修说明.pdf
【学生的问题】：
${question}

请给出专业、易懂的解答。`
};
