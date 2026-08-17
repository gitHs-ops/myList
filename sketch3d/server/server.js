// sketch3d — Extract API: 손그림 스케치 → 벽 좌표 JSON (Claude Vision)
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
    walls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end'],
        properties: {
          start: { type: 'array', items: { type: 'number' } },
          end: { type: 'array', items: { type: 'number' } }
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
- 창문/문은 이번 단계에서 무시하고 벽 선분만 추출합니다.
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

app.listen(PORT, () => console.log(`sketch3d extract API on :${PORT} (model=${MODEL})`));
