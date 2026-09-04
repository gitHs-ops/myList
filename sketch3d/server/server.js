// sketch3d — Extract API: 손그림 스케치 → 벽 좌표 JSON (Claude Vision)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const PORT = process.env.PORT || 8787;
const MODEL = process.env.VISION_MODEL || 'claude-opus-5';
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET;
// 테스터 초대 등으로 한시적 인증 생략이 필요할 때만 설정 (ISO 시각).
// FROM은 생략하면 즉시 시작. UNTIL이 지나면 코드 재배포 없이 자동으로 다시 인증이 걸림 — 깜빡할 걱정 없음.
const TEMP_AUTH_BYPASS_FROM = process.env.TEMP_AUTH_BYPASS_FROM ? new Date(process.env.TEMP_AUTH_BYPASS_FROM) : null;
const TEMP_AUTH_BYPASS_UNTIL = process.env.TEMP_AUTH_BYPASS_UNTIL ? new Date(process.env.TEMP_AUTH_BYPASS_UNTIL) : null;

if (!APP_SHARED_SECRET) {
  console.error('[설정 오류] APP_SHARED_SECRET이 비어있습니다. 외부(클라우드) 배포 시 이 값이 없으면 누구나 이 서버로 비전 API 요금을 발생시킬 수 있습니다. .env에 임의의 긴 문자열을 넣어주세요.');
  process.exit(1);
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const app = express();
app.use(cors({ exposedHeaders: ['X-Usage-Input-Tokens', 'X-Usage-Output-Tokens', 'X-Usage-Model'] })); // 실제 접근 제어는 APP_SHARED_SECRET 미들웨어가 담당
app.use(express.json({ limit: '25mb' }));

app.get('/', (_req, res) => res.send('sketch3d extract API OK'));
app.get('/health', (_req, res) => res.json({ ok: true, model: MODEL }));

// /api/* 는 Vision API 호출(과금)을 트리거하므로 공유 비밀키가 일치해야 통과.
// [TEMP_AUTH_BYPASS_FROM, TEMP_AUTH_BYPASS_UNTIL) 구간에서만 이 검사를 건너뜀.
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const afterStart = !TEMP_AUTH_BYPASS_FROM || now >= TEMP_AUTH_BYPASS_FROM.getTime();
  const beforeEnd = TEMP_AUTH_BYPASS_UNTIL && now < TEMP_AUTH_BYPASS_UNTIL.getTime();
  if (afterStart && beforeEnd) {
    console.warn(`[임시 인증 생략] ${TEMP_AUTH_BYPASS_UNTIL.toISOString()}까지 X-App-Secret 검사 없이 통과 중`);
    return next();
  }
  if (req.get('X-App-Secret') !== APP_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

const WALL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unit', 'wallHeight', 'wallThickness', 'walls', 'notes'],
  properties: {
    unit: { type: 'string', enum: ['mm'] },
    wallHeight: { type: 'number' },
    wallThickness: { type: 'number' },
    north: { type: 'string', enum: ['up', 'down', 'left', 'right'] },  // 도면에서 북쪽 방향
    roof: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['none', 'flat', 'gable'] },
        pitch: { type: 'number' },      // 물매(경사, °) — gable
        overhang: { type: 'number' },   // 처마 내밀기(mm)
        ridge: { type: 'string', enum: ['x', 'y'] }  // 박공 능선 방향
      }
    },
    walls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end'],
        properties: {
          start: { type: 'array', items: { type: 'number' } },
          end: { type: 'array', items: { type: 'number' } },
          height: { type: 'number' },     // 이 벽 높이(mm). 없으면 wallHeight
          thickness: { type: 'number' },  // 이 벽 두께(mm). 없으면 wallThickness
          sill: { type: 'number' },       // (벽 전체폭 밴드용) 소벽: 바닥~개구부 하단. 문은 0
          lintel: { type: 'number' },     // (벽 전체폭 밴드용) 인방: 개구부 상단~천장
          openings: {                     // 가로 위치·폭이 있는 개별 개구부(창/문)
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['offset', 'width'],
              properties: {
                offset: { type: 'number' },  // 벽 시작점에서 개구부 시작까지 거리(mm)
                width: { type: 'number' },   // 개구부 폭(mm)
                sill: { type: 'number' },    // 개구부 하단 높이(바닥~, mm). 문=0
                height: { type: 'number' },  // 개구부 높이(mm)
                type: { type: 'string', enum: ['window', 'door'] }
              }
            }
          }
        }
      }
    },
    notes: { type: 'string' }
  }
};

