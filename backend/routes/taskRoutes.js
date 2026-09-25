const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const User = require('../models/User');
const { verifyGoogleToken } = require('../middleware/authMiddleware');

// Get all tasks for the logged-in user, and handle rollover
router.get('/', verifyGoogleToken, async (req, res) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Handle rollover: move uncompleted past tasks to local today
    const today = req.query.localDate || new Date().toISOString().split('T')[0];
    
    await Task.updateMany(
      { 
        userId: user._id, 
        completed: false, 
        date: { $lt: today } 
      },
      { 
        $set: { date: today } 
      }
    );

    const tasks = await Task.find({ userId: user._id }).sort({ date: 1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

// Create a new task
router.post('/', verifyGoogleToken, async (req, res) => {
  try {
    const { sub: googleId } = req.user;
    const { text, date, priority } = req.body;
    
    const user = await User.findOne({ googleId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const task = new Task({
      userId: user._id,
      text,
      date,
      priority
    });
    
    await task.save();
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Error creating task' });
  }
});

// Update a task (e.g., mark as complete)
router.put('/:id', verifyGoogleToken, async (req, res) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: user._id },
      req.body,
      { new: true }
    );
    
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Error updating task' });
  }
});

// Delete a task
router.delete('/:id', verifyGoogleToken, async (req, res) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const task = await Task.findOneAndDelete({ _id: req.params.id, userId: user._id });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting task' });
  }
});

module.exports = router;
