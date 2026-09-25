import Task from '../models/Task.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export const getTasks = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    // Handle rollover: move uncompleted past tasks to local today
    const today = req.query.localDate ?? new Date().toISOString().split('T')[0];
    
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
    next(error);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const { text, date, priority } = req.body;
    
    if (!text || !date) {
      throw new ApiError(400, 'Text and date are required');
    }

    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    const task = new Task({
      userId: user._id,
      text,
      date,
      priority: priority ?? 'medium'
    });
    
    await task.save();
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: user._id },
      req.body,
      { new: true }
    );
    
    if (!task) throw new ApiError(404, 'Task not found');
    res.json(task);
  } catch (error) {
    next(error);
  }
};

export const deleteTask = async (req, res, next) => {
  try {
    const { sub: googleId } = req.user;
    const user = await User.findOne({ googleId });
    if (!user) throw new ApiError(404, 'User not found');

    const task = await Task.findOneAndDelete({ _id: req.params.id, userId: user._id });
    if (!task) throw new ApiError(404, 'Task not found');
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    next(error);
  }
};