const SYSTEM = `당신은 건축 손그림 스케치를 벽 중심선 좌표로 변환하는 도구입니다.
- 스케치에 적힌 치수(숫자)를 최대한 활용해 실제 밀리미터(mm) 좌표를 계산합니다.
- 평면 좌표계: 원점은 좌하단, x는 오른쪽(+), y는 위쪽(+). 단위는 mm.
- 각 벽은 중심선의 start[x,y] ~ end[x,y] 선분으로 표현합니다. 폐합된 방은 벽들이 연결되도록 좌표를 맞춥니다.
- 치수가 없는 부분은 스케치의 비율로 합리적으로 추정하고, 그 사실을 notes에 적습니다.
- 창/문 등 개구부가 스케치에 보이면 그 벽에 옵션 필드로 높이 정보를 남깁니다:
  · height = 이 벽 높이(mm, 없으면 wallHeight)
  · thickness = 이 벽 두께(mm, 없으면 wallThickness)
  · sill = 소벽 높이 = 바닥~개구부 하단(창 아래 벽). 문이면 0.
  · lintel = 인방 높이 = 개구부 상단~천장(개구부 위 벽).
  · 개구부 높이 = height - sill - lintel 이 됩니다. 치수가 없으면 통상값(창: sill 900, 개구부 1200, lintel 600 / 문: sill 0, 개구부 2100)으로 추정하고 notes에 적습니다.
- 한 벽에 창/문이 특정 가로 위치·폭으로 있으면(예: 통창 + 작은 창) 벽 전체폭 sill/lintel 대신 openings 배열로 각 개구부를 남깁니다:
  · offset = 벽 시작점(start)에서 개구부 시작까지 거리(mm), width = 개구부 폭(mm), sill = 개구부 하단 높이, height = 개구부 높이, type = 'window'|'door'.
  · 스케치에 폭·위치 치수가 있으면 반드시 openings로 반영하세요. 문은 sill 0.
- 개구부가 없는 벽은 sill/lintel/openings를 넣지 않습니다(솔리드 벽).
- north: 도면에서 북쪽이 당신이 배치한 벽 좌표계 기준으로 어느 방향인지 = 'up'(+y,위) | 'down'(-y,아래) | 'left'(-x,왼쪽) | 'right'(+x,오른쪽) 중 하나입니다.
  · 스케치에 "N"·나침반·방위 화살표 등 방위 표시가 있으면, 그 표시가 스케치의 어느 변(위/아래/왼쪽/오른쪽)에 붙어 있거나 그 변을 향해 가리키는지를 보고 그 변을 north로 정합니다. 좌우를 혼동하지 않도록 신중히 판단하세요(예: 화살표가 스케치의 오른쪽 변에 있거나 오른쪽을 가리키면 north='right').
  · 방위 표시가 없으면 'up'으로 둡니다.
- roof: 지붕 정보(옵션). { type: 'flat'|'gable'|'none', pitch: 물매(°, 박공), overhang: 처마내밀기(mm), ridge: 'x'|'y'(박공 능선 방향) }. 스케치에 지붕/단면이 보이면 반영하고, 없으면 생략합니다.
- 확신이 낮거나 추정한 내용은 notes에 한국어로 간단히 남깁니다.`;

app.post('/api/extract', async (req, res) => {
  try {
    const { image, images, wallHeight = 2400, wallThickness = 150 } = req.body || {};
    // 단일(image) / 다중(images) 모두 허용
    const list = Array.isArray(images) && images.length ? images : (image ? [image] : []);
    if (!list.length) {
      return res.status(400).json({ error: 'image(s) (base64 data URL) required' });
    }

    const imageBlocks = [];
    for (const src of list) {
      const m = typeof src === 'string' && src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
      if (!m) return res.status(400).json({ error: 'each image must be a base64 data URL' });
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }

    const multiNote = list.length > 1
      ? `스케치 ${list.length}장이 제공됩니다. 같은 건물을 다른 각도/층/치수메모로 그린 것으로 보고, 모든 장을 종합해 하나의 평면(벽 집합)으로 합치세요. `
      : '';

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: WALL_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: multiNote
                + `이 손그림 스케치에서 벽 선분을 추출해 JSON으로 반환하세요. `
                + `기본 벽 높이 ${wallHeight}mm, 기본 벽 두께 ${wallThickness}mm 를 wallHeight/wallThickness 에 사용하세요.`
          }
        ]
      }]
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'no text in model response', stop: response.stop_reason });

    let parsed;
    try { parsed = JSON.parse(textBlock.text); }
    catch { return res.status(502).json({ error: 'model did not return valid JSON', raw: textBlock.text.slice(0, 500) }); }

    if (response.usage) {
      res.set('X-Usage-Input-Tokens', String(response.usage.input_tokens ?? ''));
      res.set('X-Usage-Output-Tokens', String(response.usage.output_tokens ?? ''));
      res.set('X-Usage-Model', MODEL);
    }
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'extract failed' });
  }
});

