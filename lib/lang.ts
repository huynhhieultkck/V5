import type { Context } from "hono";
import { Language } from "../generated/prisma/client";

export const SUPPORTED_LANGUAGES: Language[] = ["VI", "EN", "ZH", "RU"];

interface ITranslations {
  system_error: string;
  captcha_invalid: string;
  rate_limit_exceeded: string;
  auth_login_success: string;
  auth_invalid: string;
  auth_banned: string;
  auth_exists: string;
  auth_register_success: string;
  auth_not_found: string;
  auth_reset_sent: string;
  auth_token_invalid: string;
  auth_password_updated: string;
  auth_api_key_generated: string;
  auth_api_key_deleted: string; // Khóa mới
  auth_unauthorized: string;
  auth_forbidden: string;
  auth_old_password_invalid: string;
  // Users
  user_not_found: string;
  user_update_success: string;
  user_deleted_success: string;
  user_adjustment_added: string;
  user_adjustment_subtracted: string;
  user_fetch_error: string;    
  user_update_error: string;   
  // Categories
  category_fetch_error: string;
  category_not_found: string;
  category_deleted: string;
  // Products
  product_not_found: string;
  product_deleted: string;
  // Checkout & Orders
  checkout_insufficient_balance: string;
  checkout_out_of_stock: string;
  checkout_min_purchase: string;
  checkout_max_purchase: string;
  checkout_success: string;
  order_not_found: string;
  order_forbidden: string;
  order_not_ready: string;
  order_fetch_success: string;
  storage_error: string;
  // Stocks
  stock_not_found: string;
  stock_import_success: string;
  stock_empty: string;
  stock_invalid_type: string;
  stock_deleted: string;
  stock_cleared: string;
  // Coupon
  coupon_invalid: string;
  coupon_usage_limit: string;
  coupon_min_order: string;
  coupon_deleted: string;
  // Deposit
  deposit_amount_invalid: string;
  deposit_create_fail: string;
  deposit_success: string;
  // Banks
  bank_not_found: string;
  bank_update_success: string;
  // Stats & Transactions
  stats_fetch_success: string;
  transaction_fetch_success: string;
  // Email
  mail_reset_subject: string;
  mail_reset_hello: string;
  mail_reset_text1: string;
  mail_reset_button: string;
  mail_reset_footer: string;
}

export const getLanguage = (c: Context): Language => {
  const queryLang = c.req.query("lang")?.toUpperCase();
  if (queryLang && SUPPORTED_LANGUAGES.includes(queryLang as Language)) return queryLang as Language;
  const headerLang = c.req.header("accept-language")?.split(",")[0]?.split("-")[0]?.toUpperCase();
  if (headerLang && SUPPORTED_LANGUAGES.includes(headerLang as Language)) return headerLang as Language;
  return "VI";
};

