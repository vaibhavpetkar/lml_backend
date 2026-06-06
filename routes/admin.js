const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper function to generate ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Get all registration requests (Admin only)
router.get('/registration-requests', verifyToken, isAdmin, (req, res) => {
  try {
    const requests = db.prepare('SELECT * FROM registration_requests ORDER BY created_at DESC').all();
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get pending registration requests
router.get('/registration-requests/pending', verifyToken, isAdmin, (req, res) => {
  try {
    const requests = db.prepare('SELECT * FROM registration_requests WHERE status = ? ORDER BY created_at DESC').all('pending');
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Approve registration request
router.post('/registration-requests/:id/approve', verifyToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    const request = db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id);

    if (!request) {
      return res.status(404).json({ error: 'Registration request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is already processed' });
    }

    // Create user account
    const userId = generateId();
    const hashedPassword = bcrypt.hashSync(password, 10);

    try {
      const userStmt = db.prepare(`
        INSERT INTO users (id, email, name, password, role, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      userStmt.run(userId, request.email, request.name, hashedPassword, 'student', 'active');

      // Update registration request status
      const updateStmt = db.prepare(`
        UPDATE registration_requests 
        SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
        WHERE id = ?
      `);
      updateStmt.run('approved', req.user.id, id);

      res.json({
        message: 'Registration approved successfully',
        userId
      });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Reject registration request
router.post('/registration-requests/:id/reject', verifyToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const request = db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id);

    if (!request) {
      return res.status(404).json({ error: 'Registration request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is already processed' });
    }

    const stmt = db.prepare(`
      UPDATE registration_requests 
      SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, rejection_reason = ?
      WHERE id = ?
    `);
    stmt.run('rejected', req.user.id, reason || '', id);

    res.json({ message: 'Registration request rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get all users (Admin only)
router.get('/users', verifyToken, isAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT id, email, name, role, status, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get user by ID
router.get('/users/:id', verifyToken, isAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, status, created_at FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Update user status
router.put('/users/:id/status', verifyToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'inactive', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
    res.json({ message: 'User status updated' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Delete user
router.delete('/users/:id', verifyToken, isAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get enrollment statistics
router.get('/stats/enrollments', verifyToken, isAdmin, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT student_id) as total_students,
        COUNT(DISTINCT course_id) as total_courses,
        COUNT(*) as total_enrollments,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_enrollments
      FROM enrollments
    `).get();

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;
