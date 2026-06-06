const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Initialize database
let dbPath;
if (process.env.DATABASE_PATH) {
  dbPath = process.env.DATABASE_PATH;
} else if (process.env.DATABASE_URL) {
  let url = process.env.DATABASE_URL;
  if (url.startsWith('file:')) {
    url = url.replace(/^file:\/{0,3}/, '');
  }
  dbPath = path.resolve(url);
} else {
  dbPath = path.join(__dirname, 'lms.db');
}

// Make sure parent directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize tables
function initializeDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'student', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'pending')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Student Registration Requests table (for admin approval)
  db.exec(`
    CREATE TABLE IF NOT EXISTS registration_requests (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      institution TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by TEXT,
      rejection_reason TEXT,
      FOREIGN KEY(reviewed_by) REFERENCES users(id)
    )
  `);

  // Courses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      duration TEXT,
      instructor TEXT,
      passing_score INTEGER DEFAULT 70,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id)
    )
  `);

  // Topics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT,
      \`order\` INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  // Enrollments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'dropped')),
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      completion_percentage INTEGER DEFAULT 0,
      UNIQUE(student_id, course_id),
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  // Completed Topics tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS completed_topics (
      id TEXT PRIMARY KEY,
      enrollment_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(enrollment_id, topic_id),
      FOREIGN KEY(enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  // Notes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  // Exam Questions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      text TEXT NOT NULL,
      options TEXT NOT NULL,
      correct_answer INTEGER NOT NULL,
      type TEXT DEFAULT 'multiple-choice',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  // Exams table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      time_limit INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  // Exam Submissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_submissions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      answers TEXT NOT NULL,
      score REAL NOT NULL,
      passed BOOLEAN NOT NULL,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  // Certificates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      course_name TEXT NOT NULL,
      exam_score REAL NOT NULL,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      certificate_number TEXT UNIQUE NOT NULL,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )
  `);

  console.log('Database tables initialized');
}

// Seed default data
function seedDefaultData() {
  try {
    // Check if owner already exists
    const ownerExists = db.prepare('SELECT id FROM users WHERE email = ?').get('vaibhav@lms.com');
    
    if (!ownerExists) {
      const hashedPassword = bcrypt.hashSync('password123', 10);
      const stmt = db.prepare(`
        INSERT INTO users (id, email, name, password, role, status) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run('owner-1', 'vaibhav@lms.com', 'Vaibhav', hashedPassword, 'owner', 'active');
      console.log('Owner user created');
    }

    // Check if sample student exists
    const studentExists = db.prepare('SELECT id FROM users WHERE email = ?').get('john@example.com');
    if (!studentExists) {
      const hashedPassword = bcrypt.hashSync('password123', 10);
      const stmt = db.prepare(`
        INSERT INTO users (id, email, name, password, role, status) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run('student-1', 'john@example.com', 'John Doe', hashedPassword, 'student', 'active');
      console.log('Sample student created');
    }

    // Check if sample course exists
    const courseExists = db.prepare('SELECT id FROM courses WHERE id = ?').get('course-1');
    if (!courseExists) {
      const courseStmt = db.prepare(`
        INSERT INTO courses (id, title, description, duration, instructor, passing_score, created_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      courseStmt.run('course-1', 'Introduction to React', 'Learn the basics of React.js and build your first interactive web application.', '4 weeks', 'Vaibhav', 70, 'owner-1');

      // Add topics
      const topicStmt = db.prepare(`
        INSERT INTO topics (id, course_id, title, description, content, \`order\`) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      topicStmt.run('topic-1', 'course-1', 'React Fundamentals', 'Understanding React concepts', 'React is a JavaScript library for building user interfaces with reusable components. React uses a virtual DOM to efficiently update the UI. JSX is a syntax extension that allows you to write HTML-like code in JavaScript. Components can be functional or class-based.', 1);
      topicStmt.run('topic-2', 'course-1', 'Hooks and State Management', 'Managing component state with hooks', 'Hooks allow you to use state and other React features in functional components. useState is the most common hook for managing component state. useEffect is used for side effects like data fetching. useContext allows you to pass data through the component tree without prop drilling.', 2);

      // Add exam questions
      const questionStmt = db.prepare(`
        INSERT INTO exam_questions (id, course_id, text, options, correct_answer, type) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      questionStmt.run('q1', 'course-1', 'What is React?', JSON.stringify(['A CSS framework', 'A JavaScript library for building UIs', 'A database system', 'A backend framework']), 1, 'multiple-choice');
      questionStmt.run('q2', 'course-1', 'What does JSX stand for?', JSON.stringify(['JavaScript XML', 'JavaScript External', 'JSON X-tension', 'Java Server XML']), 0, 'multiple-choice');
      questionStmt.run('q3', 'course-1', 'Which hook is used for side effects?', JSON.stringify(['useState', 'useContext', 'useEffect', 'useReducer']), 2, 'multiple-choice');

      // Create exam
      const examStmt = db.prepare(`
        INSERT INTO exams (id, course_id, title, time_limit) 
        VALUES (?, ?, ?, ?)
      `);
      examStmt.run('exam-1', 'course-1', 'React Fundamentals Exam', 60);

      console.log('Sample course with topics and exams created');
    }
  } catch (error) {
    console.error('Error seeding data:', error.message);
  }
}

// Initialize and seed
initializeDatabase();
seedDefaultData();

module.exports = db;
