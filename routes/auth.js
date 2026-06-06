const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Helper function to generate ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Logout
router.post('/logout', verifyToken, (req, res) => {
  res.json({ message: 'Logout successful' });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: 'Account is not active. Please contact admin.' });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Register Student directly (active user)
router.post('/register', (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, name and password required' });
  }

  try {
    // Check if email already exists as user
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const id = generateId();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (id, email, name, password, role, status)
      VALUES (?, ?, ?, ?, 'student', 'active')
    `);
    stmt.run(id, email, name, hashedPassword);

    res.status(201).json({
      message: 'Student registered successfully',
      userId: id
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Register Student (Request Registration)
router.post('/register-request', (req, res) => {
  const { email, name, phone, institution, reason } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name required' });
  }

  try {
    // Check if email already exists as user
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if registration request already exists
    const existingRequest = db.prepare('SELECT id FROM registration_requests WHERE email = ?').get(email);
    if (existingRequest) {
      return res.status(400).json({ error: 'Registration request already submitted' });
    }

    const id = generateId();
    const stmt = db.prepare(`
      INSERT INTO registration_requests (id, email, name, phone, institution, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    stmt.run(id, email, name, phone, institution, reason);

    res.status(201).json({
      message: 'Registration request submitted successfully. Please wait for admin approval.',
      requestId: id
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Get current user profile
router.get('/profile', verifyToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Update password
router.put('/change-password', verifyToken, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old and new password required' });
  }

  try {
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);

    if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(401).json({ error: 'Old password is incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      hashedPassword,
      req.user.id
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;
