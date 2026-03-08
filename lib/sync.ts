import { prisma } from "./prisma";
import { CMSNTService } from "./cmsnt";
import { logger } from "./logger";

/**
 * Hàm này sẽ được gọi bởi một Cron Job định kỳ
 * Tác dụng: Quét các sản phẩm RESELL và cập nhật số lượng tồn kho từ nguồn
 */
export async function syncResellStock() {
  logger.log("[Sync] Bắt đầu đồng bộ kho hàng Resell...");

  try {
    // 1. Lấy tất cả sản phẩm là RESELL và có đủ thông tin API
    const resellProducts = await prisma.product.findMany({
      where: {
        type: "RESELL",
        status: true,
        NOT: [
          { resellDomain: null },
          { resellApiKey: null },
          { resellProductId: null }
        ]
      }
    });
    
    for (const product of resellProducts) {
      const cmsnt = new CMSNTService(product.resellDomain!, product.resellApiKey!);
      const currentStock = await cmsnt.getStock(product.resellProductId!);
      // 2. Cập nhật vào Database của mình
      await prisma.product.update({
        where: { id: product.id },
        data: {
          resellStock: currentStock,
          lastSyncAt: new Date()
        }
      });

      logger.log(`[Sync] Đã cập nhật sản phẩm ID ${product.id}: ${currentStock} còn lại.`);
    }

    logger.log("[Sync] Hoàn tất đồng bộ.");
  } catch (error) {
    logger.error("[Sync] Lỗi nghiêm trọng khi đồng bộ:", error);
  }
}