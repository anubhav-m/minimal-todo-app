import { before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { googleLogin } from '../controllers/authController.js';

// Runs the real controllers against a real mongod: what these tests prove
// (unique indexes, conditional updates) is MongoDB's behaviour, not ours.
export const useDatabase = () => {
  let mongod;
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });
  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });
  beforeEach(async () => {
    await Promise.all([Task.deleteMany({}), User.deleteMany({})]);
    await Promise.all([Task.init(), User.init()]);
  });
};

export const GOOGLE_USER = { sub: 'g-1', email: 'a@example.com', name: 'A' };
export const plain = (value) => JSON.parse(JSON.stringify(value));

// Calls a controller the way Express would and resolves with what it answered.
// Errors passed to next() reject, carrying statusCode for ApiErrors.
export const call = (handler, { body = {}, params = {}, query = {} } = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: plain(payload) }); },
    };
    handler({ user: GOOGLE_USER, body, params, query }, res, reject);
  });

export const signUp = async () => (await call(googleLogin)).body.user;