const messages: Record<Language, ITranslations> = {
  VI: {
    system_error: "Lỗi hệ thống, vui lòng thử lại sau.",
    captcha_invalid: "Xác thực Captcha không hợp lệ.",
    rate_limit_exceeded: "Bạn đã thao tác quá nhanh, vui lòng thử lại sau ít phút.",
    auth_login_success: "Đăng nhập thành công.",
    auth_invalid: "Tài khoản hoặc mật khẩu không chính xác.",
    auth_banned: "Tài khoản của bạn đã bị khóa.",
    auth_exists: "Username hoặc Email đã được sử dụng.",
    auth_register_success: "Đăng ký thành công.",
    auth_not_found: "Không tìm thấy người dùng.",
    auth_reset_sent: "Vui lòng kiểm tra email của bạn.",
    auth_token_invalid: "Mã xác thực không hợp lệ.",
    auth_password_updated: "Mật khẩu đã được cập nhật thành công.",
    auth_api_key_generated: "API Key đã được tạo thành công.",
    auth_api_key_deleted: "API Key đã được hủy bỏ thành công.",
    auth_unauthorized: "Vui lòng đăng nhập để thực hiện thao tác này.",
    auth_forbidden: "Bạn không có quyền truy cập khu vực này.",
    auth_old_password_invalid: "Mật khẩu cũ không chính xác.",
    user_not_found: "Không tìm thấy thành viên.",
    user_update_success: "Cập nhật thông tin thành viên thành công.",
    user_deleted_success: "Đã xóa thành viên khỏi hệ thống.",
    user_adjustment_added: "Quản trị viên nạp tiền thủ công",
    user_adjustment_subtracted: "Quản trị viên trừ tiền thủ công",
    user_fetch_error: "Lỗi khi tải danh sách thành viên.",
    user_update_error: "Lỗi khi cập nhật thông tin thành viên.",
    category_fetch_error: "Lỗi khi lấy danh mục.",
    category_not_found: "Không tìm thấy danh mục.",
    category_deleted: "Đã xóa danh mục thành công.",
    product_not_found: "Sản phẩm không tồn tại hoặc đã ngừng bán.",
    product_deleted: "Đã xóa sản phẩm thành công.",
    checkout_insufficient_balance: "Số dư tài khoản không đủ để thực hiện giao dịch.",
    checkout_out_of_stock: "Sản phẩm đã hết hàng hoặc không đủ số lượng yêu cầu.",
    checkout_min_purchase: "Số lượng mua tối thiểu là ",
    checkout_max_purchase: "Số lượng mua tối đa là ",
    checkout_success: "Đơn hàng của bạn đã được tiếp nhận và đang xử lý!",
    order_not_found: "Không tìm thấy đơn hàng.",
    order_forbidden: "Bạn không có quyền xem dữ liệu này.",
    order_not_ready: "Đơn hàng đang xử lý hoặc đã thất bại.",
    order_fetch_success: "Lấy danh sách đơn hàng thành công.",
    storage_error: "Không thể lấy dữ liệu từ kho lưu trữ.",
    stock_not_found: "Không tìm thấy tài khoản trong kho.",
    stock_import_success: "Đã thêm hàng vào kho thành công.",
    stock_empty: "Danh sách hàng trống.",
    stock_invalid_type: "Sản phẩm này không hỗ trợ thêm hàng thủ công.",
    stock_deleted: "Đã xóa tài khoản khỏi kho hàng.",
    stock_cleared: "Đã dọn dẹp kho hàng của sản phẩm này.",
    coupon_invalid: "Mã giảm giá không hợp lệ hoặc đã hết hạn.",
    coupon_usage_limit: "Mã giảm giá đã hết lượt sử dụng.",
    coupon_min_order: "Đơn hàng chưa đạt giá trị tối thiểu để sử dụng mã này.",
    coupon_deleted: "Đã xóa mã giảm giá thành công.",
    deposit_amount_invalid: "Số tiền nạp không hợp lệ (Tối thiểu 1 USD).",
    deposit_create_fail: "Không thể tạo hóa đơn nạp tiền.",
    deposit_success: "Nạp tiền thành công!",
    bank_not_found: "Không tìm thấy ngân hàng.",
    bank_update_success: "Cập nhật ngân hàng thành công.",
    stats_fetch_success: "Lấy số liệu thống kê thành công.",
    transaction_fetch_success: "Lấy lịch sử giao dịch thành công.",
    mail_reset_subject: "Yêu cầu đặt lại mật khẩu",
    mail_reset_hello: "Xin chào",
    mail_reset_text1: "Bạn đã yêu cầu đặt lại mật khẩu. Vui lòng nhấn nút bên dưới:",
    mail_reset_button: "Đặt lại mật khẩu",
    mail_reset_footer: "Nếu không yêu cầu, hãy bỏ qua email này.",
  },
  EN: {
    system_error: "System error, please try again later.",
    captcha_invalid: "Invalid Captcha verification.",
    rate_limit_exceeded: "Too many requests, please try again later.",
    auth_login_success: "Login successful.",
    auth_invalid: "Invalid username or password.",
    auth_banned: "Your account has been banned.",
    auth_exists: "Username or Email already exists.",
    auth_register_success: "Registration successful.",
    auth_not_found: "User not found.",
    auth_reset_sent: "Please check your email.",
    auth_token_invalid: "Invalid reset token.",
    auth_password_updated: "Password updated successfully.",
    auth_api_key_generated: "API Key has been generated successfully.",
    auth_api_key_deleted: "API Key has been revoked successfully.",
    auth_unauthorized: "Please login to perform this action.",
    auth_forbidden: "Access denied. Admin rights required.",
    auth_old_password_invalid: "Old password is incorrect.",
    user_not_found: "User not found.",
    user_update_success: "User updated successfully.",
    user_deleted_success: "User deleted successfully.",
    user_adjustment_added: "Manual balance adjustment: Added",
    user_adjustment_subtracted: "Manual balance adjustment: Subtracted",
    user_fetch_error: "Error fetching user list.",
    user_update_error: "Error updating user information.",
    category_fetch_error: "Error fetching categories.",
    category_not_found: "Category not found.",
    category_deleted: "Category deleted successfully.",
    product_not_found: "Product not found or disabled.",
    product_deleted: "Product deleted successfully.",
    checkout_insufficient_balance: "Insufficient balance.",
    checkout_out_of_stock: "Out of stock or insufficient quantity.",
    checkout_min_purchase: "Minimum purchase is ",
    checkout_max_purchase: "Maximum purchase is ",
    checkout_success: "Your order has been received and is being processed!",
    order_not_found: "Order not found.",
    order_forbidden: "You do not have permission to view this data.",
    order_not_ready: "Order is processing or failed.",
    order_fetch_success: "Orders fetched successfully.",
    storage_error: "Could not retrieve data from storage.",
    stock_not_found: "Stock item not found.",
    stock_import_success: "Stock imported successfully.",
    stock_empty: "Stock list is empty.",
    stock_invalid_type: "This product does not support manual stock.",
    stock_deleted: "Stock item deleted.",
    stock_cleared: "Stock cleared.",
    coupon_invalid: "Coupon is invalid or expired.",
    coupon_usage_limit: "Coupon usage limit reached.",
    coupon_min_order: "Minimum order value not met.",
    coupon_deleted: "Coupon deleted successfully.",
    deposit_amount_invalid: "Invalid amount (Min 1 USD).",
    deposit_create_fail: "Failed to create invoice.",
    deposit_success: "Deposit successful!",
    bank_not_found: "Bank not found.",
    bank_update_success: "Bank updated.",
    stats_fetch_success: "Statistics fetched.",
    transaction_fetch_success: "Transactions fetched.",
    mail_reset_subject: "Password Reset Request",
    mail_reset_hello: "Hello",
    mail_reset_text1: "You requested a password reset. Please click below:",
    mail_reset_button: "Reset Password",
    mail_reset_footer: "If you did not request this, please ignore this email.",
  },
  RU: {
    system_error: "Системная ошибка.",
    captcha_invalid: "Неверная капча.",
    rate_limit_exceeded: "Слишком nhiều запросов.",
    auth_login_success: "Успешный вход.",
    auth_invalid: "Неверный логин hoặc mật khẩu.",
    auth_banned: "Аккаунт заблокирован.",
    auth_exists: "Пользователь đã tồn tại.",
    auth_register_success: "Регистрация успешна.",
    auth_not_found: "Пользователь không tìm thấy.",
    auth_reset_sent: "Проверьте почту.",
    auth_token_invalid: "Неверный токен.",
    auth_password_updated: "Пароль обновлен.",
    auth_api_key_generated: "API-ключ создан.",
    auth_api_key_deleted: "API-ключ успешно аннулирован.",
    auth_unauthorized: "Авторизуйтесь.",
    auth_forbidden: "Доступ запрещен.",
    auth_old_password_invalid: "Старый пароль неверный.",
    user_not_found: "Пользователь không tìm thấy.",
    user_update_success: "Обновлено.",
    user_deleted_success: "Удалено.",
    user_adjustment_added: "Ручная корректировка: Добавлено",
    user_adjustment_subtracted: "Ручная корректировка: Вычтено",
    user_fetch_error: "Ошибка получения списка.",
    user_update_error: "Ошибка обновления.",
    category_fetch_error: "Ошибка категорий.",
    category_not_found: "Не найдено.",
    category_deleted: "Удалено.",
    product_not_found: "Товар không tồn tại.",
    product_deleted: "Товар удален.",
    checkout_insufficient_balance: "Недостаточно средств.",
    checkout_out_of_stock: "Нет в наличии.",
    checkout_min_purchase: "Минимум: ",
    checkout_max_purchase: "Максимум: ",
    checkout_success: "Заказ принят!",
    order_not_found: "Заказ không tìm thấy.",
    order_forbidden: "Нет прав.",
    order_not_ready: "Не готов.",
    order_fetch_success: "Список получен.",
    storage_error: "Ошибка хранилища.",
    stock_not_found: "Элемент không tìm thấy.",
    stock_import_success: "Импорт успешен.",
    stock_empty: "Пусто.",
    stock_invalid_type: "Тип không hỗ trợ.",
    stock_deleted: "Удалено.",
    stock_cleared: "Очищено.",
    coupon_invalid: "Купон недействителен.",
    coupon_usage_limit: "Лимит исчерпан.",
    coupon_min_order: "Мин. сумма không đạt.",
    coupon_deleted: "Купон удален.",
    deposit_amount_invalid: "Мин. 1 USD.",
    deposit_create_fail: "Ошибка создания счета.",
    deposit_success: "Пополнение успешно!",
    bank_not_found: "Банк không tìm thấy.",
    bank_update_success: "Обновлено.",
    stats_fetch_success: "Статистика получена.",
    transaction_fetch_success: "Транзакции получены.",
    mail_reset_subject: "Сброс пароля",
    mail_reset_hello: "Привет",
    mail_reset_text1: "Нажмите для сброса:",
    mail_reset_button: "Сброс",
    mail_reset_footer: "Проигнорируйте, nếu không phải bạn.",
  },
  ZH: {
    system_error: "系统错误。",
    captcha_invalid: "验证码错误。",
    rate_limit_exceeded: "请求过多。",
    auth_login_success: "登录成功。",
    auth_invalid: "用户名或密码错误。",
    auth_banned: "您的账号已被封禁。",
    auth_exists: "用户名或邮箱已存在。",
    auth_register_success: "注册成功。",
    auth_not_found: "找不到用户。",
    auth_reset_sent: "请检查邮箱。",
    auth_token_invalid: "令牌无效。",
    auth_password_updated: "密码已更新。",
    auth_api_key_generated: "API 密钥已生成。",
    auth_api_key_deleted: "API 密钥已成功撤销。",
    auth_unauthorized: "请登录后操作。",
    auth_forbidden: "权限不足。",
    auth_old_password_invalid: "旧密码错误。",
    user_not_found: "找不到用户。",
    user_update_success: "更新成功。",
    user_deleted_success: "删除成功。",
    user_adjustment_added: "手动余额调整：增加",
    user_adjustment_subtracted: "手动余额调整：减少",
    user_fetch_error: "加载用户列表错误。",
    user_update_error: "更新用户信息错误。",
    category_fetch_error: "获取分类失败。",
    category_not_found: "找不到分类。",
    category_deleted: "分类已删除。",
    product_not_found: "产品不存在。",
    product_deleted: "产品已删除。",
    checkout_insufficient_balance: "余额不足。",
    checkout_out_of_stock: "库存不足。",
    checkout_min_purchase: "起购数量：",
    checkout_max_purchase: "限购数量：",
    checkout_success: "订单已提交！",
    order_not_found: "找不到订单。",
    order_forbidden: "无权查看。",
    order_not_ready: "订单未完成。",
    order_fetch_success: "订单列表获取成功。",
    storage_error: "存储错误。",
    stock_not_found: "库存项不存在。",
    stock_import_success: "导入成功。",
    stock_empty: "库存为空。",
    stock_invalid_type: "不支持该类型。",
    stock_deleted: "已删除。",
    stock_cleared: "已清空。",
    coupon_invalid: "优惠券无效。",
    coupon_usage_limit: "次数已达上限。",
    coupon_min_order: "未达起用金额。",
    coupon_deleted: "优惠券已删除。",
    deposit_amount_invalid: "最小 1 美元。",
    deposit_create_fail: "创建失败。",
    deposit_success: "充值成功！",
    bank_not_found: "找不到银行。",
    bank_update_success: "更新成功。",
    stats_fetch_success: "统计获取成功。",
    transaction_fetch_success: "交易获取成功。",
    mail_reset_subject: "重置密码",
    mail_reset_hello: "您好",
    mail_reset_text1: "请点击下方按钮重置：",
    mail_reset_button: "重置密码",
    mail_reset_footer: "如非本人操作请忽略。",
  }
};

export const t = (c: Context, key: keyof ITranslations) => {
  const lang = getLanguage(c);
  const translationSet = messages[lang] || messages.VI;
  return translationSet[key] || messages.VI[key];
};