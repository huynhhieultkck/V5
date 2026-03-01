import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { t } from "../lib/lang";
import { authMiddleware, adminMiddleware } from "../middlewares/auth";

const statsRoutes = new Hono();

/**
 * Admin: Thống kê tổng quan Dashboard
 * Query: ?days=7 (Số ngày thống kê biểu đồ)
 */
statsRoutes.get("/dashboard", authMiddleware, adminMiddleware, async (c) => {
  const days = Number(c.req.query("days") || 7);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  try {
    // 1. Thống kê tổng quan (Card Summary)
    const [
      totalRevenue,
      totalDeposit,
      totalOrders,
      totalUsers,
      todayRevenue,
      todayOrders
    ] = await Promise.all([
      prisma.order.aggregate({
        where: { status: "SUCCESS" },
        _sum: { totalPrice: true }
      }),
      prisma.transaction.aggregate({
        where: { type: "DEPOSIT" },
        _sum: { amount: true }
      }),
      prisma.order.count(),
      prisma.user.count(),
      prisma.order.aggregate({
        where: { 
          status: "SUCCESS", 
          createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } 
        },
        _sum: { totalPrice: true }
      }),
      prisma.order.count({
        where: { 
          createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } 
        }
      })
    ]);

    // 2. Dữ liệu biểu đồ doanh thu theo ngày
    const chartOrders = await prisma.order.findMany({
      where: {
        status: "SUCCESS",
        createdAt: { gte: startDate }
      },
      select: {
        totalPrice: true,
        createdAt: true
      },
      orderBy: { createdAt: "asc" }
    });

    // Fix lỗi index type bằng cách đảm bảo day luôn là string
    const revenueByDay: Record<string, number> = {};
    chartOrders.forEach(order => {
      const day = order.createdAt.toISOString().split("T")[0];
      if (day) {
        revenueByDay[day] = (revenueByDay[day] || 0) + order.totalPrice;
      }
    });

    // 3. Top 5 sản phẩm bán chạy nhất
    const topProductsRaw = await prisma.order.groupBy({
      by: ["productId"],
      where: { status: "SUCCESS" },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: "desc" } },
      take: 5
    });

    const topProducts = await Promise.all(
      topProductsRaw.map(async (item) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { id: true, translations: { take: 1 } }
        });
        return {
          id: item.productId,
          name: product?.translations[0]?.name || "Unknown",
          totalSold: item._sum.amount,
          orderCount: item._count
        };
      })
    );

    // 4. Top 5 khách hàng
    const topUsers = await prisma.user.findMany({
      orderBy: { orders: { _count: "desc" } },
      take: 5,
      select: {
        id: true,
        username: true,
        balance: true,
        _count: {
          select: { orders: { where: { status: "SUCCESS" } } }
        }
      }
    });

    return c.json({
      status: "success",
      message: t(c, "stats_fetch_success"),
      data: {
        summary: {
          totalRevenue: totalRevenue._sum.totalPrice || 0,
          totalDeposit: totalDeposit._sum.amount || 0,
          totalOrders,
          totalUsers,
          todayRevenue: todayRevenue._sum.totalPrice || 0,
          todayOrders
        },
        chart: Object.keys(revenueByDay).map(date => ({
          date,
          revenue: revenueByDay[date]
        })),
        topProducts,
        topUsers: topUsers.map(u => ({
          id: u.id,
          username: u.username,
          balance: u.balance,
          orderCount: u._count.orders
        }))
      }
    });

  } catch (error) {
    return c.json({ message: t(c, "system_error") }, 500);
  }
});

export { statsRoutes };