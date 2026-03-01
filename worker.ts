import { prisma } from "./lib/prisma";
import { CMSNTService } from "./lib/cmsnt";
import { mailService } from "./lib/mail";
import { OrderStatus } from "./generated/prisma/client";
import { logger } from "./lib/logger";

/**
 * Worker xử lý hàng đợi đơn hàng - Đã sửa lỗi Job Duplication
 */
async function startWorker() {
  logger.log("--- Order Worker is running with Strict Locking... ---");

  while (true) {
    try {
      /**
       * 1. "Claim" Job sử dụng SELECT FOR UPDATE
       * Bước này cực kỳ quan trọng để chống Race Condition giữa các Worker (PM2 Cluster)
       */
      const job = await prisma.$transaction(async (tx) => {
        // Sử dụng truy vấn thô để khóa bản ghi Job ở mức hàng (Row-level locking)
        const pendingJobs = await tx.$queryRaw<any[]>`
          SELECT id, payload, attempts, maxAttempts FROM Job 
          WHERE status = 'PENDING' AND attempts < 5 
          ORDER BY createdAt ASC 
          LIMIT 1 
          FOR UPDATE
        `;

        if (!pendingJobs || pendingJobs.length === 0) return null;

        const targetJob = pendingJobs[0];

        // Cập nhật trạng thái ngay lập tức trong cùng một transaction đang giữ khóa
        return await tx.job.update({
          where: { id: targetJob.id },
          data: { 
            status: "PROCESSING",
            updatedAt: new Date()
          }
        });
      });

      // Nếu không có job nào, chờ 2 giây rồi quét tiếp
      if (!job) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      logger.log(`[Worker] Đang xử lý Job ID: ${job.id}`);
      
      const payload = JSON.parse(job.payload);
      const { orderId, productId, amount, userId, finalPrice } = payload;

      try {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) throw new Error("SẢN_PHẨM_KHÔNG_TỒN_TẠI");

        let deliveryData: string[] = [];

        // 2. THỰC HIỆN LẤY HÀNG (FULFILLMENT)
        if (product.type === "LOCAL") {
          // CHỐNG TRÙNG LẶP KHO: Tiếp tục sử dụng Row-level locking cho bảng Stock
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

            // Đánh dấu đã bán
            await tx.stock.updateMany({
              where: { id: { in: stockIds } },
              data: { isSold: true, orderId: orderId }
            });

            return contents;
          });

        } else {
          // Lấy từ nguồn CMSNT (Resell)
          const cmsnt = new CMSNTService(product.resellDomain!, product.resellApiKey!);
          const res = await cmsnt.buyProduct(product.resellProductId!, amount);
          
          if (res.status !== "success" || !Array.isArray(res.data)) {
            throw new Error(res.msg || "Lỗi API shop nguồn");
          }
          deliveryData = res.data;
        }

        // 3. LƯU VÀO ONEDRIVE (Lưu trữ lịch sử hàng đã bán)
        const fileContent = deliveryData.join("\n");
        const fileName = `${orderId}.txt`;
        
        const uploadRes = await mailService.uploadText({
          filePath: fileName,
          text: fileContent,
          folder: "/Orders"
        });

        // 4. CẬP NHẬT ĐƠN HÀNG THÀNH CÔNG
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

        // 5. CẬP NHẬT THỐNG KÊ DOANH SỐ
        await prisma.product.update({
          where: { id: productId },
          data: {
            soldCount: { increment: amount },
            // Nếu là LOCAL thì số lượng resellStock thực chất là hàng trong kho của mình
            resellStock: { decrement: amount }
          }
        });

        // Đánh dấu Job hoàn tất
        await prisma.job.update({ 
          where: { id: job.id }, 
          data: { status: "COMPLETED" } 
        });
        
        logger.log(`[Worker] Đơn hàng #${orderId} XỬ LÝ THÀNH CÔNG.`);

      } catch (err: any) {
        logger.error(`[Worker] Lỗi thực thi Job ${job.id}:`, err.message);

        const nextAttempt = job.attempts + 1;
        // Nếu lỗi do hết hàng thật hoặc đã quá số lần thử tối đa -> Hoàn tiền cho khách
        if (nextAttempt >= job.maxAttempts || err.message === "KHO_THAT_SU_HET_HANG") {
          await handleFailure(userId, orderId, finalPrice, job.id, err.message);
        } else {
          // Đẩy lại về PENDING để thử lại lần sau
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

/**
 * Hàm xử lý khi đơn hàng lỗi không thể khắc phục -> Hoàn tiền tự động
 */
async function handleFailure(userId: string, orderId: string, amount: number, jobId: string, errorMsg: string) {
  logger.log(`[Worker] Đang hoàn tiền cho đơn hàng #${orderId} do lỗi: ${errorMsg}`);
  
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) return;

      // Hoàn lại số dư cho User
      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } }
      });

      // Cập nhật trạng thái đơn hàng là thất bại
      await tx.order.update({
        where: { id: orderId },
        data: { status: "FAILURE", apiResponse: errorMsg }
      });

      // Ghi log giao dịch hoàn tiền
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

      // Đánh dấu Job là thất bại vĩnh viễn
      await tx.job.update({
        where: { id: jobId },
        data: { status: "FAILED", error: errorMsg }
      });
    });
  } catch (e) {
    logger.error("[Worker] Lỗi nghiêm trọng khi thực hiện hoàn tiền:", e);
  }
}

startWorker();