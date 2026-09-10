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
    rooms: {                          // 방 용도 이름표 (선택)
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'point'],
        properties: {
          label: { type: 'string' },  // 방 용도 (예: 침실, 거실, 주방, 욕실, 드레스룸)
          point: { type: 'array', items: { type: 'number' } }  // 그 방 내부 대표 좌표 [x,y]
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
- rooms: 스케치에 "침실"·"거실"·"주방"·"욕실" 같은 방 용도 이름이 손글씨로 적혀 있으면, 그 이름과 해당 방 내부의 대표 좌표를 rooms 배열에 담습니다: [{label, point:[x,y]}]. point는 그 방 벽 안쪽 아무 지점이면 됩니다. 방 이름이 스케치에 전혀 없으면 rooms는 생략합니다(임의로 추측해 붙이지 마세요).
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

// /api/edit 전용 — 이미 3D에 배치된 가구 배열(선택). 배치·삭제·이동은 클라이언트의 직접
// 클릭 UI 몫이라 이 스키마는 크기(width/depth/height) 수정만 반영하도록 값을 받는다.
// WALL_SCHEMA(추출용)에는 넣지 않는다 — 스케치 추출 결과에 가구를 지어내는 걸 원천적으로 막기 위해.
const FURNITURE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'x', 'z', 'width', 'depth', 'height'],
  properties: {
    id: { type: 'string' },     // 클라이언트가 배치 시 부여한 안정적 식별자 — 그대로 돌려줄 것
    type: { type: 'string', enum: ['sink', 'bed', 'bedSingle', 'sofa', 'table', 'desk', 'fridge'] },
    x: { type: 'number' }, z: { type: 'number' },              // 배치 좌표(벽과 같은 좌표계) — 그대로 유지
    width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' }  // mm, 실제 적용 치수
  }
};

const EDIT_SCHEMA = {
  ...WALL_SCHEMA,
  properties: { ...WALL_SCHEMA.properties, furniture: { type: 'array', items: FURNITURE_ITEM_SCHEMA } }
};

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
- rooms(방 이름표): [{label, point:[x,y]}] 배열입니다. "왼쪽 방을 침실로", "가운데를 거실로 표시해줘" 같은 지시는 그 방 벽 안쪽 대표 좌표를 잡아 rooms에 추가/수정합니다(같은 방이면 point는 유지하고 label만 바꿉니다). "이름표 지워줘"는 해당 항목을 rooms에서 제거합니다. 다른 방 이름표와 겹치지 않게 좌표를 잡습니다.
- 지시와 무관한 벽은 그대로 둡니다. 방이 닫혀 있어야 하면 연결 좌표를 함께 맞춥니다.
- furniture(이미 3D에 배치된 가구 목록, 선택 필드): [{id, type, x, z, width, depth, height}] 배열로 함께 주어질 수 있습니다.
  · 이 배열은 오직 "가로/세로(깊이)/높이" 같은 치수 수정 지시에만 씁니다. 가구를 새로 추가하거나 지우거나
    위치(x,z)를 옮기는 지시는 이 필드로 처리하지 마세요(그런 지시는 notes에 "3D 화면에서 직접 배치/클릭으로
    조작해 주세요"라고 안내하고, 배열 자체는 건드리지 않습니다) — 배치·삭제·이동은 사용자가 3D 화면을 직접
    클릭해서 하는 별도 기능입니다.
  · "가로"=width, "세로"나 "깊이"=depth, "높이"=height 로 해석합니다. "~로/~으로"는 절대값 지정(예: "가로
    1000으로"→width:1000), "~늘려/~줄여"는 현재 값 기준 가감(예: "가로 100 늘려"→width: 기존값+100)입니다.
  · type(예: "싱크대"→sink, "소파"→sofa)으로 대상을 찾습니다. 같은 type이 여러 개 배치돼 있고 지시가 어느
    것인지 특정하지 않으면(위치 등으로) 해당 type 전부에 같은 값을 적용하고, 그렇게 처리했음을 notes에
    남깁니다. 지시에 해당하는 type이 furniture 배열에 하나도 없으면 배열은 그대로 두고 notes에 "현재
    배치된 항목이 없어 반영하지 못했습니다"라고 남깁니다.
  · id/x/z는 절대 바꾸지 않고 그대로 돌려줍니다. 지시와 무관한 항목도 배열에서 빠짐없이 그대로 돌려줍니다
    (echo) — 언급되지 않은 항목이라고 배열에서 빼면 안 됩니다.
  · furniture 필드 자체가 요청에 없으면 응답에도 넣지 않습니다.
- notes에는 무엇을 어떻게 바꿨는지 한국어로 짧게 적습니다. 지시가 모호하면 합리적으로 해석하고 그 사실을 notes에 남깁니다.
- 반드시 전체 벽 JSON(수정 결과)을 반환합니다. furniture가 입력에 있었다면 그 배열도(수정 여부와 무관하게 전체를) 함께 반환합니다.`;

app.post('/api/edit', async (req, res) => {
  try {
    const { walls, furniture, instruction } = req.body || {};
    if (!walls || typeof walls !== 'object') {
      return res.status(400).json({ error: 'walls (current wall JSON object) required' });
    }
    if (!instruction || typeof instruction !== 'string') {
      return res.status(400).json({ error: 'instruction (text) required' });
    }

    // furniture는 선택 필드 — 안 보내면(구버전 클라이언트 포함) 프롬프트에도 안 실어 기존 동작과 동일하게 유지.
    const furnitureBlock = Array.isArray(furniture)
      ? `\n\n현재 배치된 가구 목록(치수 수정 지시가 있을 때만 사용, 추가/삭제/이동 금지):\n\`\`\`json\n${JSON.stringify(furniture)}\n\`\`\``
      : '';

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: EDIT_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: EDIT_SCHEMA } },
      messages: [{
        role: 'user',
        content: `현재 벽 JSON:\n\`\`\`json\n${JSON.stringify(walls)}\n\`\`\`${furnitureBlock}\n\n수정 지시: ${instruction}\n\n지시를 반영한 전체 벽 JSON을 반환하세요.`
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
