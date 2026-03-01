import { prisma } from "../lib/prisma";

const BANK_URLS: Record<string, string> = {
  vietcombank: 'https://api.web2m.com/historyapivcbv3',
  bidv: 'https://api.web2m.com/historyapibidvv3',
  mbbank: 'https://api.web2m.com/historyapimbv3',
  acb: 'https://api.web2m.com/historyapiacbv3',
  techcombank: 'https://api.web2m.com/historyapitcbv3'
};

/**
 * Cron Job tự động quét lịch sử giao dịch ngân hàng qua Web2M
 */
export async function startBankCron() {
  console.log('--- Bank Cron Job started... ---');

  while (true) {
    try {
      // 1. Lấy danh sách ngân hàng đang hoạt động
      const activeBanks = await prisma.bank.findMany({ where: { enabled: true } });

      for (const bank of activeBanks) {
        try {
          // Xây dựng URL API Web2M
          const url = `${BANK_URLS[bank.code]}/${bank.password}/${bank.accountNumber}/${bank.token}`;
          const res = await fetch(url);
          const response = await res.json();

          const transactions = response?.transactions || [];

          for (const tx of transactions) {
            // Chỉ xử lý giao dịch tiền vào (IN)
            if (tx.type !== 'IN') continue;

            const bankTxId = tx.transactionID;

            // 2. Kiểm tra xem giao dịch đã tồn tại chưa (Sử dụng cột 'code' trong bảng Transaction)
            const exists = await prisma.transaction.findUnique({ where: { code: bankTxId } });
            if (exists) continue;

            // 3. Tìm mã ví (Wallet Code) trong nội dung chuyển khoản
            // Regex tìm chuỗi có định dạng VMMO + 8 ký tự chữ/số
            const match = tx.description.match(/\b(VMMO[A-Z0-9]{8})/i);
            if (!match || !match[1]) continue;

            const walletCode = match[1].toUpperCase();
            const amount = parseInt(tx.amount, 10);

            // 4. Tìm User tương ứng với mã ví
            const user = await prisma.user.findUnique({ where: { wallet: walletCode } });
            if (!user) continue;

            // 5. Cộng tiền và ghi log giao dịch
            await prisma.$transaction(async (txPrisma) => {
              // Cập nhật số dư User
              const updatedUser = await txPrisma.user.update({
                where: { id: user.id },
                data: { balance: { increment: amount } }
              });

              // Tạo bản ghi giao dịch
              await txPrisma.transaction.create({
                data: {
                  userId: user.id,
                  code: bankTxId, // Lưu ID giao dịch ngân hàng để chống trùng
                  amount: amount,
                  balanceBefore: user.balance,
                  balanceAfter: updatedUser.balance,
                  type: "DEPOSIT",
                  content: `Nạp tiền tự động qua ${bank.name}: ${tx.description}`
                }
              });
            });

            console.log(`[BankCron] Đã cộng ${amount} cho User ${user.username} (TX: ${bankTxId})`);
          }
        } catch (bankErr: any) {
          console.error(`[BankCron] Lỗi quét ngân hàng ${bank.code}:`, bankErr.message);
        }
      }
    } catch (err) {
      console.error('[BankCron] Lỗi vòng lặp chính:', err);
    }

    // Chờ 20 giây trước khi quét lượt tiếp theo
    await new Promise(rs => setTimeout(rs, 20000));
  }
}