import express from 'express';
import { getTasks, createTask, updateTask, deleteTask } from '../controllers/taskController.js';
import { verifyGoogleToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', verifyGoogleToken, getTasks);
router.post('/', verifyGoogleToken, createTask);
router.put('/:id', verifyGoogleToken, updateTask);
router.delete('/:id', verifyGoogleToken, deleteTask);

export default router;
