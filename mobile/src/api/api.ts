import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// In a real app, you would use an environment variable (e.g., EXPO_PUBLIC_API_URL)
// For local development on Android emulator, 10.0.2.2 points to localhost of the host machine
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5000/api';

const api = axios.create({
  baseURL: API_URL,
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

export const getTasks = async () => {
  const response = await api.get('/tasks');
  return response.data;
};

export const createTask = async (data: { text: string; date: string; priority: string; time?: string | null; notify?: boolean }) => {
  const response = await api.post('/tasks', data);
  return response.data;
};

export const updateTask = async (id: string, data: Partial<{ text: string; date: string; priority: string; completed: boolean }>) => {
  const response = await api.put(`/tasks/${id}`, data);
  return response.data;
};

export const deleteTask = async (id: string) => {
  const response = await api.delete(`/tasks/${id}`);
  return response.data;
};

export default api;
