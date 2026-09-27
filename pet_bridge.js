(function (root) {
    "use strict";
    function createPetWeb(env) {
        const document = env.document;
        const events = [];
        const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
        const TEST_REASON = "웹 테스트 모드 · 실제 걸음과 실외 판별은 측정하지 않아요.";
        let photo = null, photoGeneration = 0, camera = null, cameraGeneration = 0, latestFrame = "", walking = false;
        const emit = event => events.push(event);
        const cameraStatus = (state, message) => emit({ type: "walk_camera_status", state, message });
        const walkStatus = (active, reason = TEST_REASON) => emit({ type: "walk_status", data: {
            active, outdoor: active ? "test" : "paused", reason, accuracy: -1, satellites: 0, step_sensor: false
        } });

        function button(label, action, callback) {
            const element = document.createElement("button");
            element.type = "button"; element.textContent = label;
            element.setAttribute("data-pet-web-action", action);
            Object.assign(element.style, { minHeight: "48px", padding: "12px 18px", margin: "6px", borderRadius: "14px", border: "1px solid #758f86", fontSize: "17px", cursor: "pointer", background: "#e1f0e9", color: "#213d33", touchAction: "manipulation" });
            element.addEventListener("click", callback);
            return element;
        }
        function dialog(title, explanation, cancel) {
            const overlay = document.createElement("div");
            overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", title);
            Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(18,33,29,.76)", padding: "18px", boxSizing: "border-box", fontFamily: "system-ui,sans-serif" });
            const panel = document.createElement("div");
            Object.assign(panel.style, { maxWidth: "420px", width: "100%", padding: "24px", borderRadius: "22px", boxSizing: "border-box", color: "#213d33", background: "#fffaf0", textAlign: "center" });
            const heading = document.createElement("h2"); heading.textContent = title;
            const text = document.createElement("p"); text.textContent = explanation; text.style.lineHeight = "1.6";
            panel.appendChild(heading); panel.appendChild(text);
            const close = button("취소", "cancel", cancel); panel.appendChild(close);
            overlay.appendChild(panel); document.body.appendChild(overlay);
            return { overlay, panel, text, close, remove() { overlay.remove(); } };
        }
        function endPhoto(session, event) {
            if (photo !== session) return;
            photo = null; session.done = true;
            if (session.focusTimer) env.clearTimeout(session.focusTimer);
            env.removeEventListener("focus", session.focus);
            session.input.value = ""; session.modal.remove();
            if (event) emit({ ...event, request_id: session.id });
        }
        async function decodePhoto(file) {
            // Browser decoding applies EXIF orientation before canvas receives pixels.
            if (typeof env.createImageBitmap === "function") {
                try {
                    const bitmap = await env.createImageBitmap(file, { imageOrientation: "from-image" });
                    return { image: bitmap, width: bitmap.width, height: bitmap.height, close() { bitmap.close(); } };
                } catch (_) { /* Safari may decode a format through HTMLImageElement instead. */ }
            }
            return new Promise((resolve, reject) => {
                const image = new env.Image();
                const url = env.URL.createObjectURL(file);
                image.onload = () => {
                    env.URL.revokeObjectURL(url);
                    resolve({ image, width: image.naturalWidth, height: image.naturalHeight, close() { image.src = ""; } });
                };
                image.onerror = () => { env.URL.revokeObjectURL(url); reject(new Error("이 브라우저가 사진 형식을 읽지 못했어요. JPEG 또는 PNG 사진을 선택해 주세요.")); };
                image.src = url;
            });
        }
        function jpegPayload(canvas, quality) {
            const value = canvas.toDataURL("image/jpeg", quality);
            const prefix = "data:image/jpeg;base64,";
            if (!value.startsWith(prefix)) throw new Error("사진을 JPEG로 변환할 수 없어요.");
            return value.slice(prefix.length);
        }
        async function importPhotos(session) {
            if (photo !== session || session.processing) return;
            const files = Array.from(session.input.files || []);
            session.input.value = "";
            if (!files.length) { endPhoto(session, { type: "photo_cancelled" }); return; }
            session.processing = true; session.choose.disabled = true;
            try {
                if (files.length > 15 || (!session.multiple && files.length > 1)) throw new Error("사진은 한 번에 최대 15장까지 선택할 수 있어요.");
                for (const file of files) {
                    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error("사진 한 장의 크기는 32MB 이하여야 해요.");
                    if (file.type && !file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해 주세요.");
                }
                const normalized = [];
                for (let index = 0; index < files.length; index++) {
                    if (photo !== session) return;
                    session.modal.text.textContent = `사진을 준비하고 있어요 (${index + 1}/${files.length}). 사진은 이 브라우저 안에서만 처리돼요.`;
                    const decoded = await decodePhoto(files[index]);
                    const canvas = document.createElement("canvas");
                    try {
                        if (photo !== session) return;
                        if (!decoded.width || !decoded.height) throw new Error("사진 크기를 읽을 수 없어요.");
                        const scale = Math.min(1, 2048 / Math.max(decoded.width, decoded.height));
                        canvas.width = Math.max(1, Math.round(decoded.width * scale));
                        canvas.height = Math.max(1, Math.round(decoded.height * scale));
                        const context = canvas.getContext("2d");
                        if (!context) throw new Error("이 브라우저에서 사진을 변환할 수 없어요.");
                        context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
                        const base64 = jpegPayload(canvas, 0.86);
                        if (base64.length > 16 * 1024 * 1024) throw new Error("변환한 사진이 너무 커요. 더 작은 사진을 선택해 주세요.");
                        normalized.push(base64);
                    } finally { decoded.close(); canvas.width = 0; canvas.height = 0; }
                }
                endPhoto(session, { type: "photos_selected", files: normalized });
            } catch (error) {
                endPhoto(session, { type: "photo_error", message: error.message || "사진을 읽지 못했어요. 다른 사진으로 다시 시도해 주세요." });
            }
        }
        function choosePhotos(multiple = false, capture = false) {
            if (photo) endPhoto(photo, null);
            const session = { id: ++photoGeneration, multiple: !!multiple, processing: false, done: false, focusTimer: 0 };
            const input = document.createElement("input");
            input.type = "file"; input.accept = "image/*"; input.multiple = !!multiple;
            if (capture) input.setAttribute("capture", "environment");
            Object.assign(input.style, { position: "absolute", width: "1px", height: "1px", opacity: "0", overflow: "hidden" });
            session.input = input;
            session.modal = dialog(capture ? "공간 사진 촬영" : "사진 선택", "아래 버튼을 눌러 사진을 선택해 주세요. 사진은 업로드되지 않으며 이 브라우저 안에서 처리돼요.", () => endPhoto(session, { type: "photo_cancelled" }));
            session.choose = button(capture ? "카메라로 촬영하기" : "사진 선택하기", "choose", () => {
                if (session.processing || photo !== session) return;
                input.value = "";
                // This synchronous call is inside a real DOM click, including on iOS Safari.
                input.click();
            });
            session.modal.panel.appendChild(session.choose); session.modal.panel.appendChild(input);
            session.focus = () => {
                if (session.focusTimer) env.clearTimeout(session.focusTimer);
                session.focusTimer = env.setTimeout(() => {
                    if (photo !== session || session.processing || (input.files && input.files.length)) return;
                    // Focus often returns before iOS delivers change. Never infer cancellation.
                    session.modal.text.textContent = "사진 선택을 마치지 않았다면 다시 선택하거나 취소를 눌러 주세요.";
                    session.choose.disabled = false;
                }, 1200);
            };
            input.addEventListener("change", () => importPhotos(session));
            input.addEventListener("cancel", () => { if (!session.processing) endPhoto(session, { type: "photo_cancelled" }); });
            env.addEventListener("focus", session.focus);
            photo = session; session.choose.focus();
            return session.id;
        }

        function stopStream(stream) { if (stream) for (const track of stream.getTracks()) track.stop(); }
        function closeCamera(state = "off", message = "카메라를 껐어요.", notify = true) {
            const session = camera;
            camera = null; cameraGeneration++; latestFrame = "";
            if (session) {
                if (session.interval) env.clearInterval(session.interval);
                if (session.video) { session.video.pause(); session.video.srcObject = null; session.video.remove(); }
                stopStream(session.stream);
                if (session.canvas) { session.canvas.width = 0; session.canvas.height = 0; }
                session.modal.remove();
            }
            if (notify) cameraStatus(state, message);
        }
        const isCurrentCamera = session => camera === session && session.generation === cameraGeneration && !document.hidden;
        function cameraFailure(session, error) {
            if (camera !== session) return;
            if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) closeCamera("permission_denied", "카메라 권한을 허용해야 실시간 배경을 사용할 수 있어요.");
            else if (error && (error.name === "NotFoundError" || error.name === "OverconstrainedError")) closeCamera("unsupported", "사용 가능한 카메라를 찾지 못했어요.");
            else closeCamera("error", "카메라를 사용할 수 없어요. 다른 카메라 앱을 닫고 다시 시도해 주세요.");
        }
        async function openCamera(session) {
            if (!isCurrentCamera(session) || session.opening) return;
            session.opening = true; session.start.disabled = true;
            session.modal.text.textContent = "카메라 권한을 확인하고 있어요. 원하면 취소할 수 있어요.";
            try {
                const stream = await env.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 5, max: 10 } } });
                if (!isCurrentCamera(session)) { stopStream(stream); return; }
                session.stream = stream;
                for (const track of stream.getTracks()) {
                    track.addEventListener("ended", () => { if (isCurrentCamera(session)) closeCamera("error", "카메라 연결이 끝났어요. 다시 켜 주세요."); });
                    track.addEventListener("mute", () => {
                        if (!isCurrentCamera(session)) return;
                        latestFrame = "";
                        const mediaTime = session.video ? Number(session.video.currentTime) : NaN;
                        if (Number.isFinite(mediaTime)) session.lastVideoTime = mediaTime;
                    });
                }
                const video = document.createElement("video");
                video.muted = true; video.defaultMuted = true; video.autoplay = true; video.playsInline = true;
                video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", "");
                Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", bottom: "0", left: "0", opacity: "0", pointerEvents: "none" });
                video.srcObject = stream; session.video = video; document.body.appendChild(video);
                await video.play();
                if (!isCurrentCamera(session)) return;
                const canvas = document.createElement("canvas"); session.canvas = canvas;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas unavailable");
                session.modal.remove();
                cameraStatus("ready", "실시간 카메라 배경이에요. 캐릭터는 화면에 겹쳐 표시돼요.");
                session.interval = env.setInterval(() => {
                    if (!isCurrentCamera(session) || !video.videoWidth || !video.videoHeight) return;
                    const mediaTime = Number(video.currentTime);
                    const unavailable = stream.getTracks().some(track => track.muted || track.enabled === false || track.readyState === "ended");
                    if (unavailable || video.readyState < 2) {
                        latestFrame = "";
                        if (Number.isFinite(mediaTime)) session.lastVideoTime = mediaTime;
                        return;
                    }
                    // A timer tick is not evidence of a new camera frame. Do not keep
                    // a frozen image alive past Godot's stale-frame timeout.
                    if (!Number.isFinite(mediaTime) || mediaTime <= session.lastVideoTime) {
                        if (mediaTime < session.lastVideoTime) { session.lastVideoTime = mediaTime; latestFrame = ""; }
                        return;
                    }
                    session.lastVideoTime = mediaTime;
                    try {
                        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
                        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                        context.drawImage(video, 0, 0, canvas.width, canvas.height);
                        latestFrame = jpegPayload(canvas, 0.68);
                    } catch (error) { cameraFailure(session, error); }
                }, 200);
            } catch (error) { cameraFailure(session, error); }
        }
        function setCamera(enabled) {
            if (!enabled) { closeCamera(); return; }
            if (camera) return;
            if (document.hidden) { cameraStatus("paused", "화면으로 돌아와 카메라 모드를 다시 켜 주세요."); return; }
            if (env.isSecureContext === false) { cameraStatus("unsupported", "카메라는 HTTPS 주소에서만 사용할 수 있어요."); return; }
            if (!env.navigator || !env.navigator.mediaDevices || !env.navigator.mediaDevices.getUserMedia) { cameraStatus("unsupported", "이 브라우저는 실시간 카메라를 지원하지 않아요."); return; }
            const session = { generation: ++cameraGeneration, stream: null, video: null, canvas: null, interval: 0, opening: false, lastVideoTime: -1 };
            session.modal = dialog("카메라 배경 켜기", "카메라 화면은 업로드하거나 저장하지 않아요. 아래 버튼을 눌러 카메라 권한을 허용해 주세요.", () => { if (camera === session) closeCamera("cancelled", "카메라 시작을 취소했어요."); });
            session.start = button("카메라 켜기", "camera-start", () => openCamera(session));
            session.modal.panel.appendChild(session.start); camera = session;
            cameraStatus("checking", "브라우저 창의 카메라 켜기 버튼을 눌러 주세요.");
            session.start.focus();
        }
        function pausePage() {
            if (camera) closeCamera("paused", "화면을 벗어나 카메라를 껐어요. 다시 켜려면 카메라 모드를 눌러 주세요.");
            if (walking) { walking = false; walkStatus(false, "화면을 벗어나 웹 테스트 산책을 일시 정지했어요."); }
            // A system file picker may hide Safari; its photo selection must remain pending.
        }
        document.addEventListener("visibilitychange", () => { if (document.hidden) pausePage(); });
        env.addEventListener("pagehide", pausePage);

        return {
            choose_photos: choosePhotos,
            cancel_photos() { if (photo) endPhoto(photo, { type: "photo_cancelled" }); },
            set_walk_camera: setCamera,
            consume_frame() { const frame = latestFrame; latestFrame = ""; return frame; },
            poll_events() { return JSON.stringify(events.splice(0)); },
            start_walk() {
                if (document.hidden) { walkStatus(false, "화면으로 돌아와 웹 테스트 산책을 다시 시작해 주세요."); return; }
                walking = true; walkStatus(true);
            },
            stop_walk() { walking = false; walkStatus(false, "웹 테스트 산책을 마쳤어요."); closeCamera(); },
            add_test_steps(amount) {
                if (!walking || document.hidden || !Number.isInteger(amount) || amount < 1 || amount > 5000) return false;
                walkStatus(true); emit({ type: "walk_steps", delta: amount }); return true;
            }
        };
    }
    if (typeof module !== "undefined" && module.exports) module.exports = { createPetWeb };
    if (root && root.document) root.PetWeb = createPetWeb(root);
})(typeof window !== "undefined" ? window : null);
