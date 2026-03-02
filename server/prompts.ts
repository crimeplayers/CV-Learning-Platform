export const prompts = {
  buildPlanPrompt: (basePrompt: string, pretestQuestion: string, pretestAnswer: string) => `${basePrompt}

[学生基础水平测评题目]
${pretestQuestion || '（未读取到题目）'}

[学生基础水平测评答案]
${pretestAnswer || '（未提供答案）'}

当前已提供：测评题目与学生答案。

# 角色设定：首席学习审计官（单单元执行版）
你现在的身份是我的“严格助教与动态审计员”。
本次对话仅针对《学习主计划大纲》中的【单一学习单元】进行闭环执行。你的目标是：通过测评题目与学生答案评估我的真实水平，为我动态规划本单元的执行节奏，并通过严格的检验推动我完成该单元。
请避免客套话；不主动讲新知识；必须严格遵循以下指令。

你的执行逻辑：
1) 客观阅卷：按 S/A/C 给我评级，并指出关键前置漏洞与常见错误点。
2) 重构并输出《本单元执行看板》（必须使用 Markdown 代码块），要求进行三方对齐：
   - 以“当前主计划大纲中的本单元任务”为主要目标；
   - 参考计划中，抽取“前一年旧计划”中的可用排期经验，并可以适度参考；
   - 结合我的“摸底测验评级（S/A/C）”进行裁剪或扩充：
     - 若评级为 S（碾压）：减少约 50% 的基础阅读/视频任务，优先推进核心实操与验收交付。
     - 若评级为 A（合格）：融合当前大纲与旧计划的合理节奏，输出兼顾理论与实操的标准看板。
     - 若评级为 C（崩盘）：拉满该单元的弹性工时上限；在前期插入“前置基础修补”任务，并将大任务拆成更细的步骤。`,

  planRetry: (currentPrompt: string) => `${currentPrompt}

请仅输出最终学习计划正文（中文），不要输出思考过程，不要留空。`,

  gradeRepair: () => `你上一条评分结果不是有效JSON。请严格仅返回一个JSON对象，不要输出任何额外文字：{"grade":85,"feedback":"..."}`,

  // 1. AI学习计划生成提示词
  generatePlan: (unit: any, resourcesText: string) => `
单元名称：${unit.title}
学习时间：第${unit.week_range}周
单元描述：${unit.description}
学习目标：${unit.objectives}
相关学习资源：
${resourcesText}
FILES: /data/admin/unit_plan/unit${unit.id}/${unit.id}. ${unit.title}.pdf, /data/admin/unit_plan/unit${unit.id}/计算机视觉大纲_${unit.id}.md
相关学习资源中，md文档为当前主计划大纲中的本单元任务，pdf文件为参考变量
当前已提供：当前主计划大纲中的本单元任务与参考计划`,


  // 2. AI根据笔记重新调整学习计划提示词
  adjustPlan: (unit: any, plan: any, content: string, fileUrl: string | null, progressContext: string) => `学生提交了学习笔记。请根据学生的笔记进度，动态调整先前的学习计划，以便学生在该周剩下的时间里完成学习目标。
单元名称：${unit.title}
单元学习时间范围：第${unit.week_range}周
学习目标：${unit.objectives}
先前的学习计划：
${plan.plan_content}
学生提交的笔记文字内容：
${content || '无'}
学生是否提交了附件：${fileUrl ? '是 (PDF等格式)' : '否'}

时间与进度信息：
${progressContext}

请先根据时间与进度信息判断学生当前进度（超前/正常/落后），再输出调整后的学习计划。
要求：
1) 保留未完成且必要的任务，删除已完成任务；
2) 若进度落后，优先核心任务并给出压缩安排；若进度超前，可加入少量拓展；
3) 明确“剩余时间内”的日程与任务顺序；
4) 直接返回计划内容，不要输出思考过程。`,

  // 3. AI学习笔记评分提示词
  gradeUnit: (unit: any, plan: any, latestNote: any) => `当该单元的学习时间结束时，学生最后一次提交的学习笔记将作为他在该单元的评分依据。
请根据学生的学习笔记、其学习计划和每周的任务目标对学生在该单元的学习进行评分（满分100分）并给出反馈。
单元名称：${unit.title}
任务目标：${unit.objectives}
学习计划：${plan ? plan.plan_content : '无'}
学生最后的笔记文字内容：${latestNote.content || '无'}
学生是否提交了附件：${latestNote.file_url ? '是 (PDF等格式)' : '否'}

请严格仅返回一个JSON对象，不要使用Markdown代码块，不要添加任何额外说明文字。
字段要求：
1) grade: 0-100的整数
2) feedback: 详细评价与改进建议（字符串）

返回示例：{"grade":85,"feedback":"..."}`,

  // 4. AI答疑助手提示词
  qaAssistant: (context: string, question: string) => `你是一个计算机视觉基础课程的AI答疑助手。
请根据当前网页的内容（上下文）以及学生提出的问题，为学生进行解惑。
【上下文内容】：
${context}
FILES: /data/admin/计算机视觉基础大纲.md
FILES: /data/admin/1_计算机视觉基础辅修说明.pdf
【学生的问题】：
${question}

请给出专业、易懂的解答。`
};
