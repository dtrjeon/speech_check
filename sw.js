/* ════════════ Service Worker — 전폭전문구두점검 ════════════ */
// index.html(관리자/전체기능판)과 index_speech.html(훈련생 배포판)은 서로 다른 별도 페이지.
// PWA 홈 화면 설치는 index_speech.html 기준(manifest.json start_url)이라 이걸 우선 캐시하고,
// index.html도 관리자가 오프라인에서 열 수 있도록 함께 캐시함.
const CACHE_NAME = 'jee-speech-v2';

// 설치 시 기본 파일 캐시
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        '/speech_check/',
        '/speech_check/index_speech.html',  // 훈련생 배포판 (PWA 기본 시작 페이지)
        '/speech_check/index.html'          // 관리자/전체기능판
      ])
    )
  );
});

// 활성화 시 이전 캐시 정리
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패 시 캐시 반환
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
