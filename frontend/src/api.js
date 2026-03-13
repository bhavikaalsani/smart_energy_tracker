const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const ACCESS_TOKEN_KEY = "smart_meter_access_token";
const REFRESH_TOKEN_KEY = "smart_meter_refresh_token";

export function getToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken, refreshToken) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function getAuthHeaders(extraHeaders = {}) {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

async function parseResponse(response, fallbackMessage) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.detail || fallbackMessage);
  }
  return data;
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error("Session expired. Please login again.");
  }

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await parseResponse(response, "Session refresh failed.");
  setTokens(data.access_token, data.refresh_token);
}

async function authFetch(url, options = {}, allowRefresh = true) {
  const response = await fetch(url, {
    ...options,
    headers: getAuthHeaders(options.headers || {}),
  });

  if (response.status === 401 && allowRefresh) {
    try {
      await refreshAccessToken();
    } catch (err) {
      clearToken();
      throw err;
    }
    return authFetch(url, options, false);
  }

  return response;
}

export async function registerUser(payload) {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response, "Failed to register user.");
}

export async function loginUser(username, password) {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return parseResponse(response, "Failed to login.");
}

export async function fetchMeterReadings() {
  const response = await authFetch(`${API_BASE_URL}/meter-readings`);
  return parseResponse(response, "Failed to load meter readings.");
}

export async function createMeterReading(payload) {
  const response = await authFetch(`${API_BASE_URL}/meter-readings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response, "Failed to create meter reading.");
}

export async function updateMeterReading(id, payload) {
  const response = await authFetch(`${API_BASE_URL}/meter-readings/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response, "Failed to update meter reading.");
}

export async function deleteMeterReading(id) {
  const response = await authFetch(`${API_BASE_URL}/meter-readings/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    let detail = "Failed to delete meter reading.";
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch {
      detail = "Failed to delete meter reading.";
    }
    throw new Error(detail);
  }
}

export async function extractReadingFromImage(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await authFetch(`${API_BASE_URL}/ocr/extract-reading`, {
    method: "POST",
    body: formData,
  });

  return parseResponse(response, "Failed to extract meter reading.");
}
