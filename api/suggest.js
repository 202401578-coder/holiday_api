import holidays from './holidays.js';

const API = 'https://open.hasa.re.kr/v1/chat/completions';
export const maxDuration = 30;

export default {
  async fetch(request) {
    if (request.method !== 'GET') return fail(405, 'METHOD', 'GET 요청만 받습니다.');
    const params = new URL(request.url).searchParams;
    const year = params.get('year') ?? '';
    const month = params.get('month') ?? '';
    if (!/^\d{4}$/.test(year) || +year < 2000 || +year > 2099 || !/^\d{1,2}$/.test(month) || +month < 1 || +month > 12) {
      return fail(400, 'BAD_DATE', '연도는 2000~2099, 월은 1~12로 입력해 주세요.');
    }
    const key = process.env.HASA_API_KEY?.trim();
    if (key && !/^[\x21-\x7E]+$/.test(key)) return fail(500, 'INVALID_KEY_FORMAT', 'AI 인증키에 공백이나 한글 등 잘못된 문자가 포함돼 있습니다. 발급받은 키 문자열만 등록해 주세요.');
    if (!key) return fail(500, 'NO_KEY', '서버에 AI 인증키가 설정되지 않았습니다.');
    // 공휴일 조회와 AI 응답 본문 수신까지 합쳐 최대 20초만 기다립니다.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const work = async () => {
        const holidayResponse = await holidays.fetch(new Request(`https://local/api/holidays?${new URLSearchParams({year, month})}`));
        if (!holidayResponse.ok) return holidayResponse;
        const data = await holidayResponse.json();
        if (controller.signal.aborted) throw new DOMException('Timeout', 'AbortError');
        const response = await fetch(API, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({model: 'gemma-4-31b', max_tokens: 500, messages: [
            {role: 'system', content: '한국어로 이 달에 해 볼 만한 일을 정확히 세 줄 추천하세요. 한 줄에 한 가지, 각 100자 이내. 제공된 공휴일만 사실로 사용하세요. 공휴일이 없으면 주말이나 여가 활동을 추천하세요. 서문과 맺음말은 생략하세요.'},
            {role: 'user', content: JSON.stringify({year: data.year, month: data.month, holidays: data.items.filter(item => item.holiday)})},
          ]}),
        });
        if (response.status === 429) return fail(429, 'RATE_LIMIT', 'AI 이용 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.');
        if (!response.ok) return fail(502, 'AI_UPSTREAM', 'AI 서비스가 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        const body = await response.json();
        const content = body?.choices?.[0]?.message?.content;
        const suggestions = typeof content === 'string' ? content.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean) : [];
        if (suggestions.length !== 3 || suggestions.some(line => line.length > 200)) return fail(502, 'AI_FORMAT', 'AI 추천 형식이 올바르지 않습니다. 다시 시도해 주세요.');
        return Response.json({year: +year, month: +month, suggestions, model: 'gemma-4-31b'}, {headers: {'Cache-Control': 'no-store'}});
      };
      const timeout = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), {once: true}));
      return await Promise.race([work(), timeout]);
    } catch (error) {
      console.error('[suggest] request failed', {name: error?.name, causeCode: error?.cause?.code});
      return error?.name === 'AbortError' || error?.name === 'TimeoutError'
        ? fail(504, 'AI_TIMEOUT', '추천 요청이 20초를 넘었습니다. 잠시 뒤 다시 시도해 주세요.')
        : fail(502, 'AI_NETWORK', 'AI 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally { clearTimeout(timer); }
  },
};

function fail(status, code, error) {
  return Response.json({code, error}, {status, headers: {'Cache-Control': 'no-store'}});
}
