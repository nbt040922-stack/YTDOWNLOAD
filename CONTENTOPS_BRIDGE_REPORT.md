# Báo cáo Content Ops Bridge

## Kiến trúc

`contentops-bridge.js` là HTTP adapter Node chuẩn, bind cứng `127.0.0.1`, gọi trực tiếp `DownloadManager.enqueue()`. Không có queue tải, downloader, retry classifier hay yt-dlp execution thứ hai.

## File thay đổi

- `contentops-bridge.js`: validation, HTTP lifecycle, idempotency mapping và state adapter
- `main.js`: khởi tạo/dừng bridge cạnh DownloadManager
- `test/contentops-bridge.test.js`: adapter, HTTP, exact path, restart và manual enqueue regression

DownloadManager, updater/recovery, yt-dlp args, cookie/auth, bundled runtime, preload, renderer và UI hiện có không bị viết lại.

## API contract

Bridge port lấy từ `CONTENTOPS_BRIDGE_PORT`, mặc định `8790`.

```http
POST /api/download-jobs
GET /api/download-jobs/{external_id}
GET /health
```

Request:

```json
{
  "handoff_id": "123",
  "video_id": "abcdefghijk",
  "video_url": "https://www.youtube.com/watch?v=abcdefghijk",
  "channel_name": "US Politics Daily",
  "work_dir": "D:\\ContentOps_Work\\123",
  "final_output_dir": "\\\\NAS\\ContentOps\\US Politics Daily"
}
```

Validation yêu cầu handoff ID an toàn, video ID 11 ký tự, URL HTTPS YouTube `/watch?v=` khớp video ID, channel name không rỗng và hai path tuyệt đối. Bridge không nhận token Telegram, cookie, password hoặc browser-session data.

## Idempotency và persistence

Mapping `handoff_id → external_id → manager_job_id` được lưu nguyên tử tại `contentops-handoffs.json` trong Electron userData.

- POST mới gọi `DownloadManager.enqueue()` đúng một lần.
- POST lặp cùng handoff ID trả record hiện có với HTTP 200.
- External ID ổn định (`contentops-<handoff_id>`).
- Manager job ID nội bộ có thể đổi khi app restart mà không phá client contract.

YTDOWNLOAD hiện chủ ý dùng queue session-only. Khi restart, bridge chỉ re-enqueue các Content Ops record còn active qua DownloadManager; terminal record không được tải lại. Đây là persistence cho integration mapping, không thay đổi queue/manual-download behavior hiện có.

## State và exact output path

Bridge mirror state/progress từ snapshot DownloadManager:

- `QUEUED`, `METADATA`, `DOWNLOADING`, `MERGING`, `VERIFYING`
- `DONE`, `FAILED`, `CANCELLED`

Khi DONE, response trả `downloaded_file_path = job.exact_output_path`. Path này là output chính xác mà DownloadManager đã kiểm tra tồn tại; bridge không scan directory hoặc suy luận filename.

## Security và lifecycle

- Host khác `127.0.0.1` bị từ chối ở constructor.
- Không expose LAN và không bind `0.0.0.0`.
- Payload tối đa 64 KiB.
- Bridge start sau DownloadManager initialization, lỗi bind chỉ được log và không phá UI.
- `before-quit` đóng server.

## Tests

- `npm test`: **70 passed, 0 failed**
- Bridge adapter: **5 tests**, gồm POST/enqueue, duplicate handoff, invalid request, GET/exact path, restart mapping, localhost HTTP lifecycle và manual enqueue unchanged
- `node --check contentops-bridge.js`: PASS
- `node --check main.js`: PASS
- `npm run preflight`: PASS
- Bundled engine diagnostics: yt-dlp, Deno, FFmpeg PASS
- `git diff --check`: PASS

Binary phục vụ regression được lấy từ các bản local hiện có và nằm trong `resources/bin/` bị Git ignore; không commit binary.

## Manual end-to-end

Bridge thật trên `127.0.0.1:8890` nhận job video `jNQXAC9IVRw` từ YT_NOTIFI worker.

DownloadManager log xác nhận:

```text
QUEUED → METADATA → DOWNLOADING → VERIFYING → DONE
```

Exact verified path:

```text
D:\ContentOps_Work_Test\1\Me at the zoo.mp4
```

Chỉ một file MP4 được tạo. POST lặp cùng handoff ID trả `contentops-1`; không tạo bản tải thứ hai. NAS mapping không nhận video. Artifact/mapping test đã được dọn sau xác minh.

## Phạm vi khóa

Manual download vẫn dùng enqueue path cũ và regression đạt. Không sửa state machine, executor, updater/recovery, retry classifier, auth/cookie, bundled runtime hoặc UI. Không tích hợp Silence Cutter hay ghi video sang NAS.
