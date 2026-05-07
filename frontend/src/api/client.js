import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_BACKEND_URL || '',
});

// Rooms
export const getRooms = async () => {
  const res = await api.get('/api/rooms');
  return res.data;
};

export const createRoom = async (name) => {
  const res = await api.post('/api/rooms', { name });
  return res.data;
};

export const getRoom = async (roomId) => {
  const res = await api.get(`/api/rooms/${roomId}`);
  return res.data;
};

export const deleteRoom = async (roomId) => {
  const res = await api.delete(`/api/rooms/${roomId}`);
  return res.data;
};

// Readings
export const getLatestReading = async (roomId) => {
  const res = await api.get(`/api/rooms/${roomId}/latest`);
  return res.data;
};

export const getRoomReadings = async (roomId, limit = 100, offset = 0) => {
  const res = await api.get(`/api/rooms/${roomId}/readings`, {
    params: { limit, offset },
  });
  return res.data;
};

export const getRoomSummary = async (roomId) => {
  const res = await api.get(`/api/rooms/${roomId}/summary`);
  return res.data;
};

// Thresholds
export const getThresholds = async () => {
  const res = await api.get('/api/thresholds');
  return res.data;
};

export const updateThresholds = async (data) => {
  const res = await api.put('/api/thresholds', data);
  return res.data;
};

// Anomalies
export const getAnomalies = async ({ roomId, fromDate, toDate, limit } = {}) => {
  const params = {};
  if (roomId)   params.room_id   = roomId;
  if (fromDate) params.from_date = fromDate;
  if (toDate)   params.to_date   = toDate;
  if (limit)    params.limit     = limit;
  const res = await api.get('/api/anomalies', { params });
  return res.data;
};

export const getRoomAnomalies = async (roomId, limit = 100) => {
  const res = await api.get(`/api/rooms/${roomId}/anomalies`, {
    params: { limit },
  });
  return res.data;
};

// Insights
export const getCorrelation = async (roomId, limit = 500) => {
  const res = await api.get(`/api/rooms/${roomId}/correlation`, { params: { limit } });
  return res.data;
};

export const getLabelDistribution = async (roomId) => {
  const res = await api.get(`/api/rooms/${roomId}/label-distribution`);
  return res.data;
};

export const getPrediction = async (roomId) => {
  const res = await api.get(`/api/rooms/${roomId}/predict`);
  return res.data;
};
