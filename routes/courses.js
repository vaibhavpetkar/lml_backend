const express = require('express');
const db = require('../db');
const { verifyToken, isAdmin, isStudent } = require('../middleware/auth');

const router = express.Router();

// Helper function to generate ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Get all courses
router.get('/', (req, res) => {
  try {
    const courses = db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all();

    // Get topics and exam info for each course
    const coursesWithDetails = courses.map(course => {
      const topics = db.prepare('SELECT id, title, description, \`order\` FROM topics WHERE course_id = ? ORDER BY \`order\`').all(course.id);
      const exam = db.prepare('SELECT id, title, time_limit FROM exams WHERE course_id = ?').get(course.id);

      return {
        ...course,
        topics,
        exam
      };
    });

    res.json(coursesWithDetails);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get course by ID
router.get('/:id', (req, res) => {
  try {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const topics = db.prepare('SELECT * FROM topics WHERE course_id = ? ORDER BY \`order\`').all(course.id);
    const exam = db.prepare('SELECT id, title, time_limit FROM exams WHERE course_id = ?').get(course.id);

    res.json({
      ...course,
      topics,
      exam
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Create course (Admin only)
router.post('/', verifyToken, isAdmin, (req, res) => {
  const { title, description, duration, instructor, passingScore } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title required' });
  }

  try {
    const id = generateId();
    const stmt = db.prepare(`
      INSERT INTO courses (id, title, description, duration, instructor, passing_score, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, title, description, duration, instructor, passingScore || 70, req.user.id);

    res.status(201).json({
      id,
      title,
      description,
      duration,
      instructor,
      passingScore: passingScore || 70,
      topics: [],
      exam: null
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Update course (Admin only)
router.put('/:id', verifyToken, isAdmin, (req, res) => {
  const { title, description, duration, instructor, passingScore } = req.body;

  try {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const stmt = db.prepare(`
      UPDATE courses 
      SET title = ?, description = ?, duration = ?, instructor = ?, passing_score = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(title || course.title, description || course.description, duration || course.duration, instructor || course.instructor, passingScore || course.passing_score, req.params.id);

    res.json({ message: 'Course updated' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Delete course (Admin only)
router.delete('/:id', verifyToken, isAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
    res.json({ message: 'Course deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Add topic to course
router.post('/:courseId/topics', verifyToken, isAdmin, (req, res) => {
  const { title, description, content, order } = req.body;
  const { courseId } = req.params;

  if (!title) {
    return res.status(400).json({ error: 'Title required' });
  }

  try {
    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const id = generateId();
    const stmt = db.prepare(`
      INSERT INTO topics (id, course_id, title, description, content, \`order\`)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, courseId, title, description, content, order || 0);

    res.status(201).json({
      id,
      courseId,
      title,
      description,
      content,
      order: order || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get topic details
router.get('/:courseId/topics/:topicId', (req, res) => {
  try {
    const topic = db.prepare('SELECT * FROM topics WHERE id = ? AND course_id = ?').get(req.params.topicId, req.params.courseId);

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    res.json(topic);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Update topic
router.put('/:courseId/topics/:topicId', verifyToken, isAdmin, (req, res) => {
  const { title, description, content, order } = req.body;
  const { courseId, topicId } = req.params;

  try {
    const topic = db.prepare('SELECT * FROM topics WHERE id = ? AND course_id = ?').get(topicId, courseId);

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const stmt = db.prepare(`
      UPDATE topics 
      SET title = ?, description = ?, content = ?, \`order\` = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(title || topic.title, description || topic.description, content || topic.content, order !== undefined ? order : topic.order, topicId);

    res.json({ message: 'Topic updated' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Delete topic
router.delete('/:courseId/topics/:topicId', verifyToken, isAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM topics WHERE id = ? AND course_id = ?').run(req.params.topicId, req.params.courseId);
    res.json({ message: 'Topic deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;
