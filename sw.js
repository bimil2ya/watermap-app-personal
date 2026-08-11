// 물지도 전자야장 Service Worker
const CACHE_NAME = 'watermap-v100';
const ASSETS = [
  './watermap_V100.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request).then(async response => {
      if (!response || response.status !== 200) return response;

      let buf;
      try {
        // 본문을 끝까지 읽어본다 — 약한 신호 등으로 연결이 중간에 끊긴
        // 응답이면 status는 200이어도 여기서 reject된다.
        buf = await response.clone().arrayBuffer();
      } catch (e) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw e;
      }

      // Content-Length는 와이어(압축) 크기이고 arrayBuffer()는 압축 해제된
      // 바이트라서, Content-Encoding이 붙은 응답(이 배포 환경 — GitHub
      // Pages/Fastly — 은 이 HTML에 항상 gzip을 적용)에는 이 둘을 비교할 수
      // 없다 — 정상적으로 완결된 응답도 매번 "불일치"로 오판돼 캐시가 영원히
      // 갱신되지 않는 회귀가 생긴다. Content-Encoding이 없을 때만 비교한다;
      // 그 경우 진짜 끊김 감지는 위 arrayBuffer() reject가 담당한다.
      const contentEncoding = response.headers.get('content-encoding');
      const declaredLength = response.headers.get('content-length');
      if (!contentEncoding && declaredLength && buf.byteLength !== Number(declaredLength)) {
        // 헤더가 알려준 길이와 실제 받은 바이트 수가 다름 — 불완전한 응답으로 간주.
        // 캐시가 있으면 폴백하고, 없으면 위 arrayBuffer() reject 경로와 대칭적으로
        // 안전하게 실패시킨다(길이가 안 맞는 응답을 정상인 것처럼 쓰지 않는다).
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw new Error('incomplete response: content-length mismatch, no cache available');
      }

      // buf는 이미 압축 해제된 바이트다 — 원본의 content-encoding/content-length
      // 헤더를 그대로 물려주면, 이 응답을 나중에 읽는 쪽(캐시에서 다시 꺼낼 때
      // 등)이 이미 풀린 바이트를 또 gunzip하려다 실패할 위험이 있다.
      const rebuiltHeaders = new Headers(response.headers);
      rebuiltHeaders.delete('content-encoding');
      rebuiltHeaders.set('content-length', String(buf.byteLength));
      const rebuilt = () => new Response(buf, {
        status: response.status,
        statusText: response.statusText,
        headers: rebuiltHeaders
      });
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, rebuilt()));
      return rebuilt();
    }).catch(() => caches.match(event.request))
  );
});
