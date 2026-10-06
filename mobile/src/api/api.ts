import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY } from '../auth/session';
import type { SyncRequest, SyncResponse } from '../sync/syncEngine';

// For local development on Android emulator, 10.0.2.2 points to localhost of the host machine
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5000/api';

const api = axios.create({
  baseURL: API_URL,
  // A request that never settles would hold up every sync waiting behind it
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Error reading token from storage:', error);
  }
  return config;
});

export const authenticate = async (googleToken: string) => {
  const response = await api.post('/auth/google', null, {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  return response.data;
};

// Sends the queued operations and gets back what changed since `cursor`, in one
// round trip. localDate/timezone tell the server which day it is for this user,
// so rollover follows local midnight. Errors are left for the sync engine,
// which decides between retrying, refreshing the token and giving up.
export const syncTasks = async (request: SyncRequest): Promise<SyncResponse> => {
  const response = await api.post('/tasks/sync', request);
  return response.data;
};
