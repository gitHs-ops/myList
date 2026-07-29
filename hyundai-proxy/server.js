require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  HYUNDAI_CLIENT_ID,
  HYUNDAI_CLIENT_SECRET,
  HYUNDAI_REDIRECT_URI,
  PORT = 4000
} = process.env;

if (!HYUNDAI_CLIENT_ID || !HYUNDAI_CLIENT_SECRET || !HYUNDAI_REDIRECT_URI) {
  console.error('[설정 오류] .env.example을 복사해 .env를 만들고 HYUNDAI_CLIENT_ID / HYUNDAI_CLIENT_SECRET / HYUNDAI_REDIRECT_URI 를 채워주세요.');
  process.exit(1);
}

// Hyundai Developers 공식 문서(developers.hyundai.com > guide_api)에 명시된 엔드포인트.
// 응답 JSON의 정확한 필드명(래핑 구조 등)은 공식 문서 로그인 후 API 규격서에서 재확인 필요.
const AUTH_BASE = 'https://prd.kr-ccapi.hyundai.com/api/v1/user/oauth2';
const DATA_BASE = 'https://dev.kr-ccapi.hyundai.com/api/v1/car';

const TOKEN_STORE_PATH = path.join(__dirname, 'token-store.json');

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_STORE_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveTokens(record) {
  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(record, null, 2), 'utf8');
}

function normalizeAndStoreTokens(tokenResponse, fallbackRefreshToken) {
  const expiresInSec = Number(tokenResponse.expires_in || 3600);
  const record = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || fallbackRefreshToken,
    expires_at: Date.now() + expiresInSec * 1000
  };
  saveTokens(record);
  return record;
}

async function requestToken(bodyParams) {
  const basicAuth = Buffer.from(`${HYUNDAI_CLIENT_ID}:${HYUNDAI_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(bodyParams)
  });
  if (!res.ok) {
    throw new Error(`토큰 요청 실패 (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function exchangeCodeForToken(code) {
  return requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: HYUNDAI_REDIRECT_URI
  });
}

async function refreshAccessToken(refreshToken) {
  return requestToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
}

async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) return null;
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  const merged = normalizeAndStoreTokens(refreshed, tokens.refresh_token);
  return merged.access_token;
}

async function callHyundaiApi(pathname, accessToken) {
  const res = await fetch(`${DATA_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`Hyundai API 오류 ${pathname} (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

const app = express();
app.use(cors()); // 로컬 전용 프록시이므로 전체 허용 (외부 배포 금지)
app.use(express.json());

let pendingState = null;

app.get('/auth/start', (req, res) => {
  pendingState = crypto.randomBytes(16).toString('hex');
  const url = new URL(`${AUTH_BASE}/authorize`);
  url.searchParams.set('client_id', HYUNDAI_CLIENT_ID);
  url.searchParams.set('redirect_uri', HYUNDAI_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', pendingState);
  res.redirect(url.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.status(400).send(`연동 실패: ${error}`);
  }
  if (!code || !state || state !== pendingState) {
    return res.status(400).send('잘못된 요청입니다 (state 불일치). 앱에서 다시 시도해 주세요.');
  }
  pendingState = null;
  try {
    const tokenResponse = await exchangeCodeForToken(code);
    normalizeAndStoreTokens(tokenResponse);
    res.send(`<!doctype html><meta charset="utf-8">
      <body style="font-family:sans-serif;text-align:center;padding:60px 20px;">
        <h2>✅ 현대차 계정 연동 완료</h2>
        <p>이 창은 자동으로 닫힙니다. 안 닫히면 직접 닫고 앱으로 돌아가세요.</p>
        <script>setTimeout(() => window.close(), 1500);</script>
      </body>`);
  } catch (e) {
    res.status(500).send(`토큰 발급 중 오류: ${e.message}`);
  }
});

app.get('/api/status', async (req, res) => {
  const token = await getValidAccessToken().catch(() => null);
  res.json({ connected: !!token });
});

app.post('/api/disconnect', (req, res) => {
  try { fs.unlinkSync(TOKEN_STORE_PATH); } catch (e) { /* 이미 없으면 무시 */ }
  res.json({ ok: true });
});

app.get('/api/vehicle/list', async (req, res) => {
  try {
    const token = await getValidAccessToken();
    if (!token) return res.status(401).json({ error: 'not_connected' });
    const data = await callHyundaiApi('/carlist', token);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/vehicle/odometer', async (req, res) => {
  const { carId } = req.query;
  if (!carId) return res.status(400).json({ error: 'carId 파라미터가 필요합니다.' });
  try {
    const token = await getValidAccessToken();
    if (!token) return res.status(401).json({ error: 'not_connected' });
    const data = await callHyundaiApi(`/status/${encodeURIComponent(carId)}/odometer`, token);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Hyundai 프록시 서버 실행 중: http://localhost:${PORT}`);
  console.log(`연동 시작 주소: http://localhost:${PORT}/auth/start`);
});
