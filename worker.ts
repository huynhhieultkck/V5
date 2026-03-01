import { prisma } from "./lib/prisma";
import { CMSNTService } from "./lib/cmsnt";
import { mailService } from "./lib/mail";
import { OrderStatus } from "./generated/prisma/client";

/**
 * Worker xử lý hàng đợi đơn hàng
 */
async function startWorker() {
  console.log("--- Order Worker is running with Anti-Race Condition... ---");

  while (true) {
    try {
      // 1. "Claim" Job một cách an toàn bằng Transaction
      // Tránh trường hợp 2 worker cùng lấy 1 job
      const job = await prisma.$transaction(async (tx) => {
        const pendingJob = await tx.job.findFirst({
          where: { status: "PENDING", attempts: { lt: 5 } },
          orderBy: { createdAt: "asc" },
        });

        if (!pendingJob) return null;

        return await tx.job.update({
          where: { id: pendingJob.id },
          data: { status: "PROCESSING" }
        });
      });

      if (!job) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      console.log(`[Worker] Đang xử lý Job ID: ${job.id}`);
      
      const payload = JSON.parse(job.payload);
      const { orderId, productId, amount, userId, finalPrice } = payload;

      try {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) throw new Error("Sản phẩm không tồn tại");

        let deliveryData: string[] = [];

        // 2. THỰC HIỆN LẤY HÀNG (FULFILLMENT)
        if (product.type === "LOCAL") {
          // GIẢI PHÁP CHỐNG TRÙNG LẶP: Sử dụng Transaction + Locking
          deliveryData = await prisma.$transaction(async (tx) => {
            /**
             * Sử dụng Raw Query để thực hiện 'FOR UPDATE'. 
             * Prisma hiện tại không hỗ trợ trực tiếp FOR UPDATE trong findMany.
             * Lệnh này sẽ khóa các hàng được chọn lại cho đến khi Transaction kết thúc.
             */
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

            // Đánh dấu đã bán NGAY TRONG TRANSACTON đang được khóa
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

        // 3. LƯU VÀO ONEDRIVE
        const fileContent = deliveryData.join("\n");
        const fileName = `${orderId}.txt`;
        
        console.log(`[Worker] Đang upload file ${fileName} lên OneDrive...`);
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
              fileId: uploadRes.id,
              accounts: deliveryData
            })
          }
        });

        // 5. CẬP NHẬT THỐNG KÊ
        await prisma.product.update({
          where: { id: productId },
          data: {
            soldCount: { increment: amount },
            resellStock: { decrement: amount }
          }
        });

        await prisma.job.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
        console.log(`[Worker] Đơn hàng #${orderId} XỬ LÝ THÀNH CÔNG.`);

      } catch (err: any) {
        console.error(`[Worker] Lỗi thực thi Job ${job.id}:`, err.message);

        const nextAttempt = job.attempts + 1;
        if (nextAttempt >= job.maxAttempts || err.message === "KHO_THAT_SU_HET_HANG") {
          // Nếu hết hàng thật hoặc quá lượt thử -> Hoàn tiền
          await handleFailure(userId, orderId, finalPrice, job.id, err.message);
        } else {
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "PENDING", attempts: nextAttempt, error: err.message }
          });
        }
      }

    } catch (globalErr) {
      console.error("[Worker] Lỗi vòng lặp chính:", globalErr);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

/**
 * Hàm xử lý khi đơn hàng lỗi -> Hoàn tiền
 */
async function handleFailure(userId: string, orderId: string, amount: number, jobId: string, errorMsg: string) {
  console.log(`[Worker] Đang hoàn tiền cho đơn hàng #${orderId}...`);
  
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) return;

      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } }
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: "FAILURE", apiResponse: errorMsg }
      });

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

      await tx.job.update({
        where: { id: jobId },
        data: { status: "FAILED", error: errorMsg }
      });
    });
  } catch (e) {
    console.error("[Worker] Lỗi khi hoàn tiền:", e);
  }
}

startWorker();