import { ApiError } from '../utils/ApiError.js';

export const verifyGoogleToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new ApiError(401, 'No token provided');
    }

    const token = authHeader.split(' ')[1];
    
    // Validate the access_token by fetching user profile from Google
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new ApiError(401, 'Invalid Google access token');
    }

    const payload = await response.json();
    
    req.user = payload; // Attach google user payload to request
    next();
  } catch (error) {
    // If it's already an ApiError, pass it along. Otherwise, it's a generic 401.
    if (error instanceof ApiError) {
      next(error);
    } else {
      next(new ApiError(401, 'Invalid token'));
    }
  }
};
