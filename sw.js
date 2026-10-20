/* 서비스 워커 — 홈 화면 앱(PWA)으로 설치할 수 있게 해준다.
   데이터는 항상 Supabase에서 최신으로 받아야 하므로 파일을 캐시하지 않고 그대로 네트워크로 요청한다.
   (사이트를 고치면 앱에도 바로 반영된다) 인터넷이 끊겼을 때만 안내 화면을 보여준다. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if(event.request.mode !== "navigate") return; // 화면 이동 요청만 다룬다
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>FTE 및 과제 관리</title></head>' +
      '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F6F8;font-family:\'Malgun Gothic\',sans-serif;color:#17232E;text-align:center;padding:20px;">' +
      '<div><div style="font-size:18px;font-weight:800;margin-bottom:8px;">인터넷에 연결되지 않았어요</div>' +
      '<div style="font-size:13px;color:#64748B;margin-bottom:16px;">연결을 확인한 뒤 다시 시도해 주세요.</div>' +
      '<button onclick="location.reload()" style="padding:9px 16px;border-radius:8px;border:none;background:#1F6F78;color:#fff;font-weight:700;">다시 시도</button></div></body></html>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    ))
  );
});