const EDIT_SYSTEM = `당신은 건축 벽체 평면 JSON을 사용자의 한국어 지시에 따라 수정하는 편집기입니다.
- 입력으로 현재 벽 JSON(unit/wallHeight/wallThickness/walls/notes)을 받습니다.
- 좌표계는 그대로 유지합니다: 단위 mm, 원점 좌하단, x는 오른쪽(+), y는 위쪽(+). 각 벽은 중심선 start[x,y]~end[x,y].
- "왼쪽/오른쪽/위쪽/아래쪽 벽"은 현재 좌표상의 위치로 식별합니다. 벽 추가/삭제/이동/길이변경/두께·높이 변경 등을 반영합니다.
- "동쪽/서쪽/남쪽/북쪽 벽" 같은 방위 지시는 현재 north 값(JSON에 없으면 'up')을 기준으로 반드시 아래 표로 좌표 방향을 환산합니다(절대 임의로 추측하지 마세요):
  · north='up': 북=+y(위) 남=-y(아래) 동=+x(오른쪽) 서=-x(왼쪽)
  · north='down': 북=-y(아래) 남=+y(위) 동=-x(왼쪽) 서=+x(오른쪽)
  · north='right': 북=+x(오른쪽) 남=-x(왼쪽) 동=-y(아래) 서=+y(위)
  · north='left': 북=-x(왼쪽) 남=+x(오른쪽) 동=+y(위) 서=-y(아래)
- 벽별 옵션 필드로 높이/개구부를 다룰 수 있습니다: height(벽 높이), thickness(두께), sill(소벽=바닥~개구부 하단), lintel(인방=개구부 상단~천장). 개구부 높이 = height - sill - lintel. 문은 sill=0.
- 가로 위치·폭이 있는 창/문은 openings 배열로 다룹니다: [{offset(벽 시작점~개구부 시작), width(폭), sill, height, type:'window'|'door'}]. "폭 1600 창을 오른쪽에" 같은 지시는 openings로 반영하고, "창 없애줘"는 openings/sill/lintel을 제거합니다.
- north(도면 북쪽: 'up'|'down'|'left'|'right')도 지시에 따라 설정/변경합니다. 예: "북쪽을 오른쪽으로" → north:'right'.
- roof(지붕: {type:'flat'|'gable'|'none', pitch, overhang, ridge:'x'|'y'})도 지시에 따라 설정/변경합니다. 예: "박공지붕 물매 30도" → roof:{type:'gable',pitch:30,...}, "지붕 없애" → roof:{type:'none'} 또는 제거.
- 지시와 무관한 벽은 그대로 둡니다. 방이 닫혀 있어야 하면 연결 좌표를 함께 맞춥니다.
- notes에는 무엇을 어떻게 바꿨는지 한국어로 짧게 적습니다. 지시가 모호하면 합리적으로 해석하고 그 사실을 notes에 남깁니다.
- 반드시 전체 벽 JSON(수정 결과)을 반환합니다.`;

app.post('/api/edit', async (req, res) => {
  try {
    const { walls, instruction } = req.body || {};
    if (!walls || typeof walls !== 'object') {
      return res.status(400).json({ error: 'walls (current wall JSON object) required' });
    }
    if (!instruction || typeof instruction !== 'string') {
      return res.status(400).json({ error: 'instruction (text) required' });
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: EDIT_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: WALL_SCHEMA } },
      messages: [{
        role: 'user',
        content: `현재 벽 JSON:\n\`\`\`json\n${JSON.stringify(walls)}\n\`\`\`\n\n수정 지시: ${instruction}\n\n지시를 반영한 전체 벽 JSON을 반환하세요.`
      }]
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'no text in model response', stop: response.stop_reason });

    let parsed;
    try { parsed = JSON.parse(textBlock.text); }
    catch { return res.status(502).json({ error: 'model did not return valid JSON', raw: textBlock.text.slice(0, 500) }); }

    if (response.usage) {
      res.set('X-Usage-Input-Tokens', String(response.usage.input_tokens ?? ''));
      res.set('X-Usage-Output-Tokens', String(response.usage.output_tokens ?? ''));
      res.set('X-Usage-Model', MODEL);
    }
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'edit failed' });
  }
});

app.listen(PORT, () => console.log(`sketch3d extract API on :${PORT} (model=${MODEL})`));
