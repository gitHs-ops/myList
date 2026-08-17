// sketch3d — Extract API: 손그림 스케치 → 벽 좌표 JSON (Claude Vision)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const PORT = process.env.PORT || 8787;
const MODEL = process.env.VISION_MODEL || 'claude-opus-5';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/', (_req, res) => res.send('sketch3d extract API OK'));
app.get('/health', (_req, res) => res.json({ ok: true, model: MODEL }));

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
          sill: { type: 'number' },       // 소벽: 바닥~개구부 하단(창 아래 벽). 문은 0
          lintel: { type: 'number' }      // 인방: 개구부 상단~천장(개구부 위 벽)
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
- 개구부가 없는 벽은 sill/lintel을 넣지 않습니다(솔리드 벽).
- north: 도면에서 북쪽이 어느 방향인지 = 'up'(위,+y) | 'down' | 'left' | 'right'. 스케치에 방위표(N 화살표 등)가 있으면 반영하고, 없으면 'up'으로 둡니다.
- roof: 지붕 정보(옵션). { type: 'flat'|'gable'|'none', pitch: 물매(°, 박공), overhang: 처마내밀기(mm), ridge: 'x'|'y'(박공 능선 방향) }. 스케치에 지붕/단면이 보이면 반영하고, 없으면 생략합니다.
- 확신이 낮거나 추정한 내용은 notes에 한국어로 간단히 남깁니다.`;

app.post('/api/extract', async (req, res) => {
  try {
    const { image, images, wallHeight = 2700, wallThickness = 200 } = req.body || {};
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
      max_tokens: 8000,
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
- 벽별 옵션 필드로 높이/개구부를 다룰 수 있습니다: height(벽 높이), thickness(두께), sill(소벽=바닥~개구부 하단), lintel(인방=개구부 상단~천장). 개구부 높이 = height - sill - lintel. 문은 sill=0. "창 달아줘/개구부"류 지시는 이 필드로 반영하고, "창 없애줘"는 sill/lintel을 제거합니다.
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
      max_tokens: 8000,
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

    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'edit failed' });
  }
});

app.listen(PORT, () => console.log(`sketch3d extract API on :${PORT} (model=${MODEL})`));
