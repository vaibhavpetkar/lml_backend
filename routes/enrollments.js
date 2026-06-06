const express = require('express');
const db = require('../db');
const { verifyToken, isStudent, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper function to generate ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Get student enrollments
router.get('/student/enrollments', verifyToken, isStudent, (req, res) => {
  try {
    const enrollments = db.prepare(`
      SELECT e.*, c.title, c.description, c.duration, c.passing_score, c.instructor
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.student_id = ?
      ORDER BY e.enrolled_at DESC
    `).all(req.user.id);

    // Get completion info for each enrollment
    const enrollmentsWithDetails = enrollments.map(enrollment => {
      const completedTopics = db.prepare('SELECT COUNT(*) as count FROM completed_topics WHERE enrollment_id = ?').get(enrollment.id);
      const totalTopics = db.prepare('SELECT COUNT(*) as count FROM topics WHERE course_id = ?').get(enrollment.course_id);

      return {
        ...enrollment,
        completedTopicsCount: completedTopics.count,
        totalTopicsCount: totalTopics.count
      };
    });

    res.json(enrollmentsWithDetails);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Enroll in course
router.post('/enroll/:courseId', verifyToken, isStudent, (req, res) => {
  const { courseId } = req.params;

  try {
    // Check if course exists
    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if already enrolled
    const existing = db.prepare('SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?').get(req.user.id, courseId);
    if (existing) {
      return res.status(400).json({ error: 'Already enrolled in this course' });
    }

    const id = generateId();
    const stmt = db.prepare(`
      INSERT INTO enrollments (id, student_id, course_id, status, enrolled_at, completion_percentage)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
    `);
    stmt.run(id, req.user.id, courseId, 'active');

    res.status(201).json({
      id,
      message: 'Successfully enrolled in course'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Mark topic as completed
router.post('/enroll/:enrollmentId/complete-topic/:topicId', verifyToken, isStudent, (req, res) => {
  const { enrollmentId, topicId } = req.params;

  try {
    // Verify enrollment belongs to student
    const enrollment = db.prepare('SELECT * FROM enrollments WHERE id = ? AND student_id = ?').get(enrollmentId, req.user.id);
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Verify topic exists in course
    const topic = db.prepare('SELECT id FROM topics WHERE id = ? AND course_id = ?').get(topicId, enrollment.course_id);
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Check if already completed
    const existing = db.prepare('SELECT id FROM completed_topics WHERE enrollment_id = ? AND topic_id = ?').get(enrollmentId, topicId);
    if (existing) {
      return res.status(400).json({ error: 'Topic already completed' });
    }

    const id = generateId();
    const stmt = db.prepare(`
      INSERT INTO completed_topics (id, enrollment_id, topic_id, completed_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(id, enrollmentId, topicId);

    // Update enrollment completion percentage
    const completedCount = db.prepare('SELECT COUNT(*) as count FROM completed_topics WHERE enrollment_id = ?').get(enrollmentId);
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM topics WHERE course_id = ?').get(enrollment.course_id);
    const percentage = totalCount.count > 0 ? Math.round((completedCount.count / totalCount.count) * 100) : 0;

    db.prepare('UPDATE enrollments SET completion_percentage = ? WHERE id = ?').run(percentage, enrollmentId);

    res.json({
      message: 'Topic marked as completed',
      completionPercentage: percentage
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get exam details
router.get('/exams/:examId', verifyToken, (req, res) => {
  try {
    const exam = db.prepare('SELECT id, course_id, title, time_limit FROM exams WHERE id = ?').get(req.params.examId);

    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const questions = db.prepare(`
      SELECT id, text, options, type
      FROM exam_questions
      WHERE course_id = ?
      ORDER BY id
    `).all(exam.course_id);

    res.json({
      ...exam,
      questions: questions.map(q => ({
        ...q,
        options: JSON.parse(q.options)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Submit exam
router.post('/exams/:examId/submit', verifyToken, isStudent, (req, res) => {
  const { examId } = req.params;
  const { answers } = req.body;

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Invalid answers format' });
  }

  try {
    const exam = db.prepare('SELECT id, course_id FROM exams WHERE id = ?').get(examId);

    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    // Get all exam questions
    const questions = db.prepare('SELECT id, correct_answer FROM exam_questions WHERE course_id = ?').all(exam.course_id);

    // Calculate score
    let correctCount = 0;
    questions.forEach(question => {
      const studentAnswer = parseInt(answers[question.id]);
      if (studentAnswer === question.correct_answer) {
        correctCount++;
      }
    });

    const score = (correctCount / questions.length) * 100;

    // Get passing score from course
    const course = db.prepare('SELECT passing_score FROM courses WHERE id = ?').get(exam.course_id);
    const passed = score >= course.passing_score;

    // Save submission
    const submissionId = generateId();
    const stmt = db.prepare(`
      INSERT INTO exam_submissions (id, exam_id, student_id, course_id, answers, score, passed, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(submissionId, examId, req.user.id, exam.course_id, JSON.stringify(answers), score, passed ? 1 : 0);

    // If passed, create certificate
    if (passed) {
      const certificateNumber = 'CERT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
      const certId = generateId();
      const courseData = db.prepare('SELECT title FROM courses WHERE id = ?').get(exam.course_id);

      db.prepare(`
        INSERT INTO certificates (id, student_id, course_id, course_name, exam_score, issued_at, certificate_number)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `).run(certId, req.user.id, exam.course_id, courseData.title, score, certificateNumber);
    }

    res.status(201).json({
      submissionId,
      score: Math.round(score),
      passed,
      message: passed ? 'Exam passed! Certificate generated.' : 'Exam submitted. Please review the answers.'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get exam submissions (student can only see their own)
router.get('/submissions', verifyToken, (req, res) => {
  try {
    let submissions;

    if (req.user.role === 'student') {
      submissions = db.prepare(`
        SELECT e.*, c.title
        FROM exam_submissions e
        JOIN courses c ON e.course_id = c.id
        WHERE e.student_id = ?
        ORDER BY e.submitted_at DESC
      `).all(req.user.id);
    } else if (req.user.role === 'owner' || req.user.role === 'admin') {
      submissions = db.prepare(`
        SELECT e.*, c.title, u.name as student_name, u.email as student_email
        FROM exam_submissions e
        JOIN courses c ON e.course_id = c.id
        JOIN users u ON e.student_id = u.id
        ORDER BY e.submitted_at DESC
      `).all();
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get student certificates
router.get('/certificates', verifyToken, isStudent, (req, res) => {
  try {
    const certificates = db.prepare(`
      SELECT id, course_id, course_name, exam_score, issued_at, certificate_number
      FROM certificates
      WHERE student_id = ?
      ORDER BY issued_at DESC
    `).all(req.user.id);

    res.json(certificates);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Add note to topic
router.post('/notes/:topicId', verifyToken, isStudent, (req, res) => {
  const { content } = req.body;
  const { topicId } = req.params;

  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    const id = generateId();
    const stmt = db.prepare(`
      INSERT INTO notes (id, student_id, topic_id, content, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(id, req.user.id, topicId, content);

    res.status(201).json({
      id,
      content
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get notes for topic
router.get('/notes/:topicId', verifyToken, isStudent, (req, res) => {
  try {
    const notes = db.prepare('SELECT id, content, created_at, updated_at FROM notes WHERE topic_id = ? AND student_id = ? ORDER BY created_at DESC').all(req.params.topicId, req.user.id);

    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;
