import { prisma } from "../lib/prisma";

const BANK_URLS: Record<string, string> = {
  vietcombank: 'https://api.web2m.com/historyapivcbv3',
  bidv: 'https://api.web2m.com/historyapibidvv3',
  mbbank: 'https://api.web2m.com/historyapimbv3',
  acb: 'https://api.web2m.com/historyapiacbv3',
  techcombank: 'https://api.web2m.com/historyapitcbv3'
};

const prefix = process.env.DEPOSIT_PREFIX || 'VMMO';
const bankInterval = Number(process.env.CRON_BANK_INTERVAL) || 20000;
/**
 * Cron Job tự động quét lịch sử giao dịch ngân hàng qua Web2M
 * Đã sửa lỗi: Xung đột mã giao dịch giữa các ngân hàng (Collision Bank TXID)
 */
export async function startBankCron() {
  console.log('--- Bank Cron Job started with Unique Prefixing... ---');

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

            /**
             * GIẢI PHÁP CHỐNG XUNG ĐỘT:
             * Tạo mã giao dịch duy nhất bằng cách kết hợp mã ngân hàng và mã giao dịch ngân hàng.
             * Ví dụ: VCB_12345678, MB_12345678
             */
            const bankTxId = tx.transactionID;
            const uniqueCode = `${bank.code.toUpperCase()}_${bankTxId}`;

            // 2. Kiểm tra xem mã duy nhất này đã tồn tại chưa
            const exists = await prisma.transaction.findUnique({ where: { code: uniqueCode } });
            if (exists) continue;

            // 3. Tìm mã ví (Wallet Code) trong nội dung chuyển khoản
            // Tạo regex động: kết quả tương đương với /\b(VMMO[A-Z0-9]{8})/i
            const regex = new RegExp(`\\b(${prefix}[A-Z0-9]{8})`, 'i');

            const match = tx.description.match(regex); if (!match || !match[1]) continue;

            const walletCode = match[1].toUpperCase();
            const amount = parseInt(tx.amount, 10);

            // 4. Tìm User tương ứng với mã ví
            const user = await prisma.user.findUnique({ where: { wallet: walletCode } });
            if (!user) continue;

            // 5. Cộng tiền và ghi log giao dịch (Atomic Transaction)
            await prisma.$transaction(async (txPrisma) => {
              // Cập nhật số dư User
              const updatedUser = await txPrisma.user.update({
                where: { id: user.id },
                data: { balance: { increment: amount } }
              });

              // Tạo bản ghi giao dịch với mã duy nhất đã có tiền tố
              await txPrisma.transaction.create({
                data: {
                  userId: user.id,
                  code: uniqueCode,
                  amount: amount,
                  balanceBefore: user.balance,
                  balanceAfter: updatedUser.balance,
                  type: "DEPOSIT",
                  content: `Nạp tiền tự động qua ${bank.name}: ${tx.description}`
                }
              });
            });

            console.log(`[BankCron] Đã cộng ${amount} cho User ${user.username} (Unique TX: ${uniqueCode})`);
          }
        } catch (bankErr: any) {
          console.error(`[BankCron] Lỗi quét ngân hàng ${bank.code}:`, bankErr.message);
        }
      }
    } catch (err) {
      console.error('[BankCron] Lỗi vòng lặp chính:', err);
    }

    // Chờ 20 giây trước khi quét lượt tiếp theo
    await new Promise(rs => setTimeout(rs, bankInterval));
  }
}