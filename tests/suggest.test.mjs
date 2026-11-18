import {test, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/suggest.js';
import holidays from '../api/holidays.js';
const call = (query = '?year=2026&month=11') => handler.fetch(new Request(`https://local/api/suggest${query}`));
function setup() {
  process.env.HASA_API_KEY = 'synthetic-secret';
  mock.method(holidays, 'fetch', async () => Response.json({year:2026, month:11, items:[]}));
}
afterEach(() => {mock.restoreAll(); delete process.env.HASA_API_KEY;});
test('정상: 서버 키와 지정 모델을 사용하고 추천 세 개 반환', async () => {
  setup();
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://open.hasa.re.kr/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-secret');
    assert.equal(JSON.parse(init.body).model, 'gemma-4-31b');
    return Response.json({choices:[{message:{content:'1. 산책하기\n2. 독서하기\n3. 전시 보기'}}]});
  });
  const response = await call();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).suggestions, ['산책하기','독서하기','전시 보기']);
});
test('400: 잘못된 연월은 외부 호출 없음', async () => {
  const upstream = mock.method(globalThis, 'fetch', () => {throw Error('unexpected');});
  for (const query of ['?year=1999&month=1','?year=2026&month=13','?year=2026&month=1.5','']) assert.equal((await call(query)).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
});
test('500: 키 없음', async () => {assert.equal((await call()).status,500);});
test('429: 한도 초과 안내, 키 미노출', async () => {
  setup(); mock.method(globalThis,'fetch', async () => new Response('private upstream', {status:429}));
  const response = await call(); assert.equal(response.status,429); assert.doesNotMatch(await response.text(), /synthetic-secret|private upstream/);
});
test('504: 20초 경과 시 진행 중 요청 중단', async t => {
  setup(); t.mock.timers.enable({apis:['setTimeout']});
  let signal;
  mock.method(globalThis,'fetch', async (_, init) => {signal=init.signal; return new Promise(() => {});});
  const pending=call();
  for(let i=0;i<10;i++) await Promise.resolve();
  t.mock.timers.tick(20000);
  assert.equal((await pending).status,504); assert.equal(signal.aborted,true);
});
test('502: 잘못된 모델 응답 형식', async () => {
  setup(); mock.method(globalThis,'fetch',async () => Response.json({choices:[{message:{content:'하나만'}}]}));
  assert.equal((await call()).status,502);
});
test('공휴일 조회 실패 시 AI 호출 없음', async () => {
  setup(); mock.method(holidays,'fetch',async () => Response.json({error:'공휴일 조회 실패'},{status:502}));
  const upstream=mock.method(globalThis,'fetch',async () => {throw Error('unexpected');});
  assert.equal((await call()).status,502); assert.equal(upstream.mock.callCount(),0);
});
