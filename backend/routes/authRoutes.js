import express from 'express';
import { googleLogin } from '../controllers/authController.js';
import { verifyGoogleToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/google', verifyGoogleToken, googleLogin);

export default router;
