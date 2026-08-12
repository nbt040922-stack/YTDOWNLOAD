# Báo cáo sửa rollback enqueue Content Ops Bridge

## Lỗi

Bridge từng lưu handoff vào bộ nhớ trước khi `DownloadManager.enqueue()` thành công. Nếu enqueue ném lỗi, lần POST sau nhận nhầm phantom mapping và không khởi động download.

## Sửa

- Request mới chỉ được giữ và persist sau khi enqueue thành công.
- Enqueue lỗi không để lại handoff trong bộ nhớ hoặc file mapping.
- Restore gặp active mapping không thể enqueue lại sẽ loại mapping hỏng; POST sau có thể enqueue bình thường với cùng external ID ổn định.
- Không thay đổi API, DownloadManager, queue, manual download, port hoặc bảo mật loopback.

## Kiểm thử

Regression mô phỏng POST đầu enqueue lỗi, POST cùng handoff ID lần hai thành công, chỉ một DownloadManager job tồn tại và mapping `contentops-123` trỏ đúng job thật.

- `npm test`: 72 đạt, 0 lỗi.
- `npm run preflight`: đạt; yt-dlp, Deno và FFmpeg hoạt động.
- `node --check contentops-bridge.js`: đạt.
- `git diff --check`: đạt.
