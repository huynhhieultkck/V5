import { syncResellStock } from "../lib/sync";
import { logger } from "../lib/logger";
/**
 * Tiến trình chạy ngầm để đồng bộ kho hàng từ các nguồn Resell (CMSNT)
 * Mặc định chạy mỗi 5 phút một lần để tránh spam API nguồn nhưng vẫn đảm bảo kho hàng cập nhật
 */
const syncInterval = Number(process.env.CRON_SYNC_INTERVAL) || 30000;



export async function startSyncCron() {
  logger.log('--- Resell Sync Cron Job started... ---');

  while (true) {
    try {
      // Gọi hàm đồng bộ từ lib/sync.ts
      await syncResellStock();
    } catch (err: any) {
      logger.error('[SyncCron] Lỗi trong quá trình đồng bộ:', err.message);
    }

    // Chờ 5 phút (300,000 ms) trước khi thực hiện lượt tiếp theo
    // Bạn có thể điều chỉnh thời gian này tùy theo nhu cầu
    await new Promise(rs => setTimeout(rs, syncInterval));
  }
}