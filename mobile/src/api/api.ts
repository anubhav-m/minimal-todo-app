import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ToggleResult } from '../tasks/taskSync';

// For local development on Android emulator, 10.0.2.2 points to localhost of the host machine
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5000/api';

const api = axios.create({
  baseURL: API_URL,
  // A request that never settles would hold up every refresh waiting on it
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  try {
    const token = await AsyncStorage.getItem('todo_token');
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

// localDate/timezone tell the server which day it is for this user, so rollover follows local midnight
export const getTasks = async (localDate: string, timezone?: string) => {
  const response = await api.get('/tasks', { params: { localDate, timezone } });
  return response.data;
};

// clientId identifies this create; sending it again returns the task it already made
export const createTask = async (data: { clientId: string; text: string; date: string; priority: string; time?: string | null; notify?: boolean; notificationId?: string | null }) => {
  const response = await api.post('/tasks', data);
  return response.data;
};

// baseVersion is the version this device last saw. If the task changed since, the
// server refuses (409) and sends its current copy instead of being overwritten.
export const setTaskCompleted = async (id: string, completed: boolean, baseVersion?: number): Promise<ToggleResult<any>> => {
  try {
    const response = await api.put(`/tasks/${id}`, { completed, baseVersion });
    return { status: 'ok', task: response.data };
  } catch (error: any) {
    const response = error?.response;
    if (response?.status === 409 && response.data?.task) return { status: 'conflict', task: response.data.task };
    if (response?.status === 404) return { status: 'gone' };
    throw error;
  }
};

export const deleteTask = async (id: string) => {
  try {
    await api.delete(`/tasks/${id}`);
  } catch (error: any) {
    // Already deleted (another device, or our own retry): that is what we wanted
    if (error?.response?.status !== 404) throw error;
  }
};
