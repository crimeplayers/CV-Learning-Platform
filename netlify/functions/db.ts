import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

// In Netlify functions, the working directory is usually the function directory or project root.
const dbPath = path.resolve(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student'
  );

  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    week_range TEXT NOT NULL,
    description TEXT NOT NULL,
    objectives TEXT NOT NULL,
    resources TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS study_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    unit_id INTEGER NOT NULL,
    plan_content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES users(id),
    FOREIGN KEY(unit_id) REFERENCES units(id)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    unit_id INTEGER NOT NULL,
    week TEXT NOT NULL,
    content TEXT NOT NULL,
    file_url TEXT,
    grade TEXT,
    feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES users(id),
    FOREIGN KEY(unit_id) REFERENCES units(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    unit_id INTEGER,
    action TEXT,
    prompt TEXT,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add columns if they don't exist (for existing db)
try {
  db.exec("ALTER TABLE units ADD COLUMN resources TEXT DEFAULT '[]'");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE notes ADD COLUMN file_url TEXT");
} catch (e) {
  // Column might already exist
}

// Seed default admin and units if empty
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
}

const defaultSettings = [
  { key: 'ai_api_key', value: '' },
  { key: 'ai_base_url', value: '' },
  { key: 'ai_model', value: 'gemini-3-flash-preview' }
];
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const s of defaultSettings) {
  insertSetting.run(s.key, s.value);
}

const unitsCount = db.prepare('SELECT COUNT(*) as count FROM units').get() as { count: number };
if (unitsCount.count === 0) {
  const units = [
    { 
      title: '机器学习基础', 
      week_range: '1', 
      description: '编程与数学基础，线性回归&分类', 
      objectives: '掌握如何搭建最基础的PyTorch编程实验环境，并回顾机器学习的基础知识。',
      resources: JSON.stringify([
        { title: 'Anaconda下载与安装', url: 'http://t.csdnimg.cn/1WEsj' },
        { title: 'PyTorch GPU版本安装参考', url: 'https://blog.csdn.net/Little_Carter/article/details/135934842' },
        { title: 'Python数值计算与数据处理', url: 'https://zh.d2l.ai/chapter_preliminaries/index.html' },
        { title: '线性回归视频', url: 'https://www.bilibili.com/video/BV1PX4y1g7KC/?spm_id_from=333.788.recommend_more_video.2' },
        { title: '线性回归讲义', url: 'https://zh.d2l.ai/chapter_linear-networks/linear-regression.html' },
        { title: 'Softmax视频', url: 'https://www.bilibili.com/video/BV1K64y1Q7wu/?spm_id_from=333.788.recommend_more_video.0' },
        { title: 'Softmax编程实现视频', url: 'https://www.bilibili.com/video/BV1K64y1Q7wu/?p=5' },
        { title: 'Softmax编程实现讲义', url: 'https://zh.d2l.ai/chapter_linear-networks/softmax-regression-concise.html' }
      ])
    },
    { 
      title: '图像处理基础', 
      week_range: '2-3', 
      description: '图像处理操作与视觉数据增广', 
      objectives: '通过编程实践，了解基础的图像处理操作以及如何使用图像处理技术实现视觉数据的有效增广，为复杂视觉模型的高效训练提供基础。',
      resources: JSON.stringify([
        { title: '常见的图像处理操作', url: '', description: '参考教材《Programming-Computer-VisionPython计算机视觉编程》第一章，学习如何使用NumPy、Matplotlib等常用的Python工具包实现基础的图像处理操作，阅读并运行教材中的例程。' },
        { title: '数据增广简介视频', url: 'https://www.bilibili.com/video/BV17y4y1g76q/' },
        { title: '数据增广编程实现', url: 'https://zh.d2l.ai/chapter_computer-vision/image-augmentation.html' }
      ])
    },
    { title: '相机模型', week_range: '4-5', description: '针孔相机模型、相机校准基础', objectives: '理解针孔相机模型原理，掌握相机校准基础方法。', resources: '[]' },
    { title: '深度学习基础', week_range: '5-6', description: '多层感知机，卷积神经网络', objectives: '掌握多层感知机和CNN的基本结构与原理。', resources: '[]' },
    { title: 'Transformer', week_range: '7', description: '注意力机制, 网络基础, 编程实践', objectives: '理解注意力机制，掌握Transformer网络结构与实践。', resources: '[]' },
    { title: '目标检测基础', week_range: '8', description: '检测基础、SSD检测模型', objectives: '了解目标检测基础概念，掌握SSD模型原理。', resources: '[]' },
    { title: '目标检测进阶', week_range: '9', description: 'DETR 检测模型', objectives: '深入学习DETR等先进目标检测模型。', resources: '[]' },
    { title: '语义分割', week_range: '10', description: '分割基础、转置卷积、全卷积', objectives: '掌握语义分割基本概念，理解全卷积网络。', resources: '[]' },
    { title: '生成模型', week_range: '11', description: 'GAN, VAE', objectives: '理解生成对抗网络(GAN)和变分自编码器(VAE)原理。', resources: '[]' },
    { title: '风格迁移', week_range: '12', description: '概念、模型结构、学习方法', objectives: '掌握风格迁移的基本概念、模型结构及实现方法。', resources: '[]' },
  ];
  const insertUnit = db.prepare('INSERT INTO units (title, week_range, description, objectives, resources) VALUES (?, ?, ?, ?, ?)');
  const insertMany = db.transaction((units) => {
    for (const unit of units) {
      insertUnit.run(unit.title, unit.week_range, unit.description, unit.objectives, unit.resources);
    }
  });
  insertMany(units);
}

export default db;
