// Secret key는 이 서버 함수에서만 사용합니다. 브라우저로 보내지 않습니다.
const reply = (status, data, extra = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
export default {
  async fetch(request) {
    if (!['GET', 'POST'].includes(request.method)) return reply(405, { error: 'GET 또는 POST만 가능합니다.' }, { Allow: 'GET, POST' });
    if (request.method === 'POST' && request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return reply(403, { error: '같은 사이트에서 작성해주세요.' });
    let entry;
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.includes('application/json')) return reply(415, { error: 'JSON으로 보내주세요.' });
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 4096) return reply(413, { error: '요청이 너무 큽니다.' });
      try { entry = JSON.parse(raw); } catch { return reply(400, { error: '올바른 JSON이 아닙니다.' }); }
      if (!entry || typeof entry.nickname !== 'string' || typeof entry.message !== 'string') return reply(400, { error: '별명과 한 줄 메시지가 필요합니다.' });
      entry = { nickname: entry.nickname.trim(), message: entry.message.trim() };
      if ([...entry.nickname].length < 1 || [...entry.nickname].length > 20 || [...entry.message].length < 1 || [...entry.message].length > 200 || /[\r\n]/.test(entry.message)) return reply(400, { error: '별명은 1~20자, 메시지는 줄바꿈 없이 1~200자로 적어주세요.' });
    }
    const url = process.env.SUPABASE_URL;
    const key = request.method === 'POST' ? process.env.SUPABASE_SECRET_KEY : process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return reply(500, { code: 'NO_KEY', error: '서버의 Supabase 환경 변수 설정이 필요합니다.' });
    try {
      const endpoint = new URL('/rest/v1/guestbook_entries', url);
      endpoint.searchParams.set('select', 'id,nickname,message,created_at');
      if (request.method === 'GET') { endpoint.searchParams.set('order', 'created_at.desc,id.desc'); endpoint.searchParams.set('limit', '50'); }
      const response = await fetch(endpoint, { method: request.method, headers: { apikey: key, 'Content-Type': 'application/json', ...(entry ? { Prefer: 'return=representation' } : {}) }, body: entry ? JSON.stringify(entry) : undefined, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return reply(502, { error: '방명록 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' });
      const rows = await response.json();
      return reply(entry ? 201 : 200, entry ? { entry: rows[0] } : { entries: rows });
    } catch { return reply(502, { error: '방명록 연결 시간이 초과되었거나 연결에 실패했습니다.' }); }
  }
};
