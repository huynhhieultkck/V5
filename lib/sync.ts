import { prisma } from "./prisma";
import { CMSNTService } from "./cmsnt";
import { logger } from "./logger";

/**
 * Đồng bộ tồn kho từ các nguồn Resell Provider
 */
export async function syncResellStock() {
  logger.log("[Sync] Bắt đầu đồng bộ kho hàng Resell...");

  try {
    const resellProducts = await prisma.product.findMany({
      where: {
        type: "RESELL",
        status: true,
        NOT: {
          resellProviderId: null
        }
      },
      include: {
        resellProvider: true
      }
    });
    
    for (const product of resellProducts) {
      const provider = product.resellProvider;
      
      if (!provider || !product.resellProductId) continue;

      try {
        let currentStock = 0;

        if (provider.type === "CMSNT") {
          const cmsnt = new CMSNTService(provider.domain, provider.apiKey);
          currentStock = await cmsnt.getStock(product.resellProductId);
        }

        await prisma.product.update({
          where: { id: product.id },
          data: {
            resellStock: currentStock,
            lastSyncAt: new Date()
          }
        });

        logger.log(`[Sync] Sản phẩm ID ${product.id} (Nguồn: ${provider.name}): ${currentStock} còn lại.`);
      } catch (productErr: any) {
        logger.error(`[Sync] Lỗi cập nhật sản phẩm ID ${product.id}:`, productErr.message);
      }
    }

    logger.log("[Sync] Hoàn tất đồng bộ.");
  } catch (error) {
    logger.error("[Sync] Lỗi nghiêm trọng khi đồng bộ:", error);
  }
}