import { prisma } from "./lib/prisma";
import { CMSNTService } from "./lib/cmsnt";
import { ShopGmailService } from "./lib/shopgmail";
import { GmailNo1Service } from "./lib/gmailno1"; // Import service mới
import { mailService } from "./lib/mail";
import { logger } from "./lib/logger";

/**
 * Worker xử lý hàng đợi đơn hàng
 */
async function startWorker() {
  logger.log("--- Order Worker is running with Multi-Resell Support... ---");

  while (true) {
    try {
      const job = await prisma.$transaction(async (tx) => {
        const pendingJobs = await tx.$queryRaw<any[]>`
          SELECT id, payload, attempts, maxAttempts FROM Job 
          WHERE status = 'PENDING' AND attempts < 5 
          ORDER BY createdAt ASC 
          LIMIT 1 
          FOR UPDATE
        `;

        if (!pendingJobs || pendingJobs.length === 0) return null;

        const targetJob = pendingJobs[0];

        return await tx.job.update({
          where: { id: targetJob.id },
          data: { 
            status: "PROCESSING",
            updatedAt: new Date()
          }
        });
      });

      if (!job) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      logger.log(`[Worker] Đang xử lý Job ID: ${job.id}`);
      
      const payload = JSON.parse(job.payload);
      const { orderId, productId, amount, userId, finalPrice } = payload;

      try {
        const product = await prisma.product.findUnique({ 
          where: { id: productId },
          include: { resellProvider: true }
        });
        
        if (!product) throw new Error("SẢN_PHẨM_KHÔNG_TỒN_TẠI");

        let deliveryData: string[] = [];

        if (product.type === "LOCAL") {
          deliveryData = await prisma.$transaction(async (tx) => {
            const availableStocks = await tx.$queryRaw<any[]>`
              SELECT id, content FROM Stock 
              WHERE productId = ${productId} AND isSold = false 
              LIMIT ${amount} 
              FOR UPDATE
            `;

            if (availableStocks.length < amount) {
              throw new Error("KHO_THAT_SU_HET_HANG");
            }

            const stockIds = availableStocks.map(s => s.id);
            const contents = availableStocks.map(s => s.content);

            await tx.stock.updateMany({
              where: { id: { in: stockIds } },
              data: { isSold: true, orderId: orderId }
            });

            return contents;
          });

        } else {
          const provider = product.resellProvider;
          if (!provider) throw new Error("SẢN_PHẨM_CHƯA_CẤU_HÌNH_NHÀ_CUNG_CẤP");

          if (provider.type === "CMSNT") {
            const cmsnt = new CMSNTService(provider.domain, provider.apiKey);
            const res = await cmsnt.buyProduct(product.resellProductId!, amount);
            if (res.status !== "success" || !Array.isArray(res.data)) {
              throw new Error(res.msg || "Lỗi API shop nguồn CMSNT");
            }
            deliveryData = res.data;
          } else if (provider.type === "SHOPGMAIL9999") {
            const shopGmail = new ShopGmailService(provider.domain, provider.apiKey);
            const res = await shopGmail.buyProduct(product.resellProductId!, amount);
            if (res.success !== true || !res.data || !Array.isArray(res.data.accounts)) {
              throw new Error(res.message || "Lỗi API shop nguồn SHOPGMAIL9999");
            }
            deliveryData = res.data.accounts;
          } else if (provider.type === "GMAIL_NO1") {
            // Xử lý mua hàng từ nguồn Gmailno1
            const gmailNo1 = new GmailNo1Service(provider.domain, provider.apiKey);
            const res = await gmailNo1.buyProduct(product.resellProductId!, amount);
            if (res.status !== "success" || !Array.isArray(res.data)) {
              throw new Error(res.msg || "Lỗi API shop nguồn Gmailno1");
            }
            deliveryData = res.data;
          } else {
            throw new Error(`LOẠI_NHÀ_CUNG_CẤP_CHƯA_HỖ_TRỢ: ${provider.type}`);
          }
        }

        const fileContent = deliveryData.join("\n");
        const fileName = `${orderId}.txt`;
        
        const uploadRes = await mailService.uploadText({
          filePath: fileName,
          text: fileContent,
          folder: "/Orders"
        });

        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: "SUCCESS",
            apiResponse: JSON.stringify({
              url: uploadRes.webUrl,
              fileId: uploadRes.id
            })
          }
        });

        await prisma.product.update({
          where: { id: productId },
          data: {
            soldCount: { increment: amount },
            resellStock: { decrement: amount }
          }
        });

        await prisma.job.update({ 
          where: { id: job.id }, 
          data: { status: "COMPLETED" } 
        });
        
        logger.log(`[Worker] Đơn hàng #${orderId} XỬ LÝ THÀNH CÔNG.`);

      } catch (err: any) {
        logger.error(`[Worker] Lỗi thực thi Job ${job.id}:`, err.message);

        const nextAttempt = job.attempts + 1;
        if (nextAttempt >= job.maxAttempts || err.message === "KHO_THAT_SU_HET_HANG" || err.message === "SẢN_PHẨM_CHƯA_CẤU_HÌNH_NHÀ_CUNG_CẤP") {
          await handleFailure(userId, orderId, finalPrice, job.id, err.message);
        } else {
          await prisma.job.update({
            where: { id: job.id },
            data: { 
              status: "PENDING", 
              attempts: nextAttempt, 
              error: err.message 
            }
          });
        }
      }

    } catch (globalErr) {
      logger.error("[Worker] Lỗi vòng lặp chính:", globalErr);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function handleFailure(userId: string, orderId: string, amount: number, jobId: string, errorMsg: string) {
  logger.log(`[Worker] Đang hoàn tiền cho đơn hàng #${orderId} do lỗi: ${errorMsg}`);
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) return;
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });
      await tx.order.update({ where: { id: orderId }, data: { status: "FAILURE", apiResponse: errorMsg } });
      await tx.transaction.create({
        data: {
          userId,
          amount: amount,
          balanceBefore: user.balance,
          balanceAfter: user.balance + amount,
          type: "REFUND",
          content: `Hoàn tiền đơn hàng #${orderId}: ${errorMsg}`
        }
      });
      await tx.job.update({ where: { id: jobId }, data: { status: "FAILED", error: errorMsg } });
    });
  } catch (e) {
    logger.error("[Worker] Lỗi nghiêm trọng khi thực hiện hoàn tiền:", e);
  }
}

startWorker();